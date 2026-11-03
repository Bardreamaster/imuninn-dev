// Control channel: WebSocket over Network.framework carrying MnControlMessage (§6.2).
import Foundation
import Network

public final class ControlClient {
  public enum State: Equatable {
    case idle, connecting, ready, failed(String), cancelled
  }

  private var connection: NWConnection?
  private let queue = DispatchQueue(label: "imuninn.control")
  public private(set) var state: State = .idle
  /// Resolved after `.ready`; used to aim the UDP data channel at the same host.
  public private(set) var remoteHost: NWEndpoint.Host?

  public var onMessage: ((MnControlMessage) -> Void)?
  public var onState: ((State) -> Void)?

  public init() {}

  public func connect(to endpoint: NWEndpoint) {
    cancel()
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = true
    ws.maximumMessageSize = 16 * 1024 * 1024
    params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    let conn = NWConnection(to: endpoint, using: params)
    connection = conn
    setState(.connecting)
    conn.stateUpdateHandler = { [weak self] st in
      guard let self else { return }
      switch st {
      case .ready:
        if case let .hostPort(host, _)? = conn.currentPath?.remoteEndpoint {
          self.remoteHost = host
        }
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

  public func cancel() {
    connection?.cancel()
    connection = nil
    remoteHost = nil
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
