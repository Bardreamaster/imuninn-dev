// TCP data channel for video / depth: uint32 little-endian length + MnDataMessage (§6.2).
// Keeps only the newest frame when the link is congested (§8.4), never queues up.
import Foundation
import Network

public final class TcpSink {
  private let connection: NWConnection
  private let queue: DispatchQueue
  private var ready = true
  private var inFlight = 0
  public private(set) var sent: UInt64 = 0
  public private(set) var dropped: UInt64 = 0
  public private(set) var bytes: UInt64 = 0
  /// Set when a frame was dropped so the encoder can resync with a keyframe.
  public var onDroppedVideo: (() -> Void)?
  public var onClosed: (() -> Void)?

  /// Wraps an already-started connection (accepted by DataServer).
  public init(connection: NWConnection, queue: DispatchQueue) {
    self.connection = connection
    self.queue = queue
    connection.stateUpdateHandler = { [weak self] st in
      switch st {
      case .failed, .cancelled:
        self?.ready = false
        self?.onClosed?()
      default: break
      }
    }
    // Detect peer close: a read that completes with EOF/error.
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1) { [weak self] _, _, complete, err in
      if complete || err != nil { self?.ready = false; self?.connection.cancel() }
    }
  }

  public var isReady: Bool { ready }

  public func disconnect() {
    connection.cancel()
    ready = false
  }

  /// `droppable`: video frames may be skipped under backpressure; depth / gaps are not.
  public func send(_ msg: MnDataMessage, droppable: Bool, keyframe: Bool = false) {
    guard ready, let payload = try? msg.serializedData() else {
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
    connection.send(content: frame, completion: .contentProcessed { [weak self] err in
      self?.queue.async {
        self?.inFlight -= 1
        if err != nil { self?.ready = false }
      }
    })
  }
}
