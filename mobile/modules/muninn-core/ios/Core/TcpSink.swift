// TCP data channel for video / depth: uint32 little-endian length + MnDataMessage (§6.2).
// Keeps only the newest frame when the link is congested (§8.4), never queues up.
import Foundation
import Network

public final class TcpSink {
  private var connection: NWConnection?
  private let queue = DispatchQueue(label: "imuninn.tcp")
  private var ready = false
  private var inFlight = 0
  public private(set) var sent: UInt64 = 0
  public private(set) var dropped: UInt64 = 0
  public private(set) var bytes: UInt64 = 0
  /// Set when a frame was dropped so the encoder can resync with a keyframe.
  public var onDroppedVideo: (() -> Void)?

  public init() {}

  public var isReady: Bool { ready }

  public func connect(host: NWEndpoint.Host, port: UInt16) {
    disconnect()
    guard let p = NWEndpoint.Port(rawValue: port) else { return }
    let params = NWParameters.tcp
    if let tcp = params.defaultProtocolStack.transportProtocol as? NWProtocolTCP.Options {
      tcp.noDelay = true
    }
    let conn = NWConnection(host: host, port: p, using: params)
    conn.stateUpdateHandler = { [weak self] st in
      switch st {
      case .ready: self?.ready = true
      case .failed(let e):
        NSLog("[imuninn] tcp failed: \(e)")
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
    inFlight = 0
  }

  /// `droppable`: video frames may be skipped under backpressure; depth / gaps are not.
  public func send(_ msg: MnDataMessage, droppable: Bool, keyframe: Bool = false) {
    guard ready, let conn = connection, let payload = try? msg.serializedData() else {
      dropped &+= 1
      return
    }
    if droppable, inFlight > 2, !keyframe {
      dropped &+= 1
      onDroppedVideo?()
      return
    }
    var frame = Data(capacity: payload.count + 4)
    var len = UInt32(payload.count).littleEndian
    withUnsafeBytes(of: &len) { frame.append(contentsOf: $0) }
    frame.append(payload)
    inFlight += 1
    sent &+= 1
    bytes &+= UInt64(frame.count)
    conn.send(content: frame, completion: .contentProcessed { [weak self] _ in
      self?.queue.async { self?.inFlight -= 1 }
    })
  }
}
