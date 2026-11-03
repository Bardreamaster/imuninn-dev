// Everything AVCaptureDevice lets us adjust at runtime (§5.1, §6.8), exposed as
// `rgb.*` parameters. Works on the AR session's capture device
// (ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera, iOS 16+)
// and on the pure-camera-mode device alike. Zoom / stabilization / HDR only apply
// in camera mode (ARKit owns those).
import AVFoundation
import Foundation

public struct CameraRanges {
  public var isoMin: Float = 25, isoMax: Float = 1600
  public var durationMinMs: Double = 0.02, durationMaxMs: Double = 1000
  public var biasMin: Float = -8, biasMax: Float = 8
  public var zoomMax: Double = 1
  public var hasTorch = false
  public var hdrSupported = false
  public var lowLightSupported = false
  public var wbGainsMax: Float = 4

  public static func probe(_ dev: AVCaptureDevice?) -> CameraRanges {
    var r = CameraRanges()
    guard let d = dev else { return r }
    let f = d.activeFormat
    r.isoMin = f.minISO; r.isoMax = f.maxISO
    r.durationMinMs = CMTimeGetSeconds(f.minExposureDuration) * 1000
    r.durationMaxMs = min(1000, CMTimeGetSeconds(f.maxExposureDuration) * 1000)
    r.biasMin = d.minExposureTargetBias; r.biasMax = d.maxExposureTargetBias
    r.zoomMax = min(10, Double(d.maxAvailableVideoZoomFactor))
    r.hasTorch = d.hasTorch
    r.hdrSupported = f.isVideoHDRSupported
    r.lowLightSupported = d.isLowLightBoostSupported
    r.wbGainsMax = d.maxWhiteBalanceGain
    return r
  }
}

/// Snapshot of the rgb.* camera parameters (strings/numbers straight from the config).
public struct CameraSettings {
  public var exposureMode = "auto"        // auto | locked | manual
  public var iso: Float = 100
  public var exposureMs: Double = 8
  public var exposureBias: Float = 0
  public var whiteBalanceMode = "auto"    // auto | locked | manual
  public var wbTemperatureK: Float = 5000
  public var wbTint: Float = 0
  public var focusMode = "auto"           // auto | locked | manual
  public var lensPosition: Float = 0.5
  public var zoom: Double = 1
  public var torch = false
  public var hdr = false
  public var lowLightBoost = false
  public var stabilization = "off"        // off | standard | cinematic
  public init() {}
}

public enum CameraControl {
  /// Apply all settings (used at session start). `cameraMode` enables AVCapture-only knobs.
  public static func applyAll(_ s: CameraSettings, to dev: AVCaptureDevice, connection: AVCaptureConnection?, cameraMode: Bool) {
    do {
      try dev.lockForConfiguration()
      defer { dev.unlockForConfiguration() }
      applyExposure(s, dev)
      applyWhiteBalance(s, dev)
      applyFocus(s, dev)
      if cameraMode {
        applyZoom(s, dev)
        applyTorch(s, dev)
        applyHDR(s, dev)
        applyLowLight(s, dev)
      }
    } catch {
      NSLog("[imuninn] camera lockForConfiguration failed: \(error)")
    }
    if cameraMode, let c = connection { applyStabilization(s, c) }
  }

  /// Apply one changed key; returns false if the key is not a camera parameter.
  @discardableResult
  public static func apply(key: String, _ s: CameraSettings, to dev: AVCaptureDevice, connection: AVCaptureConnection?, cameraMode: Bool) -> Bool {
    let exposureKeys: Set<String> = ["exposure_mode", "iso", "exposure_ms", "exposure_bias"]
    let wbKeys: Set<String> = ["white_balance_mode", "wb_temperature_k", "wb_tint"]
    let focusKeys: Set<String> = ["focus_mode", "lens_position"]
    let camOnly: Set<String> = ["zoom", "torch", "hdr", "low_light_boost", "stabilization"]
    guard exposureKeys.contains(key) || wbKeys.contains(key) || focusKeys.contains(key) || camOnly.contains(key) else { return false }
    if camOnly.contains(key), !cameraMode { return true }   // ARKit owns these; accept silently
    if key == "stabilization" {
      if let c = connection { applyStabilization(s, c) }
      return true
    }
    do {
      try dev.lockForConfiguration()
      defer { dev.unlockForConfiguration() }
      if exposureKeys.contains(key) { applyExposure(s, dev) }
      if wbKeys.contains(key) { applyWhiteBalance(s, dev) }
      if focusKeys.contains(key) { applyFocus(s, dev) }
      switch key {
      case "zoom": applyZoom(s, dev)
      case "torch": applyTorch(s, dev)
      case "hdr": applyHDR(s, dev)
      case "low_light_boost": applyLowLight(s, dev)
      default: break
      }
    } catch {
      NSLog("[imuninn] camera lockForConfiguration failed: \(error)")
    }
    return true
  }

  // MARK: individual groups (device must be locked)

  private static func applyExposure(_ s: CameraSettings, _ d: AVCaptureDevice) {
    switch s.exposureMode {
    case "locked":
      if d.isExposureModeSupported(.locked) { d.exposureMode = .locked }
    case "manual":
      guard d.isExposureModeSupported(.custom) else { break }
      let f = d.activeFormat
      let iso = min(max(s.iso, f.minISO), f.maxISO)
      let dur = CMTime(seconds: min(max(s.exposureMs / 1000, CMTimeGetSeconds(f.minExposureDuration)),
                                    CMTimeGetSeconds(f.maxExposureDuration)), preferredTimescale: 1_000_000)
      d.setExposureModeCustom(duration: dur, iso: iso, completionHandler: nil)
    default:
      if d.isExposureModeSupported(.continuousAutoExposure) { d.exposureMode = .continuousAutoExposure }
    }
    let bias = min(max(s.exposureBias, d.minExposureTargetBias), d.maxExposureTargetBias)
    if abs(d.exposureTargetBias - bias) > 0.01 { d.setExposureTargetBias(bias, completionHandler: nil) }
  }

  private static func applyWhiteBalance(_ s: CameraSettings, _ d: AVCaptureDevice) {
    switch s.whiteBalanceMode {
    case "locked":
      if d.isWhiteBalanceModeSupported(.locked) { d.whiteBalanceMode = .locked }
    case "manual":
      guard d.isWhiteBalanceModeSupported(.locked), d.isLockingWhiteBalanceWithCustomDeviceGainsSupported else { break }
      let tt = AVCaptureDevice.WhiteBalanceTemperatureAndTintValues(temperature: s.wbTemperatureK, tint: s.wbTint)
      var g = d.deviceWhiteBalanceGains(for: tt)
      let maxG = d.maxWhiteBalanceGain
      g.redGain = min(max(g.redGain, 1), maxG)
      g.greenGain = min(max(g.greenGain, 1), maxG)
      g.blueGain = min(max(g.blueGain, 1), maxG)
      d.setWhiteBalanceModeLocked(with: g, completionHandler: nil)
    default:
      if d.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { d.whiteBalanceMode = .continuousAutoWhiteBalance }
    }
  }

  private static func applyFocus(_ s: CameraSettings, _ d: AVCaptureDevice) {
    switch s.focusMode {
    case "locked":
      if d.isFocusModeSupported(.locked) { d.focusMode = .locked }
    case "manual":
      if d.isLockingFocusWithCustomLensPositionSupported {
        d.setFocusModeLocked(lensPosition: min(max(s.lensPosition, 0), 1), completionHandler: nil)
      }
    default:
      if d.isFocusModeSupported(.continuousAutoFocus) { d.focusMode = .continuousAutoFocus }
    }
  }

  private static func applyZoom(_ s: CameraSettings, _ d: AVCaptureDevice) {
    let z = CGFloat(min(max(s.zoom, 1), Double(d.maxAvailableVideoZoomFactor)))
    if abs(d.videoZoomFactor - z) > 0.001 { d.videoZoomFactor = z }
  }

  private static func applyTorch(_ s: CameraSettings, _ d: AVCaptureDevice) {
    guard d.hasTorch, d.isTorchModeSupported(s.torch ? .on : .off) else { return }
    d.torchMode = s.torch ? .on : .off
  }

  private static func applyHDR(_ s: CameraSettings, _ d: AVCaptureDevice) {
    guard d.activeFormat.isVideoHDRSupported else { return }
    d.automaticallyAdjustsVideoHDREnabled = false
    d.isVideoHDREnabled = s.hdr
  }

  private static func applyLowLight(_ s: CameraSettings, _ d: AVCaptureDevice) {
    guard d.isLowLightBoostSupported else { return }
    d.automaticallyEnablesLowLightBoostWhenAvailable = s.lowLightBoost
  }

  private static func applyStabilization(_ s: CameraSettings, _ c: AVCaptureConnection) {
    guard c.isVideoStabilizationSupported else { return }
    switch s.stabilization {
    case "standard": c.preferredVideoStabilizationMode = .standard
    case "cinematic": c.preferredVideoStabilizationMode = .cinematic
    default: c.preferredVideoStabilizationMode = .off   // off keeps intrinsics valid
    }
  }
}
