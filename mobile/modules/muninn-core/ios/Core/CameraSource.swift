// Pure camera mode (§4.2 "两种模式"): AVCaptureSession with lens choice, no pose.
import AVFoundation
import CoreMedia
import Foundation
import simd

public enum Lens: String, CaseIterable {
  case wide, ultraWide = "ultra_wide", telephoto, front

  var deviceType: AVCaptureDevice.DeviceType {
    switch self {
    case .wide, .front: return .builtInWideAngleCamera
    case .ultraWide: return .builtInUltraWideCamera
    case .telephoto: return .builtInTelephotoCamera
    }
  }
  var position: AVCaptureDevice.Position { self == .front ? .front : .back }

  public static func available() -> [Lens] {
    allCases.filter { AVCaptureDevice.default($0.deviceType, for: .video, position: $0.position) != nil }
  }
}

public struct CameraFrame {
  public let pixelBuffer: CVPixelBuffer
  public let timeSeconds: Double
  public let intrinsics: simd_float3x3?
}

public final class CameraSource: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  public let session = AVCaptureSession()
  private let output = AVCaptureVideoDataOutput()
  private let queue = DispatchQueue(label: "imuninn.camera", qos: .userInteractive)
  private var device: AVCaptureDevice?
  public private(set) var running = false
  public private(set) var lens: Lens = .wide
  public private(set) var formatId = ""
  public var onFrame: ((CameraFrame) -> Void)?
  public private(set) var frameCount: UInt64 = 0

  /// Format ids "WxH@fps" for a lens (deduplicated, highest fps per resolution kept first).
  public static func formats(for lens: Lens) -> [String] {
    guard let dev = AVCaptureDevice.default(lens.deviceType, for: .video, position: lens.position) else { return [] }
    var seen = Set<String>()
    var ids: [String] = []
    for f in dev.formats {
      let desc = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
      let sub = CMFormatDescriptionGetMediaSubType(f.formatDescription)
      guard sub == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange else { continue }
      guard desc.width <= 1920 * 2 else { continue }      // keep the list sane; 4K is enough
      for r in f.videoSupportedFrameRateRanges {
        let fps = Int(r.maxFrameRate)
        guard [30, 60, 120].contains(fps) else { continue }
        let id = "\(desc.width)x\(desc.height)@\(fps)"
        if !seen.contains(id) { seen.insert(id); ids.append(id) }
      }
    }
    return ids.sorted { a, b in
      let (aw, af) = parse(a), (bw, bf) = parse(b)
      return aw == bw ? af > bf : aw < bw
    }
  }

  private static func parse(_ id: String) -> (Int, Int) {
    let parts = id.split(separator: "@")
    let w = Int(parts.first?.split(separator: "x").first ?? "0") ?? 0
    let f = Int(parts.last ?? "0") ?? 0
    return (w, f)
  }

  public func start(lens: Lens, formatId: String?, exposureLocked: Bool, focusLocked: Bool) {
    stop()
    guard let dev = AVCaptureDevice.default(lens.deviceType, for: .video, position: lens.position),
          let input = try? AVCaptureDeviceInput(device: dev) else {
      NSLog("[imuninn] camera \(lens) unavailable")
      return
    }
    self.lens = lens
    device = dev
    session.beginConfiguration()
    session.sessionPreset = .inputPriority
    session.inputs.forEach { session.removeInput($0) }
    session.outputs.forEach { session.removeOutput($0) }
    session.addInput(input)
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: queue)
    if session.canAddOutput(output) { session.addOutput(output) }
    if let conn = output.connection(with: .video), conn.isCameraIntrinsicMatrixDeliverySupported {
      conn.isCameraIntrinsicMatrixDeliveryEnabled = true
    }
    session.commitConfiguration()

    do {
      try dev.lockForConfiguration()
      if let id = formatId, let f = Self.pick(dev, id) {
        dev.activeFormat = f.format
        dev.activeVideoMinFrameDuration = CMTime(value: 1, timescale: CMTimeScale(f.fps))
        dev.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: CMTimeScale(f.fps))
        self.formatId = id
      } else {
        let d = CMVideoFormatDescriptionGetDimensions(dev.activeFormat.formatDescription)
        self.formatId = "\(d.width)x\(d.height)@\(Int(dev.activeFormat.videoSupportedFrameRateRanges.first?.maxFrameRate ?? 30))"
      }
      applyLocks(dev, exposureLocked: exposureLocked, focusLocked: focusLocked)
      dev.unlockForConfiguration()
    } catch {
      NSLog("[imuninn] camera config failed: \(error)")
    }
    running = true
    queue.async { self.session.startRunning() }
  }

  private static func pick(_ dev: AVCaptureDevice, _ id: String) -> (format: AVCaptureDevice.Format, fps: Int)? {
    let (w, fps) = parse(id)
    let h = Int(id.split(separator: "@").first?.split(separator: "x").last ?? "0") ?? 0
    for f in dev.formats {
      let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
      guard Int(d.width) == w, Int(d.height) == h,
            CMFormatDescriptionGetMediaSubType(f.formatDescription) == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
            f.videoSupportedFrameRateRanges.contains(where: { Int($0.maxFrameRate) >= fps }) else { continue }
      return (f, fps)
    }
    return nil
  }

  private func applyLocks(_ dev: AVCaptureDevice, exposureLocked: Bool, focusLocked: Bool) {
    if exposureLocked, dev.isExposureModeSupported(.locked) { dev.exposureMode = .locked }
    else if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
    if focusLocked, dev.isFocusModeSupported(.locked) { dev.focusMode = .locked }
    else if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
  }

  public func setExposureLocked(_ locked: Bool) {
    guard let dev = device, (try? dev.lockForConfiguration()) != nil else { return }
    applyLocks(dev, exposureLocked: locked, focusLocked: dev.focusMode == .locked)
    dev.unlockForConfiguration()
  }

  public func setFocusLocked(_ locked: Bool) {
    guard let dev = device, (try? dev.lockForConfiguration()) != nil else { return }
    applyLocks(dev, exposureLocked: dev.exposureMode == .locked, focusLocked: locked)
    dev.unlockForConfiguration()
  }

  public func stop() {
    guard running else { return }
    running = false
    session.stopRunning()
  }

  public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    frameCount &+= 1
    var k: simd_float3x3? = nil
    if let att = CMGetAttachment(sampleBuffer, key: kCMSampleBufferAttachmentKey_CameraIntrinsicMatrix, attachmentModeOut: nil) as? Data,
       att.count == MemoryLayout<simd_float3x3>.size {
      k = att.withUnsafeBytes { $0.load(as: simd_float3x3.self) }
    }
    onFrame?(CameraFrame(pixelBuffer: pb, timeSeconds: CMSampleBufferGetPresentationTimeStamp(sampleBuffer).seconds, intrinsics: k))
  }
}
