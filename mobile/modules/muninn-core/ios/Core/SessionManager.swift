// Orchestrates discovery, control channel, sources, config and the UDP sink.
// Owns all state; the Expo module is a thin adapter over this class (§4.2).
import Foundation
import Network
import QuartzCore

public struct Status {
  public var connection: String = "idle"          // idle | connecting | ready | failed | cancelled
  public var gatewayName: String = ""
  public var gatewayHost: String = ""
  public var sessionRunning = false
  public var tracking: String = "none"            // none | limited | normal
  public var poseHz: Double = 0
  public var imuHz: Double = 0
  public var udpSent: UInt64 = 0
  public var udpDropped: UInt64 = 0
  public var configVersion: UInt32 = 0
  public var remoteControlled = false
  public var lastError: String = ""
  public var gateways: [String] = []
}

public final class SessionManager {
  public static let shared = SessionManager()

  public let discovery = Discovery()
  public let control = ControlClient()
  public let udp = UdpSink()
  public let ar = ArSource()
  public let imu = ImuSource()
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
  private var pendingEndpoint: NWEndpoint?

  public var onStatus: ((Status) -> Void)?
  public var onConfigChanged: ((MnDeviceConfig) -> Void)?
  public var onGateways: (([GatewayEndpoint]) -> Void)?

  private init() {
    config = ConfigStore(
      videoFormatIds: ArSource.videoFormats().map { $0.id },
      imuAvailable: imu.available,
      arAvailable: ArSource.supported
    )
    discovery.onChange = { [weak self] list in self?.onGateways?(list) }
    control.onState = { [weak self] st in self?.controlStateChanged(st) }
    control.onMessage = { [weak self] msg in self?.queue.async { self?.handle(msg) } }
    ar.onPose = { [weak self] p in self?.publishPose(p) }
    imu.onSample = { [weak self] s in self?.publishImu(s) }
    startStatusTimer()
  }

  // MARK: discovery / connection

  public func startDiscovery() { discovery.start() }
  public func stopDiscovery() { discovery.stop() }

  public func connect(to endpoint: NWEndpoint, name: String) {
    queue.async {
      self.gatewayName = name
      self.pendingEndpoint = endpoint
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
      self.control.cancel()
      self.udp.disconnect()
      self.subscribed = []
      self.remoteControlled = false
    }
  }

  private func controlStateChanged(_ st: ControlClient.State) {
    queue.async {
      switch st {
      case .ready:
        self.sendHello()
      case .failed(let e):
        self.lastError = e
        self.udp.disconnect()
      case .cancelled:
        self.udp.disconnect()
      default: break
      }
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
      if let host = control.remoteHost, w.udpPort > 0 {
        udp.connect(host: host, port: UInt16(w.udpPort))
      }
      if w.gatewayName.isEmpty == false { gatewayName = w.gatewayName }
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
      return
    case .sessionControl(let sc)?:
      switch sc.action {
      case .start: startSession()
      case .stop: stopSession()
      default: break
      }
      return
    case .timeSyncPing(let ping)?:
      let now = deviceTimeNs(fromSeconds: CACurrentMediaTime())
      reply.timeSyncPong.clientSendNs = ping.clientSendNs
      reply.timeSyncPong.deviceRecvNs = now
      reply.timeSyncPong.deviceSendNs = deviceTimeNs(fromSeconds: CACurrentMediaTime())
    case .lease(let l)?:
      // M1: single writer not enforced; acknowledge so clients can proceed.
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
      self.ar.stop()
      self.imu.stop()
    }
  }

  private func restartSources() {
    ar.stop(); imu.stop()
    guard sessionRunning else { return }
    if config.isEnabled("ar_pose"), ArSource.supported {
      ar.start(
        videoFormatId: config.string("ar_pose", "video_format"),
        exposureLocked: config.bool("ar_pose", "exposure_locked"),
        focusLocked: config.bool("ar_pose", "focus_locked")
      )
    }
    if config.isEnabled("imu"), imu.available {
      imu.start(rateHz: max(10, config.int("imu", "rate_hz")))
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
    guard sessionRunning else { return }
    if update.needsRestart {
      restartSources()
      return
    }
    for c in update.changes {
      switch (c.stream, c.key) {
      case ("imu", "rate_hz"): imu.setRate(Int(c.value.i))
      case ("ar_pose", "exposure_locked"): ar.setExposureLocked(c.value.b)
      case ("imu", "enabled"), ("ar_pose", "enabled"): restartSources()
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

  // MARK: data path

  private func publishPose(_ p: MnPoseSample) {
    poseCounter.tick()
    guard subscribed.contains(ArSource.poseStreamId) else { return }
    var p = p
    p.header.protocolVersion = protocolVersion
    p.header.configVersion = config.snapshot().configVersion
    var d = MnDataMessage()
    d.pose = p
    udp.send(d)
  }

  private func publishImu(_ s: MnImuSample) {
    imuCounter.tick()
    guard subscribed.contains(ImuSource.streamId) else { return }
    var s = s
    s.header.protocolVersion = protocolVersion
    s.header.configVersion = config.snapshot().configVersion
    var d = MnDataMessage()
    d.imu = s
    udp.send(d)
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
    case .connecting: s.connection = "connecting"
    case .ready: s.connection = "ready"
    case .failed: s.connection = "failed"
    case .cancelled: s.connection = "cancelled"
    }
    s.gatewayName = gatewayName
    if let h = control.remoteHost { s.gatewayHost = "\(h)" }
    s.sessionRunning = sessionRunning
    switch ar.trackingState {
    case .normal: s.tracking = "normal"
    case .limited: s.tracking = "limited"
    case .notAvailable: s.tracking = "none"
    }
    s.poseHz = poseCounter.rate()
    s.imuHz = imuCounter.rate()
    s.udpSent = udp.sent
    s.udpDropped = udp.dropped
    s.configVersion = config.snapshot().configVersion
    s.remoteControlled = remoteControlled
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
