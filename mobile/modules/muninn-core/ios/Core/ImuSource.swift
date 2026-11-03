// CoreMotion IMU source (§5.1). Timestamps share the ARKit time base (seconds since boot).
import CoreMotion
import Foundation

public final class ImuSource {
  public static let streamId = "imu"

  private let motion = CMMotionManager()
  private let queue: OperationQueue = {
    let q = OperationQueue()
    q.name = "imuninn.imu"
    q.maxConcurrentOperationCount = 1
    q.qualityOfService = .userInteractive
    return q
  }()
  private var seq: UInt64 = 0
  public private(set) var rateHz: Int = 100
  public var onSample: ((MnImuSample) -> Void)?
  public private(set) var running = false

  public init() {}

  public var available: Bool { motion.isDeviceMotionAvailable }

  public func start(rateHz: Int) {
    stop()
    self.rateHz = rateHz
    guard motion.isDeviceMotionAvailable else { return }
    motion.deviceMotionUpdateInterval = 1.0 / Double(rateHz)
    running = true
    // Device motion gives accel and gyro on one timestamp. Total acceleration is
    // gravity + userAcceleration (in g); rotationRate is bias-corrected rad/s.
    motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: queue) { [weak self] m, err in
      guard let self, let m else {
        if let err { NSLog("[imuninn] imu error: \(err)") }
        return
      }
      let g = 9.80665
      var s = MnImuSample()
      s.header.streamID = Self.streamId
      s.header.seq = self.seq
      self.seq &+= 1
      s.header.deviceTimeNs = deviceTimeNs(fromSeconds: m.timestamp)
      s.accel.x = (m.gravity.x + m.userAcceleration.x) * g
      s.accel.y = (m.gravity.y + m.userAcceleration.y) * g
      s.accel.z = (m.gravity.z + m.userAcceleration.z) * g
      s.gyro.x = m.rotationRate.x
      s.gyro.y = m.rotationRate.y
      s.gyro.z = m.rotationRate.z
      if m.magneticField.accuracy != .uncalibrated {
        s.mag.x = m.magneticField.field.x
        s.mag.y = m.magneticField.field.y
        s.mag.z = m.magneticField.field.z
      }
      self.onSample?(s)
    }
  }

  public func setRate(_ hz: Int) {
    rateHz = hz
    if running { motion.deviceMotionUpdateInterval = 1.0 / Double(hz) }
  }

  public func stop() {
    if running { motion.stopDeviceMotionUpdates() }
    running = false
  }
}
