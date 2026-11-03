// ARKit world-tracking source: pose + intrinsics every frame (§5.1, §5.4).
import ARKit
import AVFoundation
import Foundation
import simd

public struct VideoFormatChoice {
  public let id: String        // "1920x1440@60"
  public let format: ARConfiguration.VideoFormat
}

public final class ArSource: NSObject, ARSessionDelegate {
  public static let poseStreamId = "ar_pose"

  public let session = ARSession()
  private let delegateQueue = DispatchQueue(label: "imuninn.ar", qos: .userInteractive)
  private var seq: UInt64 = 0
  public private(set) var running = false
  public private(set) var trackingState: ARCamera.TrackingState = .notAvailable
  public private(set) var lastFrameTime: TimeInterval = 0
  public private(set) var frameCount: UInt64 = 0

  public var onPose: ((MnPoseSample) -> Void)?
  /// Captured image for the video pipeline. The buffer must be consumed promptly (§8.5).
  public var onImage: ((CVPixelBuffer, Double, simd_float3x3) -> Void)?
  /// LiDAR depth (metres, Float32) + confidence (uint8) + camera intrinsics at image resolution.
  public var onDepth: ((CVPixelBuffer, CVPixelBuffer?, Double, simd_float3x3, CGSize) -> Void)?
  public private(set) var depthEnabled = false
  public private(set) var depthSmoothed = false
  public var onTracking: ((ARCamera.TrackingState) -> Void)?

  public private(set) var videoFormatId: String
  public private(set) var exposureLocked = false
  public private(set) var focusLocked = false

  public override init() {
    videoFormatId = Self.videoFormats().first?.id ?? ""
    super.init()
    session.delegate = self
    session.delegateQueue = delegateQueue
  }

  public static var supported: Bool { ARWorldTrackingConfiguration.isSupported }
  public static var depthSupported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

  public static func videoFormats() -> [VideoFormatChoice] {
    guard supported else { return [] }
    var seen = Set<String>()
    return ARWorldTrackingConfiguration.supportedVideoFormats.compactMap { f in
      let id = "\(Int(f.imageResolution.width))x\(Int(f.imageResolution.height))@\(f.framesPerSecond)"
      guard !seen.contains(id) else { return nil }
      seen.insert(id)
      return VideoFormatChoice(id: id, format: f)
    }
  }

  // MARK: control

  public func start(videoFormatId: String?, exposureLocked: Bool, focusLocked: Bool,
                    depth: Bool = false, smoothedDepth: Bool = false) {
    let config = ARWorldTrackingConfiguration()
    depthEnabled = depth && Self.depthSupported
    depthSmoothed = smoothedDepth
    if depthEnabled {
      config.frameSemantics.insert(smoothedDepth ? .smoothedSceneDepth : .sceneDepth)
    }
    if let id = videoFormatId, let choice = Self.videoFormats().first(where: { $0.id == id }) {
      config.videoFormat = choice.format
      self.videoFormatId = id
    }
    config.isAutoFocusEnabled = !focusLocked
    config.worldAlignment = .gravity
    seq = 0
    running = true
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
    self.focusLocked = focusLocked
    setExposureLocked(exposureLocked)
  }

  public func stop() {
    session.pause()
    running = false
  }

  /// iOS 16+: adjust the capture device ARKit is using (§5.1).
  public func setExposureLocked(_ locked: Bool) {
    exposureLocked = locked
    guard #available(iOS 16.0, *),
          let device = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera else { return }
    do {
      try device.lockForConfiguration()
      if locked, device.isExposureModeSupported(.locked) {
        device.exposureMode = .locked
      } else if device.isExposureModeSupported(.continuousAutoExposure) {
        device.exposureMode = .continuousAutoExposure
      }
      device.unlockForConfiguration()
    } catch {
      NSLog("[imuninn] exposure lock failed: \(error)")
    }
  }

  public func setFocusLocked(_ locked: Bool) {
    focusLocked = locked
    guard #available(iOS 16.0, *),
          let device = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera else { return }
    do {
      try device.lockForConfiguration()
      if locked, device.isFocusModeSupported(.locked) {
        device.focusMode = .locked
      } else if device.isFocusModeSupported(.continuousAutoFocus) {
        device.focusMode = .continuousAutoFocus
      }
      device.unlockForConfiguration()
    } catch {
      NSLog("[imuninn] focus lock failed: \(error)")
    }
  }

  // MARK: ARSessionDelegate (do not retain `frame`, §8.5)

  public func session(_ session: ARSession, didUpdate frame: ARFrame) {
    frameCount &+= 1
    lastFrameTime = frame.timestamp
    let cam = frame.camera
    var p = MnPoseSample()
    p.header.streamID = Self.poseStreamId
    p.header.seq = seq
    seq &+= 1
    p.header.deviceTimeNs = deviceTimeNs(fromSeconds: frame.timestamp)
    let t = cam.transform
    p.position.x = Double(t.columns.3.x)
    p.position.y = Double(t.columns.3.y)
    p.position.z = Double(t.columns.3.z)
    let q = simd_quatf(t)
    p.orientation.x = Double(q.imag.x)
    p.orientation.y = Double(q.imag.y)
    p.orientation.z = Double(q.imag.z)
    p.orientation.w = Double(q.real)
    switch cam.trackingState {
    case .normal: p.tracking = .normal
    case .limited: p.tracking = .limited
    case .notAvailable: p.tracking = .notAvailable
    }
    let k = cam.intrinsics
    p.intrinsics.width = UInt32(frame.camera.imageResolution.width)
    p.intrinsics.height = UInt32(frame.camera.imageResolution.height)
    p.intrinsics.fx = Double(k.columns.0.x)
    p.intrinsics.fy = Double(k.columns.1.y)
    p.intrinsics.cx = Double(k.columns.2.x)
    p.intrinsics.cy = Double(k.columns.2.y)
    onPose?(p)
    onImage?(frame.capturedImage, frame.timestamp, k)
    if depthEnabled, let d = depthSmoothed ? frame.smoothedSceneDepth : frame.sceneDepth {
      onDepth?(d.depthMap, d.confidenceMap, frame.timestamp, k, cam.imageResolution)
    }
  }

  public func session(_ session: ARSession, cameraDidChangeTrackingState camera: ARCamera) {
    trackingState = camera.trackingState
    onTracking?(camera.trackingState)
  }

  public func session(_ session: ARSession, didFailWithError error: Error) {
    NSLog("[imuninn] ar session failed: \(error)")
    running = false
  }

  public func sessionWasInterrupted(_ session: ARSession) {
    NSLog("[imuninn] ar session interrupted")
  }
}
