// Source → Transform → Sink skeleton (§4.2, §8). Plain Swift, no Expo imports.
import CoreMedia
import CoreVideo
import Foundation
import simd

/// A timestamped unit of data. Pixel data is carried by reference only (§8.1).
public enum SamplePayload {
  case pixelBuffer(CVPixelBuffer)
  case encodedVideo(Data, keyframe: Bool)
  case imu(accel: SIMD3<Double>, gyro: SIMD3<Double>)
  case pose(transform: simd_float4x4, intrinsics: simd_float3x3, trackingNormal: Bool)
  case depth(CVPixelBuffer, confidence: CVPixelBuffer?)
  case gap(reason: String)
}

public struct Sample {
  public let streamId: String
  public let seq: UInt64
  public let deviceTimeNs: UInt64
  public let configVersion: UInt32
  public let payload: SamplePayload

  public init(streamId: String, seq: UInt64, deviceTimeNs: UInt64, configVersion: UInt32, payload: SamplePayload) {
    self.streamId = streamId
    self.seq = seq
    self.deviceTimeNs = deviceTimeNs
    self.configVersion = configVersion
    self.payload = payload
  }
}

public protocol Sink: AnyObject {
  var id: String { get }
  /// Must return quickly; each Sink owns its queue and drop policy (§8.4).
  func consume(_ sample: Sample)
}

public protocol Source: AnyObject {
  var streamId: String { get }
  func capabilities() -> [String: Any]
  func start(config: [String: Any]) throws
  func stop()
  var onSample: ((Sample) -> Void)? { get set }
}

/// Fan-out with per-sink isolation. Transforms are Sinks that are also Sources.
public final class Bus {
  private var sinks: [String: Sink] = [:]
  private let lock = NSLock()

  public init() {}

  public func attach(_ sink: Sink) {
    lock.lock(); defer { lock.unlock() }
    sinks[sink.id] = sink
  }

  public func detach(_ id: String) {
    lock.lock(); defer { lock.unlock() }
    sinks.removeValue(forKey: id)
  }

  public func publish(_ sample: Sample) {
    lock.lock()
    let targets = Array(sinks.values)
    lock.unlock()
    for s in targets { s.consume(sample) }
  }
}

/// Converts a CoreMedia/ARKit timestamp (seconds, mach_absolute_time base) to ns.
@inline(__always)
public func deviceTimeNs(fromSeconds t: TimeInterval) -> UInt64 {
  UInt64((t * 1_000_000_000).rounded())
}
