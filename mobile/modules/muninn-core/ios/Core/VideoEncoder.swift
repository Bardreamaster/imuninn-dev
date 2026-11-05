// Hardware H.264 encoder (VideoToolbox). One instance encodes once; the Annex-B
// output is fanned out to every sink (§8.3). Recreated when the input size changes.
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

public struct EncodedFrame {
  public let data: Data          // Annex-B NAL units; SPS/PPS prepended on keyframes
  public let keyframe: Bool
  public let timeSeconds: Double
  public let width: Int
  public let height: Int
}

public final class VideoEncoder {
  private var session: VTCompressionSession?
  private var width = 0
  private var height = 0
  private let queue = DispatchQueue(label: "imuninn.encoder", qos: .userInitiated)
  public private(set) var bitrateBps: Int
  public private(set) var keyframeInterval: Int
  private var forceKeyframe = false
  public var onFrame: ((EncodedFrame) -> Void)?
  public private(set) var encoded: UInt64 = 0
  public private(set) var dropped: UInt64 = 0
  private var inFlight = 0

  public init(bitrateBps: Int = 4_000_000, keyframeInterval: Int = 60) {
    self.bitrateBps = bitrateBps
    self.keyframeInterval = keyframeInterval
  }

  deinit { invalidate() }

  public func invalidate() {
    if let s = session {
      VTCompressionSessionCompleteFrames(s, untilPresentationTimeStamp: .invalid)
      VTCompressionSessionInvalidate(s)
    }
    session = nil
  }

  public func requestKeyframe() { forceKeyframe = true }

  public func setBitrate(_ bps: Int) {
    bitrateBps = bps
    if let s = session {
      VTSessionSetProperty(s, key: kVTCompressionPropertyKey_AverageBitRate, value: bps as CFNumber)
      VTSessionSetProperty(s, key: kVTCompressionPropertyKey_DataRateLimits,
                           value: [bps / 8, 1] as CFArray)
    }
  }

  public func setKeyframeInterval(_ frames: Int) {
    keyframeInterval = frames
    if let s = session {
      VTSessionSetProperty(s, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: frames as CFNumber)
    }
  }

  /// Non-blocking. Drops the frame when the encoder is backed up (§8.4).
  public func encode(_ pixelBuffer: CVPixelBuffer, timeSeconds: Double) {
    let w = CVPixelBufferGetWidth(pixelBuffer)
    let h = CVPixelBufferGetHeight(pixelBuffer)
    if session == nil || w != width || h != height {
      recreate(width: w, height: h)
    }
    guard let s = session else { return }
    if inFlight > 3 {
      dropped &+= 1
      return
    }
    inFlight += 1
    var props: CFDictionary? = nil
    if forceKeyframe {
      props = [kVTEncodeFrameOptionKey_ForceKeyFrame: true] as CFDictionary
      forceKeyframe = false
    }
    let pts = CMTime(seconds: timeSeconds, preferredTimescale: 1_000_000_000)
    let status = VTCompressionSessionEncodeFrame(
      s, imageBuffer: pixelBuffer, presentationTimeStamp: pts, duration: .invalid,
      frameProperties: props, infoFlagsOut: nil
    ) { [weak self] status, _, sampleBuffer in
      guard let self else { return }
      self.inFlight -= 1
      guard status == noErr, let sb = sampleBuffer else { return }
      self.emit(sb)
    }
    if status != noErr {
      inFlight -= 1
      dropped &+= 1
      // kVTInvalidSessionErr: the hardware encoder session died (app was backgrounded).
      if status == kVTInvalidSessionErr {
        NSLog("[imuninn] encoder session invalid; recreating")
        invalidate()
        inFlight = 0
      }
    }
  }

  private func recreate(width w: Int, height h: Int) {
    invalidate()
    width = w; height = h
    var s: VTCompressionSession?
    let attrs: [CFString: Any] = [
      kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    let status = VTCompressionSessionCreate(
      allocator: nil, width: Int32(w), height: Int32(h), codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil, imageBufferAttributes: attrs as CFDictionary,
      compressedDataAllocator: nil, outputCallback: nil, refcon: nil, compressionSessionOut: &s
    )
    guard status == noErr, let sess = s else {
      NSLog("[imuninn] VTCompressionSessionCreate failed: \(status)")
      return
    }
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_Main_AutoLevel)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: keyframeInterval as CFNumber)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_AverageBitRate, value: bitrateBps as CFNumber)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_DataRateLimits, value: [bitrateBps / 8, 1] as CFArray)
    VTSessionSetProperty(sess, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: 60 as CFNumber)
    VTCompressionSessionPrepareToEncodeFrames(sess)
    session = sess
    forceKeyframe = true
  }

  // MARK: AVCC -> Annex B

  private func emit(_ sb: CMSampleBuffer) {
    guard let fmt = CMSampleBufferGetFormatDescription(sb),
          let block = CMSampleBufferGetDataBuffer(sb) else { return }
    let keyframe: Bool = {
      guard let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[CFString: Any]],
            let first = arr.first else { return true }
      return !(first[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
    }()
    var out = Data()
    let startCode: [UInt8] = [0, 0, 0, 1]
    if keyframe {
      var count = 0
      CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: 0, parameterSetPointerOut: nil,
                                                         parameterSetSizeOut: nil, parameterSetCountOut: &count, nalUnitHeaderLengthOut: nil)
      for i in 0..<count {
        var ptr: UnsafePointer<UInt8>? = nil
        var size = 0
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, parameterSetIndex: i, parameterSetPointerOut: &ptr,
                                                           parameterSetSizeOut: &size, parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil)
        if let ptr {
          out.append(contentsOf: startCode)
          out.append(ptr, count: size)
        }
      }
    }
    var length = 0
    var dataPtr: UnsafeMutablePointer<CChar>? = nil
    guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPtr) == noErr,
          let base = dataPtr else { return }
    var offset = 0
    base.withMemoryRebound(to: UInt8.self, capacity: length) { p in
      while offset + 4 <= length {
        let nalLen = Int(UInt32(p[offset]) << 24 | UInt32(p[offset + 1]) << 16 | UInt32(p[offset + 2]) << 8 | UInt32(p[offset + 3]))
        offset += 4
        guard offset + nalLen <= length else { break }
        out.append(contentsOf: startCode)
        out.append(p + offset, count: nalLen)
        offset += nalLen
      }
    }
    encoded &+= 1
    let pts = CMSampleBufferGetPresentationTimeStamp(sb).seconds
    onFrame?(EncodedFrame(data: out, keyframe: keyframe, timeSeconds: pts, width: width, height: height))
  }
}
