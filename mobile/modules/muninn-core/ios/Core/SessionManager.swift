// Orchestrates the servers, sources, encoder, config and per-client sinks.
// The phone is the server (§6.7): PCs discover it over Bonjour and connect.
// Owns all state; the Expo module is a thin adapter over this class (§4.2).
import AVFoundation
import CoreVideo
import Foundation
import Network
import QuartzCore
import simd
import UIKit

public struct ClientStatus {
  public var id: UInt32
  public var name: String
  public var host: String
  public var subscribed: [String]
  public var udpDropped: UInt64
  public var tcpDropped: UInt64
  public var writer: Bool
}

public struct Status {
  public var server: String = "stopped"           // starting | listening | failed | stopped
  public var serverError: String = ""             // last listener error (shown in the server card)
  public var serviceName: String = ""
  public var addresses: [String] = []             // "en0 10.0.0.5"
  public var controlPort: UInt16 = 0
  public var tcpPort: UInt16 = 0
  public var clients: [ClientStatus] = []
  public var mode: String = "ar"
  public var sessionRunning = false
  public var previewing = false             // sources running for the local preview only
  public var tracking: String = "none"            // none | limited | normal
  public var poseHz: Double = 0
  public var imuHz: Double = 0
  public var depthHz: Double = 0
  public var videoHz: Double = 0
  public var videoKbps: Double = 0
  public var encoderDropped: UInt64 = 0
  public var configVersion: UInt32 = 0
  public var remoteControlled = false
  public var blackScreen = false            // session.black_screen (phone button or remote)
  public var writer: String = ""            // lease holder (client name), "" = free
  public var frameWidth: Int = 0                  // current video format (sensor orientation)
  public var frameHeight: Int = 0
  public var recording = false
  public var recordingFile: String = ""
  public var recordingBytes: UInt64 = 0
  public var lastError: String = ""
}

public extension Notification.Name {
  static let muninnModeChanged = Notification.Name("imuninn.modeChanged")
}

public final class SessionManager {
  public static let shared = SessionManager()
  public static let defaultControlPort: UInt16 = 7420
  public static let defaultTcpPort: UInt16 = 7422

  public let control = ControlServer()
  public let data = DataServer()
  public let file = FileSink()
  public let ar = ArSource()
  public let camera = CameraSource()
  public let imu = ImuSource()
  public let encoder = VideoEncoder()
  public let config: ConfigStore

  private let queue = DispatchQueue(label: "imuninn.session")
  private var sessionRunning = false
  private var previewEnabled = false
  private var remoteControlled = false
  private var lastError = ""
  private var serviceName = ""
  private var writerId: UInt32? = nil
  private var statusTimer: DispatchSourceTimer?
  private var resumeSessionOnForeground = false
  private var healthSeq: UInt64 = 0
  private var lastHealth: Double = 0
  private let startTime = CACurrentMediaTime()
  private var poseCounter = RateCounter()
  private var imuCounter = RateCounter()
  private var videoCounter = RateCounter()
  private var depthCounter = RateCounter()
  private var depthSeq: UInt64 = 0
  private var depthFrameIndex: UInt64 = 0
  private var videoBytes = ByteRate()
  private var videoSeq: UInt64 = 0
  private var lastIntrinsics = simd_float3x3(1)
  /// Snapshot of clients for the hot data path (avoids locking the control queue).
  private var clientList: [Client] = []

  public var onStatus: ((Status) -> Void)?
  public var onConfigChanged: ((MnDeviceConfig) -> Void)?

  private init() {
    var env = ConfigEnvironment()
    env.arAvailable = ArSource.supported
    env.arVideoFormats = ArSource.videoFormats().map { $0.id }
    env.lenses = Lens.available().map { $0.rawValue }
    for l in Lens.available() { env.cameraFormats[l.rawValue] = CameraSource.formats(for: l) }
    env.imuAvailable = imu.available
    env.depthAvailable = ArSource.depthSupported
    env.camera = CameraRanges.probe(AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back))
    config = ConfigStore(env: env)

    control.onConnect = { [weak self] c in self?.queue.async { self?.clientConnected(c) } }
    control.onDisconnect = { [weak self] c in self?.queue.async { self?.clientDisconnected(c) } }
    control.onMessage = { [weak self] c, msg in self?.queue.async { self?.handle(c, msg) } }
    data.onAttach = { [weak self] id, sink in self?.attachData(id: id, sink: sink) ?? false }
    ar.onPose = { [weak self] p in self?.publishPose(p) }
    ar.onImage = { [weak self] pb, t, k in self?.handleImage(pb, t, k) }
    ar.onDepth = { [weak self] d, c, t, k, res in self?.publishDepth(d, c, t, k, res) }
    camera.onFrame = { [weak self] f in self?.handleImage(f.pixelBuffer, f.timeSeconds, f.intrinsics) }
    imu.onSample = { [weak self] s in self?.publishImu(s) }
    encoder.onFrame = { [weak self] f in self?.publishVideo(f) }
    startStatusTimer()
    observeAppLifecycle()
  }

  public var isCameraMode: Bool { config.mode == .camera }

  // MARK: app lifecycle (§11 后台限制): no background capture, but foreground must recover

  private func observeAppLifecycle() {
    let nc = NotificationCenter.default
    nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self else { return }
        self.resumeSessionOnForeground = self.sessionRunning
        // iOS stops the camera anyway; stop cleanly so nothing is half-alive when we come back.
        self.ar.stop(); self.camera.stop(); self.imu.stop()
      }
    }
    nc.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil) { [weak self] _ in
      self?.queue.async {
        guard let self else { return }
        // Sockets and the hardware encoder do not survive suspension; rebuild them all.
        self.control.restart()
        self.data.restart()
        self.clientList = []
        self.encoder.invalidate()
        if self.resumeSessionOnForeground || self.sessionRunning || self.previewEnabled {
          self.restartSources()
        }
        self.resumeSessionOnForeground = false
      }
    }
  }

  // MARK: server lifecycle

  public func startServer(name: String? = nil, controlPort: UInt16 = defaultControlPort, tcpPort: UInt16 = defaultTcpPort) {
    queue.async {
      self.serviceName = name ?? DeviceInfo.current().deviceName
      self.control.start(port: controlPort, serviceName: self.serviceName)
      self.data.start(port: tcpPort)
    }
  }

  public func stopServer() {
    queue.async {
      self.control.stop()
      self.data.stop()
      self.clientList = []
    }
  }

  private func clientConnected(_ c: Client) {
    clientList = Array(control.clients.values)
    NSLog("[imuninn] client \(c.id) connected from \(String(describing: c.remoteHost))")
  }

  private func clientDisconnected(_ c: Client) {
    clientList = Array(control.clients.values)
    if writerId == c.id { releaseLease(broadcast: true) }
    NSLog("[imuninn] client \(c.label) disconnected")
  }

  // MARK: lease (§6.8 控制权): one writer at a time, auto-released on disconnect.

  private var writerName: String {
    guard let id = writerId, let c = control.client(byId: id) else { return "" }
    return c.label
  }

  /// Returns true if `c` may write. A free lease is granted implicitly.
  private func acquireLease(_ c: Client) -> Bool {
    if writerId == nil || writerId == c.id {
      if writerId == nil {
        writerId = c.id
        c.isWriter = true
        var msg = MnControlMessage()
        msg.lease.action = .granted
        msg.lease.holder = c.label
        control.broadcast(msg)
      }
      return true
    }
    return false
  }

  private func releaseLease(broadcast: Bool) {
    if let id = writerId, let c = control.client(byId: id) { c.isWriter = false }
    writerId = nil
    remoteControlled = false
    if broadcast {
      var msg = MnControlMessage()
      msg.lease.action = .release
      msg.lease.holder = ""
      control.broadcast(msg)
    }
  }

  /// Phone UI takes control back: the remote writer gets REVOKED.
  public func takeOver() {
    queue.async {
      guard let id = self.writerId else { return }
      let name = self.writerName
      if let c = self.control.client(byId: id) { c.isWriter = false }
      self.writerId = nil
      self.remoteControlled = false
      var msg = MnControlMessage()
      msg.lease.action = .revoked
      msg.lease.holder = name
      self.control.broadcast(msg)
    }
  }

  private func attachData(id: UInt32, sink: TcpSink) -> Bool {
    var ok = false
    queue.sync {
      guard let c = control.client(byId: id) else { return }
      c.tcp?.disconnect()
      c.tcp = sink
      sink.onDroppedVideo = { [weak self] in self?.encoder.requestKeyframe() }
      sink.onClosed = { [weak c] in c?.tcp = nil }
      encoder.requestKeyframe()
      ok = true
    }
    return ok
  }

  // MARK: control messages

  private func handle(_ c: Client, _ msg: MnControlMessage) {
    var reply = MnControlMessage()
    reply.requestID = msg.requestID
    switch msg.body {
    case .hello(let h)?:
      c.name = h.client.name
      if let host = c.remoteHost, h.udpPort > 0 { c.udp.connect(host: host, port: UInt16(h.udpPort)) }
      reply.welcome.device = deviceInfoProto()
      reply.welcome.capabilities = config.capabilities(device: reply.welcome.device)
      reply.welcome.protocolVersion = protocolVersion
      reply.welcome.tcpPort = UInt32(data.port)
      reply.welcome.clientID = c.id
    case .getCapabilities?:
      reply.capabilities = config.capabilities(device: deviceInfoProto())
    case .getConfig?:
      reply.config = config.snapshot()
    case .setConfig(let req)?:
      guard acquireLease(c) else {
        reply.error.code = 409
        reply.error.message = "config lease held by \(writerName)"
        control.send(reply, to: c)
        return
      }
      let update = config.apply(req)
      reply.configResult = update.result
      control.send(reply, to: c)
      if !update.changes.isEmpty {
        remoteControlled = true
        applyChanges(update)
        broadcastConfig()
      }
      return
    case .subscribe(let s)?:
      if s.unsubscribe { c.subscribed.subtract(s.streamIds) } else { c.subscribed.formUnion(s.streamIds) }
      if c.subscribed.contains("rgb") { encoder.requestKeyframe() }
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
      switch l.action {
      case .request:
        if acquireLease(c) {
          reply.lease.action = .granted; reply.lease.holder = c.label
        } else {
          reply.lease.action = .denied; reply.lease.holder = writerName
        }
      case .release:
        if writerId == c.id { releaseLease(broadcast: true) }
        reply.lease.action = .release; reply.lease.holder = writerName
      default:
        reply.lease.action = .denied; reply.lease.holder = writerName
      }
    default:
      return
    }
    control.send(reply, to: c)
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
      if self.previewEnabled { self.restartSources() } else { self.ar.stop(); self.camera.stop(); self.imu.stop() }
    }
  }

  /// Preview-only: run the camera so the phone shows a picture, send nothing (§4.4).
  public func setPreview(_ enabled: Bool) {
    queue.async {
      self.previewEnabled = enabled
      if !self.sessionRunning { self.restartSources() }
    }
  }

  private func restartSources() {
    ar.stop(); camera.stop(); imu.stop()
    guard sessionRunning || previewEnabled else { return }
    encoder.setBitrate(config.int("rgb", "bitrate_kbps") * 1000)
    encoder.setKeyframeInterval(max(1, config.int("rgb", "keyframe_interval")))
    encoder.requestKeyframe()
    if isCameraMode {
      let lens = Lens(rawValue: config.string("rgb", "lens")) ?? .wide
      camera.start(lens: lens, formatId: config.string("rgb", "camera_format"), camera: config.cameraSettings())
    } else if config.isEnabled("ar_pose") || config.isEnabled("rgb"), ArSource.supported {
      ar.start(
        videoFormatId: config.string("ar_pose", "video_format"),
        camera: config.cameraSettings(),
        depth: config.isEnabled("depth"),
        smoothedDepth: config.bool("depth", "smoothed")
      )
    }
    if sessionRunning, config.isEnabled("imu"), imu.available {
      imu.start(rateHz: max(10, config.int("imu", "rate_hz")), raw: config.bool("imu", "raw"))
    }
    // Preview views re-layout for the (possibly new) format.
    NotificationCenter.default.post(name: .muninnModeChanged, object: nil)
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
    guard sessionRunning || previewEnabled else { return }
    if update.needsRestart {
      restartSources()
      return
    }
    for c in update.changes {
      switch (c.stream, c.key) {
      case ("imu", "rate_hz"): imu.setRate(Int(c.value.i))
      case ("imu", "raw"), ("imu", "enabled"), ("ar_pose", "enabled"), ("rgb", "enabled"), ("depth", "enabled"): restartSources()
      case ("rgb", "bitrate_kbps"): encoder.setBitrate(Int(c.value.i) * 1000)
      case ("rgb", let key) where key != "keyframe_interval" && key != "lens" && key != "camera_format":
        let s = config.cameraSettings()
        if isCameraMode { camera.applyCamera(key: key, s) } else { ar.applyCamera(key: key, s) }
      case ("rgb", "keyframe_interval"): encoder.setKeyframeInterval(Int(c.value.i))
      default: break
      }
    }
  }

  private func broadcastConfig() {
    var msg = MnControlMessage()
    msg.configChanged.config = config.snapshot()
    control.broadcast(msg)
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

  private var anySubscriber: Bool { clientList.contains { !$0.subscribed.isEmpty } }

  private func publishPose(_ p: MnPoseSample) {
    poseCounter.tick()
    guard sessionRunning else { return }
    var p = p
    stamp(&p.header)
    var d = MnDataMessage()
    d.pose = p
    for c in clientList where c.subscribed.contains(ArSource.poseStreamId) { c.udp.send(d) }
    if file.isRecording { file.write(d) }
  }

  private func publishImu(_ s: MnImuSample) {
    imuCounter.tick()
    var s = s
    stamp(&s.header)
    var d = MnDataMessage()
    d.imu = s
    for c in clientList where c.subscribed.contains(ImuSource.streamId) { c.udp.send(d) }
    if file.isRecording { file.write(d) }
  }

  private func handleImage(_ pb: CVPixelBuffer, _ t: Double, _ k: simd_float3x3?) {
    guard sessionRunning, config.isEnabled("rgb") else { return }
    let wanted = file.isRecording || clientList.contains { $0.subscribed.contains("rgb") && $0.tcp != nil }
    guard wanted else { return }
    if let k { lastIntrinsics = k }
    encoder.encode(pb, timeSeconds: t)
  }

  private func publishDepth(_ depth: CVPixelBuffer, _ conf: CVPixelBuffer?, _ t: Double, _ k: simd_float3x3, _ imageRes: CGSize) {
    guard sessionRunning else { return }
    depthFrameIndex &+= 1
    let divisor = max(1, config.int("depth", "rate_divisor"))
    guard depthFrameIndex % UInt64(divisor) == 0 else { return }
    let wanted = file.isRecording || clientList.contains { $0.subscribed.contains("depth") && $0.tcp != nil }
    guard wanted else { return }
    let compress = config.string("depth", "compression") != "none"
    guard let packed = DepthPacker.pack(depth: depth, confidence: conf, compress: compress) else { return }
    depthCounter.tick()
    var d = MnDepthFrame()
    d.header.streamID = "depth"
    d.header.seq = depthSeq
    depthSeq &+= 1
    d.header.deviceTimeNs = deviceTimeNs(fromSeconds: t)
    stamp(&d.header)
    d.width = UInt32(packed.width); d.height = UInt32(packed.height)
    d.compression = packed.compressed ? .lz4 : .none
    d.depthMm = packed.depthMm
    d.confidence = packed.confidence
    // Depth map is a scaled version of the camera image: scale intrinsics accordingly.
    let sx = Double(packed.width) / Double(imageRes.width), sy = Double(packed.height) / Double(imageRes.height)
    d.intrinsics.width = d.width; d.intrinsics.height = d.height
    d.intrinsics.fx = Double(k.columns.0.x) * sx; d.intrinsics.fy = Double(k.columns.1.y) * sy
    d.intrinsics.cx = Double(k.columns.2.x) * sx; d.intrinsics.cy = Double(k.columns.2.y) * sy
    d.rotationDeg = 90
    var m = MnDataMessage()
    m.depth = d
    for c in clientList where c.subscribed.contains("depth") {
      c.tcp?.send(m, droppable: true, keyframe: true)   // independent frames: never block, never skip for resync
    }
    if file.isRecording { file.write(m) }
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
    v.rotationDeg = 90   // verified on iPhone 17 Pro: front and back buffers share the same sensor orientation
    var d = MnDataMessage()
    d.video = v
    for c in clientList where c.subscribed.contains("rgb") {
      c.tcp?.send(d, droppable: true, keyframe: f.keyframe)
    }
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
    let rate = max(0.1, config.double("health", "rate_hz"))
    if config.isEnabled("health"), CACurrentMediaTime() - lastHealth >= 1.0 / rate {
      lastHealth = CACurrentMediaTime()
      publishHealth()
    }
    var s = Status()
    s.server = control.state
    s.serverError = control.lastError
    s.serviceName = serviceName
    s.addresses = NetInfo.ipv4Addresses().map { "\($0.interface) \($0.address)" }
    s.controlPort = control.port
    s.tcpPort = data.port
    s.clients = clientList.map {
      ClientStatus(id: $0.id, name: $0.label, host: $0.remoteHost.map { "\($0)" } ?? "",
                   subscribed: Array($0.subscribed).sorted(), udpDropped: $0.udp.dropped,
                   tcpDropped: $0.tcp?.dropped ?? 0, writer: $0.isWriter)
    }
    s.mode = isCameraMode ? "camera" : "ar"
    s.blackScreen = config.sessionBool("black_screen")
    s.sessionRunning = sessionRunning
    s.previewing = previewEnabled || sessionRunning
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
    s.depthHz = depthCounter.rate()
    s.videoKbps = videoBytes.kbps()
    s.encoderDropped = encoder.dropped
    s.configVersion = config.snapshot().configVersion
    s.remoteControlled = remoteControlled
    s.writer = writerName
    let fid = isCameraMode ? camera.formatId : ar.videoFormatId
    if let wh = fid.split(separator: "@").first?.split(separator: "x"), wh.count == 2,
       let w = Int(wh[0]), let h = Int(wh[1]) { s.frameWidth = w; s.frameHeight = h }
    s.recording = file.isRecording
    s.recordingFile = file.url?.lastPathComponent ?? ""
    s.recordingBytes = file.bytes
    s.lastError = lastError
    onStatus?(s)
  }

  private func publishHealth() {
    let wanted = file.isRecording || clientList.contains { $0.subscribed.contains("health") }
    guard wanted else { return }
    var h = MnDeviceHealth()
    h.header.streamID = "health"
    h.header.seq = healthSeq
    healthSeq &+= 1
    h.header.deviceTimeNs = deviceTimeNs(fromSeconds: CACurrentMediaTime())
    stamp(&h.header)
    switch ProcessInfo.processInfo.thermalState {
    case .nominal: h.thermal = .nominal
    case .fair: h.thermal = .fair
    case .serious: h.thermal = .serious
    case .critical: h.thermal = .critical
    @unknown default: h.thermal = .unspecified
    }
    let dev = UIDevice.current
    if !dev.isBatteryMonitoringEnabled { DispatchQueue.main.sync { dev.isBatteryMonitoringEnabled = true } }
    h.batteryLevel = dev.batteryLevel
    switch dev.batteryState {
    case .unplugged: h.batteryState = .batteryUnplugged
    case .charging: h.batteryState = .batteryCharging
    case .full: h.batteryState = .batteryFull
    default: h.batteryState = .batteryUnspecified
    }
    h.lowPowerMode = ProcessInfo.processInfo.isLowPowerModeEnabled
    h.poseHz = poseCounter.peek(); h.imuHz = imuCounter.peek(); h.videoFps = videoCounter.peek(); h.depthHz = depthCounter.peek()
    h.videoKbps = videoBytes.peek()
    h.encoderDropped = encoder.dropped
    h.uptimeS = CACurrentMediaTime() - startTime
    var d = MnDataMessage()
    d.health = h
    for c in clientList where c.subscribed.contains("health") { c.udp.send(d) }
    if file.isRecording { file.write(d) }
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
  func peek() -> Double { last }
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
  func peek() -> Double { last }
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
