// Orchestrates discovery, control channel, sources, encoder, config and sinks.
// Owns all state; the Expo module is a thin adapter over this class (§4.2).
import CoreVideo
import Foundation
import Network
import QuartzCore
import simd

public struct Status {
  public var connection: String = "idle"          // idle | connecting | ready | failed | cancelled
  public var gatewayName: String = ""
  public var gatewayHost: String = ""
  public var mode: String = "ar"
  public var sessionRunning = false
  public var tracking: String = "none"            // none | limited | normal
  public var poseHz: Double = 0
  public var imuHz: Double = 0
  public var videoHz: Double = 0
  public var videoKbps: Double = 0
  public var udpSent: UInt64 = 0
  public var udpDropped: UInt64 = 0
  public var tcpDropped: UInt64 = 0
  public var encoderDropped: UInt64 = 0
  public var configVersion: UInt32 = 0
  public var remoteControlled = false
  public var recording = false
  public var recordingFile: String = ""
  public var recordingBytes: UInt64 = 0
  public var lastError: String = ""
  public var gateways: [String] = []
}

public extension Notification.Name {
  static let muninnModeChanged = Notification.Name("imuninn.modeChanged")
}

public final class SessionManager {
  public static let shared = SessionManager()

  public let discovery = Discovery()
  public let control = ControlClient()
  public let udp = UdpSink()
  public let tcp = TcpSink()
  public let file = FileSink()
  public let ar = ArSource()
  public let camera = CameraSource()
  public let imu = ImuSource()
  public let encoder = VideoEncoder()
  public let config: ConfigStore

  private let queue = DispatchQueue(label: "imuninn.session")
  private var subscribed: Set<String> = []
  private var sessionRunning = false
  private var remoteControlled = false
  private var lastError = ""
  private var gatewayName = ""
  private var statusTimer: DispatchSourceTimer?
  private var poseCounter = RateCounter()
  private var imuCounter = RateCounter()
  private var videoCounter = RateCounter()
  private var videoBytes = ByteRate()
  private var videoSeq: UInt64 = 0
  private var lastIntrinsics = simd_float3x3(1)
  private var pendingEndpoint: NWEndpoint?
  private var wantConnected = false
  private var reconnectDelay: Double = 1

  public var onStatus: ((Status) -> Void)?
  public var onConfigChanged: ((MnDeviceConfig) -> Void)?
  public var onGateways: (([GatewayEndpoint]) -> Void)?

  private init() {
    var env = ConfigEnvironment()
    env.arAvailable = ArSource.supported
    env.arVideoFormats = ArSource.videoFormats().map { $0.id }
    env.lenses = Lens.available().map { $0.rawValue }
    for l in Lens.available() { env.cameraFormats[l.rawValue] = CameraSource.formats(for: l) }
    env.imuAvailable = imu.available
    config = ConfigStore(env: env)

    discovery.onChange = { [weak self] list in self?.onGateways?(list) }
    control.onState = { [weak self] st in self?.controlStateChanged(st) }
    control.onMessage = { [weak self] msg in self?.queue.async { self?.handle(msg) } }
    ar.onPose = { [weak self] p in self?.publishPose(p) }
    ar.onImage = { [weak self] pb, t, k in self?.handleImage(pb, t, k) }
    camera.onFrame = { [weak self] f in self?.handleImage(f.pixelBuffer, f.timeSeconds, f.intrinsics) }
    imu.onSample = { [weak self] s in self?.publishImu(s) }
    encoder.onFrame = { [weak self] f in self?.publishVideo(f) }
    tcp.onDroppedVideo = { [weak self] in self?.encoder.requestKeyframe() }
    startStatusTimer()
  }

  public var isCameraMode: Bool { config.mode == .camera }

  // MARK: discovery / connection

  public func startDiscovery() { discovery.start() }
  public func stopDiscovery() { discovery.stop() }

  public func connect(to endpoint: NWEndpoint, name: String) {
    queue.async {
      self.gatewayName = name
      self.pendingEndpoint = endpoint
      self.wantConnected = true
      self.reconnectDelay = 1
      self.lastError = ""
      self.control.connect(to: endpoint)
    }
  }

  public func connect(host: String, port: UInt16) {
    guard let p = NWEndpoint.Port(rawValue: port) else { return }
    connect(to: .hostPort(host: NWEndpoint.Host(host), port: p), name: "\(host):\(port)")
  }

  public func disconnect() {
    queue.async {
      self.wantConnected = false
      self.control.cancel()
      self.udp.disconnect()
      self.tcp.disconnect()
      self.subscribed = []
      self.remoteControlled = false
    }
  }

  private func controlStateChanged(_ st: ControlClient.State) {
    queue.async {
      switch st {
      case .ready:
        self.reconnectDelay = 1
        self.sendHello()
      case .failed(let e):
        self.lastError = e
        self.udp.disconnect(); self.tcp.disconnect()
        self.scheduleReconnect()
      case .cancelled:
        self.udp.disconnect(); self.tcp.disconnect()
        self.scheduleReconnect()
      default: break
      }
    }
  }

  /// Reconnect with backoff (1 → 10 s) until `disconnect()` is called (§6.7).
  private func scheduleReconnect() {
    guard wantConnected, let ep = pendingEndpoint else { return }
    let delay = reconnectDelay
    reconnectDelay = min(10, reconnectDelay * 2)
    queue.asyncAfter(deadline: .now() + delay) { [weak self] in
      guard let self, self.wantConnected, self.control.state != .ready else { return }
      self.subscribed = []
      self.control.connect(to: ep)
    }
  }

  private func sendHello() {
    var msg = MnControlMessage()
    msg.hello.device = deviceInfoProto()
    msg.hello.capabilities = config.capabilities(device: msg.hello.device)
    control.send(msg)
  }

  // MARK: control messages

  private func handle(_ msg: MnControlMessage) {
    var reply = MnControlMessage()
    reply.requestID = msg.requestID
    switch msg.body {
    case .welcome(let w)?:
      if let host = control.remoteHost {
        if w.udpPort > 0 { udp.connect(host: host, port: UInt16(w.udpPort)) }
        if w.tcpPort > 0 { tcp.connect(host: host, port: UInt16(w.tcpPort)) }
      }
      if !w.gatewayName.isEmpty { gatewayName = w.gatewayName }
      encoder.requestKeyframe()
      return
    case .getCapabilities?:
      reply.capabilities = config.capabilities(device: deviceInfoProto())
    case .getConfig?:
      reply.config = config.snapshot()
    case .setConfig(let req)?:
      let update = config.apply(req)
      reply.configResult = update.result
      control.send(reply)
      if !update.changes.isEmpty {
        remoteControlled = true
        applyChanges(update)
        broadcastConfig()
      }
      return
    case .subscribe(let s)?:
      if s.unsubscribe { subscribed.subtract(s.streamIds) } else { subscribed.formUnion(s.streamIds) }
      if subscribed.contains("rgb") { encoder.requestKeyframe() }
      return
    case .sessionControl(let sc)?:
      switch sc.action {
      case .start: startSession()
      case .stop: stopSession()
      case .startRecording: startRecording()
      case .stopRecording: stopRecording()
      default: break
      }
      return
    case .timeSyncPing(let ping)?:
      let now = deviceTimeNs(fromSeconds: CACurrentMediaTime())
      reply.timeSyncPong.clientSendNs = ping.clientSendNs
      reply.timeSyncPong.deviceRecvNs = now
      reply.timeSyncPong.deviceSendNs = deviceTimeNs(fromSeconds: CACurrentMediaTime())
    case .lease(let l)?:
      // Single writer not enforced yet; acknowledge so clients can proceed (see ROADMAP).
      reply.lease.action = l.action == .request ? .granted : l.action
      reply.lease.holder = l.holder
    default:
      return
    }
    control.send(reply)
  }

  // MARK: session

  public func startSession() {
    queue.async {
      self.sessionRunning = true
      self.restartSources()
    }
  }

  public func stopSession() {
    queue.async {
      self.sessionRunning = false
      self.ar.stop(); self.camera.stop(); self.imu.stop()
    }
  }

  private func restartSources() {
    ar.stop(); camera.stop(); imu.stop()
    guard sessionRunning else { return }
    encoder.setBitrate(config.int("rgb", "bitrate_kbps") * 1000)
    encoder.setKeyframeInterval(max(1, config.int("rgb", "keyframe_interval")))
    encoder.requestKeyframe()
    if isCameraMode {
      let lens = Lens(rawValue: config.string("rgb", "lens")) ?? .wide
      camera.start(
        lens: lens,
        formatId: config.string("rgb", "camera_format"),
        exposureLocked: config.bool("ar_pose", "exposure_locked"),
        focusLocked: config.bool("ar_pose", "focus_locked")
      )
    } else if config.isEnabled("ar_pose") || config.isEnabled("rgb"), ArSource.supported {
      ar.start(
        videoFormatId: config.string("ar_pose", "video_format"),
        exposureLocked: config.bool("ar_pose", "exposure_locked"),
        focusLocked: config.bool("ar_pose", "focus_locked")
      )
    }
    if config.isEnabled("imu"), imu.available {
      imu.start(rateHz: max(10, config.int("imu", "rate_hz")), raw: config.bool("imu", "raw"))
    }
  }

  /// Local UI edits go through the same path as remote ones (§6.8).
  public func setConfigLocally(_ patch: MnDeviceConfig) -> MnConfigResult {
    var req = MnSetConfig()
    req.patch = patch
    req.baseConfigVersion = 0
    let update = config.apply(req)
    queue.async {
      if !update.changes.isEmpty {
        self.remoteControlled = false
        self.applyChanges(update)
        self.broadcastConfig()
      }
    }
    return update.result
  }

  private func applyChanges(_ update: ConfigUpdate) {
    if update.changes.contains(where: { $0.stream == "" && $0.key == "mode" }) {
      NotificationCenter.default.post(name: .muninnModeChanged, object: nil)
    }
    guard sessionRunning else { return }
    if update.needsRestart {
      restartSources()
      return
    }
    for c in update.changes {
      switch (c.stream, c.key) {
      case ("imu", "rate_hz"): imu.setRate(Int(c.value.i))
      case ("imu", "raw"), ("imu", "enabled"), ("ar_pose", "enabled"), ("rgb", "enabled"): restartSources()
      case ("ar_pose", "exposure_locked"):
        if isCameraMode { camera.setExposureLocked(c.value.b) } else { ar.setExposureLocked(c.value.b) }
      case ("rgb", "bitrate_kbps"): encoder.setBitrate(Int(c.value.i) * 1000)
      case ("rgb", "keyframe_interval"): encoder.setKeyframeInterval(Int(c.value.i))
      default: break
      }
    }
  }

  private func broadcastConfig() {
    var msg = MnControlMessage()
    msg.configChanged.config = config.snapshot()
    control.send(msg)
    onConfigChanged?(config.snapshot())
  }

  // MARK: recording

  public func startRecording() {
    queue.async {
      self.file.start()
      self.encoder.requestKeyframe()
    }
  }

  public func stopRecording() {
    queue.async { self.file.stop() }
  }

  // MARK: data path

  private func stamp(_ header: inout MnHeader) {
    header.protocolVersion = protocolVersion
    header.configVersion = config.snapshot().configVersion
  }

  private func publishPose(_ p: MnPoseSample) {
    poseCounter.tick()
    var p = p
    stamp(&p.header)
    var d = MnDataMessage()
    d.pose = p
    if subscribed.contains(ArSource.poseStreamId) { udp.send(d) }
    if file.isRecording { file.write(d) }
  }

  private func publishImu(_ s: MnImuSample) {
    imuCounter.tick()
    var s = s
    stamp(&s.header)
    var d = MnDataMessage()
    d.imu = s
    if subscribed.contains(ImuSource.streamId) { udp.send(d) }
    if file.isRecording { file.write(d) }
  }

  private func handleImage(_ pb: CVPixelBuffer, _ t: Double, _ k: simd_float3x3?) {
    guard config.isEnabled("rgb"), subscribed.contains("rgb") || file.isRecording else { return }
    if let k { lastIntrinsics = k }
    encoder.encode(pb, timeSeconds: t)
  }

  private func publishVideo(_ f: EncodedFrame) {
    videoCounter.tick()
    videoBytes.add(f.data.count)
    var v = MnVideoFrame()
    v.header.streamID = "rgb"
    v.header.seq = videoSeq
    videoSeq &+= 1
    v.header.deviceTimeNs = deviceTimeNs(fromSeconds: f.timeSeconds)
    stamp(&v.header)
    v.format = .h264Nal
    v.width = UInt32(f.width); v.height = UInt32(f.height)
    v.keyframe = f.keyframe
    v.data = f.data
    let k = lastIntrinsics
    v.intrinsics.width = v.width; v.intrinsics.height = v.height
    v.intrinsics.fx = Double(k.columns.0.x); v.intrinsics.fy = Double(k.columns.1.y)
    v.intrinsics.cx = Double(k.columns.2.x); v.intrinsics.cy = Double(k.columns.2.y)
    v.rotationDeg = (isCameraMode && camera.lens == .front) ? 270 : 90
    var d = MnDataMessage()
    d.video = v
    if subscribed.contains("rgb") { tcp.send(d, droppable: true, keyframe: f.keyframe) }
    if file.isRecording { file.write(d) }
  }

  // MARK: status (throttled to 5 Hz, §4.3)

  private func startStatusTimer() {
    let t = DispatchSource.makeTimerSource(queue: queue)
    t.schedule(deadline: .now() + 0.2, repeating: 0.2)
    t.setEventHandler { [weak self] in self?.emitStatus() }
    t.resume()
    statusTimer = t
  }

  private func emitStatus() {
    var s = Status()
    switch control.state {
    case .idle: s.connection = "idle"
    case .resolving, .connecting: s.connection = "connecting"
    case .ready: s.connection = "ready"
    case .failed: s.connection = "failed"
    case .cancelled: s.connection = "cancelled"
    }
    s.gatewayName = gatewayName
    if let h = control.remoteHost { s.gatewayHost = "\(h)" }
    s.mode = isCameraMode ? "camera" : "ar"
    s.sessionRunning = sessionRunning
    if isCameraMode {
      s.tracking = "none"
    } else {
      switch ar.trackingState {
      case .normal: s.tracking = "normal"
      case .limited: s.tracking = "limited"
      case .notAvailable: s.tracking = "none"
      }
    }
    s.poseHz = poseCounter.rate()
    s.imuHz = imuCounter.rate()
    s.videoHz = videoCounter.rate()
    s.videoKbps = videoBytes.kbps()
    s.udpSent = udp.sent
    s.udpDropped = udp.dropped
    s.tcpDropped = tcp.dropped
    s.encoderDropped = encoder.dropped
    s.configVersion = config.snapshot().configVersion
    s.remoteControlled = remoteControlled
    s.recording = file.isRecording
    s.recordingFile = file.url?.lastPathComponent ?? ""
    s.recordingBytes = file.bytes
    s.lastError = lastError
    s.gateways = discovery.results.map { $0.name }
    onStatus?(s)
  }

  // MARK: helpers

  private func deviceInfoProto() -> MnDeviceInfo {
    let d = DeviceInfo.current()
    var p = MnDeviceInfo()
    p.deviceID = d.deviceId
    p.deviceName = d.deviceName
    p.model = d.model
    p.platform = .ios
    p.osVersion = d.osVersion
    p.protocolVersion = d.protocolVersion
    p.appVersion = d.appVersion
    p.hasLidar_p = d.hasLidar
    return p
  }
}

struct RateCounter {
  private var count = 0
  private var t0 = CACurrentMediaTime()
  private var last: Double = 0
  mutating func tick() { count += 1 }
  mutating func rate() -> Double {
    let now = CACurrentMediaTime()
    let dt = now - t0
    if dt >= 1.0 {
      last = Double(count) / dt
      count = 0
      t0 = now
    }
    return last
  }
}

struct ByteRate {
  private var bytes = 0
  private var t0 = CACurrentMediaTime()
  private var last: Double = 0
  mutating func add(_ n: Int) { bytes += n }
  mutating func kbps() -> Double {
    let now = CACurrentMediaTime()
    let dt = now - t0
    if dt >= 1.0 {
      last = Double(bytes) * 8 / 1000 / dt
      bytes = 0
      t0 = now
    }
    return last
  }
}
