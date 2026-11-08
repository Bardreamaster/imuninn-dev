// Control server: the phone advertises `_imuninn._tcp` over Bonjour and accepts
// WebSocket connections carrying MnControlMessage (§6.2, §6.7). One `Client` per PC.
// A second WebSocket whose first frame is WsSink.magic + client_id is a data connection
// (protocol v5, browsers): it becomes that client's WsSink instead of a Client.
import Foundation
import Network

public final class Client {
  public let id: UInt32
  public let connection: NWConnection
  public let remoteHost: NWEndpoint.Host?
  public var name: String = ""
  public var subscribed: Set<String> = []
  public let udp = UdpSink()
  public var tcp: TcpSink?
  public var ws: WsSink?
  public var isWriter = false

  init(id: UInt32, connection: NWConnection) {
    self.id = id
    self.connection = connection
    if case let .hostPort(host, _)? = connection.currentPath?.remoteEndpoint {
      remoteHost = host
    } else {
      remoteHost = nil
    }
  }

  public var label: String { name.isEmpty ? "client-\(id)" : name }

  /// Where video / depth go: the WebSocket data channel if the client opened one, else TCP.
  public var hasFrameSink: Bool { ws != nil || tcp != nil }
  public var frameDropped: UInt64 { (tcp?.dropped ?? 0) &+ (ws?.dropped ?? 0) }

  public func sendFrame(_ msg: MnDataMessage, droppable: Bool, keyframe: Bool) {
    if let ws { ws.send(msg, droppable: droppable, keyframe: keyframe) } else { tcp?.send(msg, droppable: droppable, keyframe: keyframe) }
  }

  /// Pose / IMU / health: WebSocket data channel if present, else UDP.
  public func sendSample(_ msg: MnDataMessage) {
    if let ws { ws.sendSample(msg) } else { udp.send(msg) }
  }
}

public final class ControlServer {
  public static let serviceType = "_imuninn._tcp"

  private var listener: NWListener?
  private let queue = DispatchQueue(label: "imuninn.control")
  public private(set) var clients: [UInt32: Client] = [:]
  private var dataSinks: [UInt32: WsSink] = [:]   // keyed by connection number, for close detection
  private var nextId: UInt32 = 1
  public private(set) var port: UInt16 = 0
  public private(set) var state: String = "stopped"     // starting | listening | failed | stopped
  public private(set) var lastError: String = ""
  private var wantedPort: UInt16 = 0
  private var wantedName: String = ""
  private var restartTimer: DispatchSourceTimer?

  public var onMessage: ((Client, MnControlMessage) -> Void)?
  public var onConnect: ((Client) -> Void)?
  public var onDisconnect: ((Client) -> Void)?
  /// A data WebSocket announced itself for `client_id`; return false to reject.
  public var onAttachWs: ((UInt32, WsSink) -> Bool)?

  public init() {}

  public func start(port: UInt16, serviceName: String) {
    stop()
    wantedPort = port
    wantedName = serviceName
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    params.allowLocalEndpointReuse = true
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.maximumMessageSize = 16 * 1024 * 1024
    params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    guard let p = NWEndpoint.Port(rawValue: port), let l = try? NWListener(using: params, on: p) else {
      state = "failed"; lastError = "cannot listen on \(port)"
      scheduleRestart()
      return
    }
    l.service = NWListener.Service(name: serviceName, type: Self.serviceType,
                                   txtRecord: NWTXTRecord(["proto": "\(protocolVersion)"]))
    l.stateUpdateHandler = { [weak self] st in
      guard let self else { return }
      switch st {
      case .ready:
        self.port = l.port?.rawValue ?? port
        self.state = "listening"
        self.lastError = ""
      case .failed(let e):
        // iOS reclaims sockets while the app is suspended; rebuild the listener.
        self.state = "failed"; self.lastError = e.localizedDescription
        self.scheduleRestart()
      case .waiting(let e):
        self.lastError = e.localizedDescription
      case .cancelled:
        if self.state != "stopped" { self.state = "stopped" }
      default: break
      }
    }
    l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
    l.start(queue: queue)
    listener = l
    state = "starting"
  }

  public func stop() {
    restartTimer?.cancel(); restartTimer = nil
    listener?.stateUpdateHandler = nil
    listener?.cancel()
    listener = nil
    for c in clients.values { c.connection.cancel() }
    for s in dataSinks.values { s.disconnect() }
    clients = [:]
    dataSinks = [:]
    state = "stopped"
  }

  /// Rebuild the listener (after suspension or a network change) if it is not listening.
  public func restartIfNeeded() {
    guard wantedPort != 0 else { return }
    if state != "listening" { start(port: wantedPort, serviceName: wantedName) }
  }

  /// Unconditional rebuild: a suspended app's listener can look alive but be dead.
  public func restart() {
    guard wantedPort != 0 else { return }
    start(port: wantedPort, serviceName: wantedName)
  }

  private func scheduleRestart() {
    restartTimer?.cancel()
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + 2)
    t.setEventHandler { [weak self] in
      guard let self, self.state != "listening", self.wantedPort != 0 else { return }
      self.start(port: self.wantedPort, serviceName: self.wantedName)
    }
    t.resume()
    restartTimer = t
  }

  private func accept(_ conn: NWConnection) {
    let id = nextId
    nextId &+= 1
    conn.stateUpdateHandler = { [weak self, weak conn] st in
      guard let self, let conn else { return }
      switch st {
      case .ready:
        self.receiveFirst(conn, number: id)
      case .failed, .cancelled:
        if let client = self.clients.removeValue(forKey: id) {
          client.udp.disconnect()
          client.tcp?.disconnect()
          client.ws?.disconnect()
          self.onDisconnect?(client)
        }
        if let sink = self.dataSinks.removeValue(forKey: id) { sink.markClosed() }
      default: break
      }
    }
    conn.start(queue: queue)
  }

  /// The first frame decides what a connection is: a data channel (magic + client_id, v5)
  /// or a control connection (its Hello).
  private func receiveFirst(_ conn: NWConnection, number: UInt32) {
    conn.receiveMessage { [weak self, weak conn] data, ctx, _, error in
      guard let self, let conn else { return }
      if error != nil || Self.isClose(ctx) { conn.cancel(); return }
      if let data, data.count == WsSink.magic.count + 4, data.prefix(WsSink.magic.count) == WsSink.magic {
        let clientId = data.suffix(4).withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }.littleEndian
        let sink = WsSink(connection: conn, queue: self.queue)
        if self.onAttachWs?(clientId, sink) == true {
          self.dataSinks[number] = sink
          self.drain(conn)   // keep reading so a peer close is noticed
        } else {
          conn.cancel()
        }
        return
      }
      let client = Client(id: number, connection: conn)
      self.clients[number] = client
      self.onConnect?(client)
      if let data, let msg = try? MnControlMessage(serializedBytes: data) {
        self.onMessage?(client, msg)
      }
      self.receiveLoop(client)
    }
  }

  private static func isClose(_ ctx: NWConnection.ContentContext?) -> Bool {
    if let meta = ctx?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
       meta.opcode == .close { return true }
    return false
  }

  /// Data connections carry nothing after the first frame; read anyway to see the close.
  private func drain(_ conn: NWConnection) {
    conn.receiveMessage { [weak self, weak conn] _, ctx, _, error in
      guard let self, let conn else { return }
      if error != nil || Self.isClose(ctx) { conn.cancel(); return }
      self.drain(conn)
    }
  }

  private func receiveLoop(_ client: Client) {
    client.connection.receiveMessage { [weak self, weak client] data, ctx, _, error in
      guard let self, let client else { return }
      if error != nil { client.connection.cancel(); return }
      if let meta = ctx?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
         meta.opcode == .close {
        client.connection.cancel()
        return
      }
      if let data, let msg = try? MnControlMessage(serializedBytes: data) {
        self.onMessage?(client, msg)
      }
      self.receiveLoop(client)
    }
  }

  public func send(_ msg: MnControlMessage, to client: Client) {
    guard let data = try? msg.serializedData() else { return }
    let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
    let ctx = NWConnection.ContentContext(identifier: "bin", metadata: [meta])
    client.connection.send(content: data, contentContext: ctx, isComplete: true, completion: .contentProcessed { _ in })
  }

  public func broadcast(_ msg: MnControlMessage) {
    for c in clients.values { send(msg, to: c) }
  }

  public func client(byId id: UInt32) -> Client? { clients[id] }
}
