// Control channel: WebSocket over Network.framework carrying MnControlMessage (§6.2).
//
// NWProtocolWebSocket needs a URL endpoint to build its HTTP upgrade request, so a
// Bonjour service endpoint is first resolved to host:port with a throwaway TCP
// connection, then the WebSocket is opened against ws://host:port/.
import Foundation
import Network

public final class ControlClient {
  public enum State: Equatable {
    case idle, resolving, connecting, ready, failed(String), cancelled
  }

  private var resolver: NWConnection?
  private var connection: NWConnection?
  private let queue = DispatchQueue(label: "imuninn.control")
  public private(set) var state: State = .idle
  /// Resolved before `.connecting`; used to aim the UDP data channel at the same host.
  public private(set) var remoteHost: NWEndpoint.Host?
  public private(set) var remotePort: UInt16 = 0

  public var onMessage: ((MnControlMessage) -> Void)?
  public var onState: ((State) -> Void)?

  public init() {}

  public func connect(to endpoint: NWEndpoint) {
    cancel()
    switch endpoint {
    case let .hostPort(host, port):
      openWebSocket(host: host, port: port.rawValue)
    default:
      resolve(endpoint)
    }
  }

  public func cancel() {
    resolver?.cancel(); resolver = nil
    connection?.cancel(); connection = nil
    remoteHost = nil
    remotePort = 0
  }

  public func send(_ msg: MnControlMessage) {
    guard let conn = connection, state == .ready else { return }
    guard let data = try? msg.serializedData() else { return }
    let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
    let ctx = NWConnection.ContentContext(identifier: "bin", metadata: [meta])
    conn.send(content: data, contentContext: ctx, isComplete: true, completion: .contentProcessed { err in
      if let err { NSLog("[imuninn] control send failed: \(err)") }
    })
  }

  // MARK: resolution

  private func resolve(_ endpoint: NWEndpoint) {
    setState(.resolving)
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    let r = NWConnection(to: endpoint, using: params)
    resolver = r
    r.stateUpdateHandler = { [weak self, weak r] st in
      guard let self, let r else { return }
      switch st {
      case .ready:
        if case let .hostPort(host, port)? = r.currentPath?.remoteEndpoint {
          r.cancel()
          self.resolver = nil
          self.openWebSocket(host: host, port: port.rawValue)
        } else {
          r.cancel()
          self.setState(.failed("could not resolve service endpoint"))
        }
      case let .failed(err):
        self.setState(.failed("resolve: \(err.localizedDescription)"))
      case let .waiting(err):
        NSLog("[imuninn] resolve waiting: \(err)")
      default: break
      }
    }
    r.start(queue: queue)
  }

  private static func urlHost(_ host: NWEndpoint.Host) -> String {
    switch host {
    case .ipv4(let a): return "\(a)"
    case .ipv6(let a):
      let s = "\(a)".split(separator: "%").first.map(String.init) ?? "\(a)"
      return "[\(s)]"
    case .name(let n, _): return n
    @unknown default: return "\(host)"
    }
  }

  // MARK: websocket

  private func openWebSocket(host: NWEndpoint.Host, port: UInt16) {
    remoteHost = host
    remotePort = port
    guard let url = URL(string: "ws://\(Self.urlHost(host)):\(port)/") else {
      setState(.failed("bad url for \(host):\(port)"))
      return
    }
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.maximumMessageSize = 16 * 1024 * 1024
    params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    let conn = NWConnection(to: .url(url), using: params)
    connection = conn
    setState(.connecting)
    conn.stateUpdateHandler = { [weak self] st in
      guard let self else { return }
      switch st {
      case .ready:
        self.setState(.ready)
        self.receiveLoop(conn)
      case let .failed(err):
        self.setState(.failed(err.localizedDescription))
      case let .waiting(err):
        NSLog("[imuninn] control waiting: \(err)")
      case .cancelled:
        self.setState(.cancelled)
      default:
        break
      }
    }
    conn.start(queue: queue)
  }

  private func receiveLoop(_ conn: NWConnection) {
    conn.receiveMessage { [weak self] data, ctx, _, error in
      guard let self else { return }
      if let error {
        self.setState(.failed(error.localizedDescription))
        return
      }
      if let meta = ctx?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
         meta.opcode == .close {
        self.setState(.cancelled)
        return
      }
      if let data, let msg = try? MnControlMessage(serializedBytes: data) {
        self.onMessage?(msg)
      }
      self.receiveLoop(conn)
    }
  }

  private func setState(_ s: State) {
    state = s
    onState?(s)
  }
}
