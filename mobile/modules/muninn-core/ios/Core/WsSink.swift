// WebSocket data channel (protocol v5, Hello.data_transport = WEBSOCKET): every subscribed
// stream as one binary MnDataMessage frame on a second WebSocket connection to the control
// port. Browsers use this because they have no raw TCP / UDP. Backpressure mirrors TcpSink:
// video frames are skipped (and a keyframe requested) when too many are in flight; small
// samples (pose / IMU / health) are dropped silently when the link is far behind.
import Foundation
import Network

public final class WsSink {
  public static let magic = Data("IMDATA01".utf8)   // first frame: magic + uint32 LE client_id

  private let connection: NWConnection
  private let queue: DispatchQueue
  private var ready = true
  private var inFlight = 0
  public private(set) var sent: UInt64 = 0
  public private(set) var dropped: UInt64 = 0
  public private(set) var bytes: UInt64 = 0
  public var onDroppedVideo: (() -> Void)?
  public var onClosed: (() -> Void)?

  /// Wraps an already-started WebSocket connection (accepted by ControlServer).
  public init(connection: NWConnection, queue: DispatchQueue) {
    self.connection = connection
    self.queue = queue
  }

  public var isReady: Bool { ready }

  public func disconnect() {
    ready = false
    connection.cancel()
  }

  /// Called by the owner when the connection fails or is cancelled.
  func markClosed() {
    guard ready else { return }
    ready = false
    onClosed?()
  }

  /// Video / depth frames: same policy as TcpSink.
  public func send(_ msg: MnDataMessage, droppable: Bool, keyframe: Bool = false) {
    if droppable, inFlight > 2, !keyframe {
      dropped &+= 1
      onDroppedVideo?()
      return
    }
    write(msg)
  }

  /// Pose / IMU / health: never block, never resync; just drop when the link is far behind.
  public func sendSample(_ msg: MnDataMessage) {
    if inFlight > 16 { dropped &+= 1; return }
    write(msg)
  }

  private func write(_ msg: MnDataMessage) {
    guard ready, let payload = try? msg.serializedData() else { dropped &+= 1; return }
    let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
    let ctx = NWConnection.ContentContext(identifier: "data", metadata: [meta])
    inFlight += 1
    sent &+= 1
    bytes &+= UInt64(payload.count)
    connection.send(content: payload, contentContext: ctx, isComplete: true, completion: .contentProcessed { [weak self] err in
      self?.queue.async {
        self?.inFlight -= 1
        if err != nil { self?.ready = false }
      }
    })
  }
}
