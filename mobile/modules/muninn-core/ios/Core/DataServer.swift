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
    stop()
    let params = NWParameters.tcp
    params.includePeerToPeer = true
    params.allowLocalEndpointReuse = true
    if let tcp = params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options { tcp.noDelay = true }
    guard let p = NWEndpoint.Port(rawValue: port), let l = try? NWListener(using: params, on: p) else { return }
    l.stateUpdateHandler = { [weak self] st in
      if case .ready = st { self?.port = l.port?.rawValue ?? port }
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
    listener?.cancel()
    listener = nil
  }
}
