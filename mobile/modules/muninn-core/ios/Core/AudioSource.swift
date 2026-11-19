// Microphone source, stream "audio" (protocol v6). AVAudioEngine input tap, converted to
// the requested format and cut into fixed-length chunks.
//
// Runs independently of the AR / camera session (neither ARKit nor our AVCaptureSession has
// an audio input), so it works in both modes. Timestamps: AVAudioTime.hostTime is
// mach_absolute_time, the same base as CACurrentMediaTime / ARFrame.timestamp, so audio is
// on the device clock with every other stream. The time of a chunk is the capture time of
// its first frame (input latency subtracted); consecutive chunks advance by sample count and
// are re-anchored to the host time when the two disagree by more than 2 ms.
import AVFoundation
import Foundation

public struct AudioSettings: Equatable {
  public var sampleRate: Double = 48000
  public var float32 = false          // false = PCM s16le
  public var chunkMs: Int = 20
  public var voiceProcessing = false  // true = system AGC / noise suppression / echo cancel
  public init() {}
}

public final class AudioSource {
  public static let streamId = "audio"
  public static let sampleRates = ["8000", "16000", "22050", "24000", "32000", "44100", "48000"]

  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "imuninn.audio", qos: .userInteractive)
  private var converter: AVAudioConverter?
  private var outFormat: AVAudioFormat?
  private var settings = AudioSettings()
  private var pending = Data()
  private var pendingFrames = 0
  private var pendingStart: Double = 0     // device seconds of the first pending frame
  private var seq: UInt64 = 0
  private var interruptionObserver: NSObjectProtocol?
  private var configObserver: NSObjectProtocol?
  private var wantRunning = false

  public private(set) var running = false
  /// Called on the audio queue with a finished chunk.
  public var onChunk: ((MnAudioChunk) -> Void)?
  /// Permission denied / engine failure, for Status.lastError.
  public var onError: ((String) -> Void)?

  public init() {}

  public static var available: Bool { AVAudioSession.sharedInstance().isInputAvailable }

  public func start(_ s: AudioSettings) {
    queue.async {
      self.wantRunning = true
      self.settings = s
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: self.startEngine()
      case .denied: self.onError?("microphone permission denied (Settings > iMuninn > Microphone)")
      default:
        AVAudioSession.sharedInstance().requestRecordPermission { ok in
          self.queue.async {
            guard self.wantRunning else { return }
            if ok { self.startEngine() } else { self.onError?("microphone permission denied") }
          }
        }
      }
    }
  }

  public func stop() {
    queue.async {
      self.wantRunning = false
      self.stopEngine()
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  // MARK: engine (audio queue only)

  private func startEngine() {
    stopEngine()
    let s = settings
    let session = AVAudioSession.sharedInstance()
    do {
      // playAndRecord + mixWithOthers: does not stop other apps' playback; measurement mode
      // turns off the system input processing unless voice processing was asked for.
      try session.setCategory(.playAndRecord, mode: s.voiceProcessing ? .default : .measurement,
                              options: [.mixWithOthers, .defaultToSpeaker, .allowBluetoothA2DP])
      try? session.setPreferredSampleRate(s.sampleRate)
      try? session.setPreferredIOBufferDuration(min(0.02, Double(s.chunkMs) / 1000))
      try session.setActive(true)
    } catch {
      onError?("audio session: \(error.localizedDescription)")
      return
    }
    let input = engine.inputNode
    do { try input.setVoiceProcessingEnabled(s.voiceProcessing) } catch {
      NSLog("[imuninn] voice processing: \(error)")
    }
    let inFormat = input.outputFormat(forBus: 0)
    guard inFormat.sampleRate > 0, inFormat.channelCount > 0,
          let out = AVAudioFormat(commonFormat: s.float32 ? .pcmFormatFloat32 : .pcmFormatInt16,
                                  sampleRate: s.sampleRate, channels: 1, interleaved: true),
          let conv = AVAudioConverter(from: inFormat, to: out) else {
      onError?("audio: unsupported input format \(inFormat)")
      return
    }
    outFormat = out
    converter = conv
    pending = Data(); pendingFrames = 0   // seq keeps counting across restarts
    let latency = session.inputLatency
    let tapFrames = AVAudioFrameCount(max(256, inFormat.sampleRate * Double(s.chunkMs) / 1000))
    input.installTap(onBus: 0, bufferSize: tapFrames, format: inFormat) { [weak self] buf, when in
      // Copy out of the realtime thread's buffer before hopping queues.
      let t = when.isHostTimeValid ? AVAudioTime.seconds(forHostTime: when.hostTime) - latency : CACurrentMediaTime() - latency
      self?.queue.async { self?.process(buf, time: t) }
    }
    engine.prepare()
    do {
      try engine.start()
      running = true
    } catch {
      input.removeTap(onBus: 0)
      onError?("audio engine: \(error.localizedDescription)")
      return
    }
    if interruptionObserver == nil {
      interruptionObserver = NotificationCenter.default.addObserver(
        forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] n in
          guard let self,
                let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                AVAudioSession.InterruptionType(rawValue: raw) == .ended else { return }
          self.queue.async { if self.wantRunning { self.startEngine() } }   // e.g. after a phone call
        }
      // Route / hardware format change (headset plugged in, Bluetooth): the engine stops itself.
      configObserver = NotificationCenter.default.addObserver(
        forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
          guard let self else { return }
          self.queue.async { if self.wantRunning { self.startEngine() } }
        }
    }
  }

  private func stopEngine() {
    if running {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    running = false
    converter = nil
  }

  private func process(_ buf: AVAudioPCMBuffer, time: Double) {
    guard running, let conv = converter, let out = outFormat else { return }
    let ratio = out.sampleRate / buf.format.sampleRate
    let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 64
    guard let dst = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: cap) else { return }
    var fed = false
    var err: NSError?
    conv.convert(to: dst, error: &err) { _, status in
      if fed { status.pointee = .noDataNow; return nil }
      fed = true
      status.pointee = .haveData
      return buf
    }
    guard err == nil, dst.frameLength > 0 else { return }
    let bytesPerFrame = Int(out.streamDescription.pointee.mBytesPerFrame)
    let n = Int(dst.frameLength)
    let rate = out.sampleRate
    // Re-anchor on the host clock if sample counting drifted (or after a hiccup).
    let expected = pendingStart + Double(pendingFrames) / rate
    if pendingFrames == 0 || abs(expected - time) > 0.002 {
      pendingStart = time - Double(pendingFrames) / rate
    }
    if let p = dst.audioBufferList.pointee.mBuffers.mData {
      pending.append(p.assumingMemoryBound(to: UInt8.self), count: n * bytesPerFrame)
      pendingFrames += n
    }
    let chunkFrames = max(1, Int(rate * Double(settings.chunkMs) / 1000))
    while pendingFrames >= chunkFrames {
      var c = MnAudioChunk()
      c.header.streamID = Self.streamId
      c.header.seq = seq
      seq &+= 1
      c.header.deviceTimeNs = deviceTimeNs(fromSeconds: pendingStart)
      c.encoding = settings.float32 ? .pcmF32Le : .pcmS16Le
      c.sampleRate = UInt32(rate)
      c.channels = 1
      c.frameCount = UInt32(chunkFrames)
      let nb = chunkFrames * bytesPerFrame
      c.data = pending.prefix(nb)
      pending = Data(pending.dropFirst(nb))
      pendingFrames -= chunkFrames
      pendingStart += Double(chunkFrames) / rate
      onChunk?(c)
    }
  }
}
