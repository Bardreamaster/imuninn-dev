// UDP data channel sink: one MnDataMessage per datagram (§6.2). Drops when not ready.
import Foundation
import Network

public final class UdpSink: Sink {
  public let id = "udp"
  private var connection: NWConnection?
  private let queue = DispatchQueue(label: "imuninn.udp")
  private var ready = false
  public private(set) var sent: UInt64 = 0
  public private(set) var dropped: UInt64 = 0

  public init() {}

  public func connect(host: NWEndpoint.Host, port: UInt16) {
    disconnect()
    guard let p = NWEndpoint.Port(rawValue: port) else { return }
    let conn = NWConnection(host: host, port: p, using: .udp)
    conn.stateUpdateHandler = { [weak self] st in
      switch st {
      case .ready: self?.ready = true
      case .failed(let e):
        NSLog("[imuninn] udp failed: \(e)")
        self?.ready = false
      case .cancelled: self?.ready = false
      default: break
      }
    }
    conn.start(queue: queue)
    connection = conn
  }

  public func disconnect() {
    connection?.cancel()
    connection = nil
    ready = false
  }

  public func send(_ msg: MnDataMessage) {
    guard ready, let conn = connection, let data = try? msg.serializedData() else {
      dropped &+= 1
      return
    }
    sent &+= 1
    conn.send(content: data, completion: .contentProcessed { _ in })
  }

  public func consume(_ sample: Sample) {
    // Samples are encoded by SessionManager; raw pixel buffers never reach this sink in M1.
  }
}
