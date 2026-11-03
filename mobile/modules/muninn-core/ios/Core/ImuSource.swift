// CoreMotion IMU source (§5.1). Timestamps share the ARKit time base (seconds since boot).
//
// Two modes:
//  - calibrated (default): CMDeviceMotion — accel = gravity + userAcceleration,
//    gyro = bias-corrected rotationRate, both on one timestamp.
//  - raw: CMAccelerometerData + CMGyroData straight from the sensors (uncalibrated,
//    separate timestamps; a sample is emitted per gyro update with the latest accel).
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
  public private(set) var raw = false
  public var onSample: ((MnImuSample) -> Void)?
  public private(set) var running = false
  private var lastAccel: (x: Double, y: Double, z: Double, t: Double)?
  private static let g = 9.80665

  public init() {}

  public var available: Bool { motion.isDeviceMotionAvailable || (motion.isGyroAvailable && motion.isAccelerometerAvailable) }

  public func start(rateHz: Int, raw: Bool) {
    stop()
    self.rateHz = rateHz
    self.raw = raw
    let interval = 1.0 / Double(rateHz)
    running = true
    if raw {
      guard motion.isGyroAvailable, motion.isAccelerometerAvailable else { return }
      motion.accelerometerUpdateInterval = interval
      motion.gyroUpdateInterval = interval
      motion.startAccelerometerUpdates(to: queue) { [weak self] a, _ in
        guard let a else { return }
        self?.lastAccel = (a.acceleration.x * Self.g, a.acceleration.y * Self.g, a.acceleration.z * Self.g, a.timestamp)
      }
      motion.startGyroUpdates(to: queue) { [weak self] gy, _ in
        guard let self, let gy, let acc = self.lastAccel else { return }
        var s = self.header(time: gy.timestamp)
        s.accel.x = acc.x; s.accel.y = acc.y; s.accel.z = acc.z
        s.gyro.x = gy.rotationRate.x; s.gyro.y = gy.rotationRate.y; s.gyro.z = gy.rotationRate.z
        self.onSample?(s)
      }
    } else {
      guard motion.isDeviceMotionAvailable else { return }
      motion.deviceMotionUpdateInterval = interval
      motion.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: queue) { [weak self] m, err in
        guard let self, let m else {
          if let err { NSLog("[imuninn] imu error: \(err)") }
          return
        }
        var s = self.header(time: m.timestamp)
        s.accel.x = (m.gravity.x + m.userAcceleration.x) * Self.g
        s.accel.y = (m.gravity.y + m.userAcceleration.y) * Self.g
        s.accel.z = (m.gravity.z + m.userAcceleration.z) * Self.g
        s.gyro.x = m.rotationRate.x; s.gyro.y = m.rotationRate.y; s.gyro.z = m.rotationRate.z
        if m.magneticField.accuracy != .uncalibrated {
          s.mag.x = m.magneticField.field.x; s.mag.y = m.magneticField.field.y; s.mag.z = m.magneticField.field.z
        }
        self.onSample?(s)
      }
    }
  }

  private func header(time: TimeInterval) -> MnImuSample {
    var s = MnImuSample()
    s.header.streamID = Self.streamId
    s.header.seq = seq
    seq &+= 1
    s.header.deviceTimeNs = deviceTimeNs(fromSeconds: time)
    return s
  }

  public func setRate(_ hz: Int) {
    rateHz = hz
    guard running else { return }
    let interval = 1.0 / Double(hz)
    if raw {
      motion.accelerometerUpdateInterval = interval
      motion.gyroUpdateInterval = interval
    } else {
      motion.deviceMotionUpdateInterval = interval
    }
  }

  public func stop() {
    if running {
      motion.stopDeviceMotionUpdates()
      motion.stopGyroUpdates()
      motion.stopAccelerometerUpdates()
    }
    running = false
    lastAccel = nil
  }
}
