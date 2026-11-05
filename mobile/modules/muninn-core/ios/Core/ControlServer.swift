// Control server: the phone advertises `_imuninn._tcp` over Bonjour and accepts
// WebSocket connections carrying MnControlMessage (§6.2, §6.7). One `Client` per PC.
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
}

public final class ControlServer {
  public static let serviceType = "_imuninn._tcp"

  private var listener: NWListener?
  private let queue = DispatchQueue(label: "imuninn.control")
  public private(set) var clients: [UInt32: Client] = [:]
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
    clients = [:]
    state = "stopped"
  }

  /// Rebuild the listener (after suspension or a network change) if it is not listening.
  public func restartIfNeeded() {
    guard wantedPort != 0 else { return }
    if state != "listening" { start(port: wantedPort, serviceName: wantedName) }
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
        let client = Client(id: id, connection: conn)
        self.clients[id] = client
        self.onConnect?(client)
        self.receiveLoop(client)
      case .failed, .cancelled:
        if let client = self.clients.removeValue(forKey: id) {
          client.udp.disconnect()
          client.tcp?.disconnect()
          self.onDisconnect?(client)
        }
      default: break
      }
    }
    conn.start(queue: queue)
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
