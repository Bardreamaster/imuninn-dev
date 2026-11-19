// TCP data server: clients connect, write their 4-byte client_id (LE), then receive
// the length-prefixed MnDataMessage stream (video / depth) for their subscriptions.
import Foundation
import Network

public final class DataServer {
  private var listener: NWListener?
  private let queue = DispatchQueue(label: "imuninn.data")
  public private(set) var port: UInt16 = 0
  /// Called once the client id has been read; return false to reject.
  public var onAttach: ((UInt32, TcpSink) -> Bool)?

  public init() {}

  public func start(port: UInt16) {
    wantedPort = port
    listen(on: port)
  }

  /// `port` 0 = any free port. The client learns the real one from Welcome.tcp_port.
  private func listen(on port: UInt16) {
    stop()
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    params.allowLocalEndpointReuse = true
    if let tcp = params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options { tcp.noDelay = true }
    guard let l = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: port) ?? .any) else { return }
    l.stateUpdateHandler = { [weak self] st in
      switch st {
      case .ready: self?.port = l.port?.rawValue ?? port
      case .failed(let e):
        // Another copy of the app (App Store + dev build) suspended in the background can
        // still hold the port: take any free one instead of retrying forever.
        if case .posix(.EADDRINUSE) = e, port != 0 {
          NSLog("[imuninn] data port \(port) in use; using a free port")
          self?.queue.async { self?.listen(on: 0) }
        } else {
          NSLog("[imuninn] data listener failed: \(e); restarting")
          self?.queue.asyncAfter(deadline: .now() + 2) { self?.listen(on: port) }
        }
      default: break
      }
    }
    l.newConnectionHandler = { [weak self] conn in
      conn.start(queue: self?.queue ?? .global())
      conn.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self] data, _, _, err in
        guard let self, err == nil, let data, data.count == 4 else { conn.cancel(); return }
        let id = data.withUnsafeBytes { $0.load(as: UInt32.self) }.littleEndian
        let sink = TcpSink(connection: conn, queue: self.queue)
        if self.onAttach?(id, sink) != true { conn.cancel() }
      }
    }
    l.start(queue: queue)
    listener = l
  }

  public func stop() {
    listener?.stateUpdateHandler = nil
    listener?.cancel()
    listener = nil
    port = 0
  }

  private var wantedPort: UInt16 = 0

  public func restartIfNeeded() {
    guard wantedPort != 0 else { return }
    if listener == nil || listener?.state != .ready { start(port: wantedPort) }
  }

  public func restart() {
    guard wantedPort != 0 else { return }
    start(port: wantedPort)
  }
}
