// Self-describing configuration model (§6.8): capabilities, current config,
// validated partial updates. No I/O here; SessionManager applies the results.
import Foundation

public struct AppliedChange {
  public let stream: String        // "" for session-level
  public let key: String
  public let value: MnValue
  public let apply: MnParamSpec.Apply
}

public struct ConfigUpdate {
  public let result: MnConfigResult
  public let changes: [AppliedChange]
  public var needsRestart: Bool { changes.contains { $0.apply == .restartSession } }
}

/// What the hardware offers; filled by SessionManager at startup.
public struct ConfigEnvironment {
  public var arVideoFormats: [String] = []
  public var lenses: [String] = []
  public var cameraFormats: [String: [String]] = [:]   // lens -> format ids
  public var imuAvailable = false
  public var arAvailable = false
  public var depthAvailable = false
  public var camera = CameraRanges()
  public init() {}
}

public final class ConfigStore {
  public private(set) var config = MnDeviceConfig()
  private var specs: [String: [String: MnParamSpec]] = [:]   // stream -> key -> spec
  private var sessionSpecs: [String: MnParamSpec] = [:]
  private var streamDescriptors: [MnStreamDescriptor] = []
  private let env: ConfigEnvironment
  private let lock = NSLock()

  private static func spec(_ key: String, _ label: String, _ kind: MnParamSpec.Kind, _ apply: MnParamSpec.Apply,
                           unit: String = "", min: Double = 0, max: Double = 0, step: Double = 0,
                           choices: [String] = [], current: MnValue) -> MnParamSpec {
    var s = MnParamSpec()
    s.key = key; s.label = label; s.kind = kind; s.apply = apply; s.unit = unit
    s.min = min; s.max = max; s.step = step; s.choices = choices
    s.current = current; s.`default` = current
    return s
  }
  private static func b(_ v: Bool) -> MnValue { var m = MnValue(); m.b = v; return m }
  private static func i(_ v: Int64) -> MnValue { var m = MnValue(); m.i = v; return m }
  private static func s(_ v: String) -> MnValue { var m = MnValue(); m.s = v; return m }
  private static func f(_ v: Double) -> MnValue { var m = MnValue(); m.f = v; return m }

  private func addStream(_ id: String, _ kind: MnStreamKind, _ transport: MnTransport, enabled: Bool, params: [MnParamSpec]) {
    specs[id] = Dictionary(uniqueKeysWithValues: params.map { ($0.key, $0) })
    var d = MnStreamDescriptor()
    d.streamID = id; d.kind = kind; d.transport = transport; d.params = params
    streamDescriptors.append(d)
    var c = MnStreamConfig()
    c.streamID = id; c.enabled = enabled
    for p in params { c.params[p.key] = p.current }
    c.delivery.transport = transport
    c.delivery.dropPolicy = kind == .depth ? .none : .latestOnly
    config.streams.append(c)
  }

  public init(env: ConfigEnvironment) {
    self.env = env
    config.configVersion = 1
    config.mode = env.arAvailable ? .ar : .camera

    sessionSpecs["mode"] = Self.spec("mode", "Session mode", .enum, .restartSession,
                                     choices: ["ar", "camera"], current: Self.s(env.arAvailable ? "ar" : "camera"))
    // Session-level switches other than mode live in DeviceConfig.session_params (v4).
    // black_screen: the app covers the UI in pure black and drops the backlight to minimum
    // after a few seconds idle; capture keeps running. Same switch as the phone's button.
    sessionSpecs["black_screen"] = Self.spec("black_screen", "Black screen while capturing", .bool, .immediate, current: Self.b(false))
    for (key, spec) in sessionSpecs where key != "mode" { config.sessionParams[key] = spec.current }

    addStream("imu", .imu, .udp, enabled: env.imuAvailable, params: [
      Self.spec("rate_hz", "IMU rate", .int, .immediate, unit: "Hz", min: 10, max: 200, step: 10, current: Self.i(100)),
      Self.spec("raw", "Raw sensors (uncalibrated)", .bool, .immediate, current: Self.b(false)),
    ])

    addStream("ar_pose", .pose, .udp, enabled: env.arAvailable, params: [
      Self.spec("video_format", "AR video format", .enum, .restartSession,
                choices: env.arVideoFormats, current: Self.s(env.arVideoFormats.first ?? "")),
    ])

    let wideFormats = env.cameraFormats["wide"] ?? env.cameraFormats.values.first ?? []
    let defaultFormat = wideFormats.first(where: { $0.hasPrefix("1920x1080@30") }) ?? wideFormats.first ?? ""
    addStream("rgb", .video, .tcp, enabled: true, params: [
      Self.spec("lens", "Lens (camera mode only)", .enum, .restartSession,
                choices: env.lenses, current: Self.s(env.lenses.first ?? "wide")),
      Self.spec("camera_format", "Camera format (camera mode only)", .enum, .restartSession,
                choices: wideFormats, current: Self.s(defaultFormat)),
      Self.spec("bitrate_kbps", "H.264 bitrate", .int, .immediate, unit: "kbps", min: 500, max: 20000, step: 500, current: Self.i(4000)),
      Self.spec("keyframe_interval", "Keyframe interval", .int, .immediate, unit: "frames", min: 1, max: 300, step: 1, current: Self.i(60)),
      // --- camera controls (AVCaptureDevice); ranges probed from the wide camera at startup ---
      Self.spec("exposure_mode", "Exposure", .enum, .immediate, choices: ["auto", "locked", "manual"], current: Self.s("auto")),
      Self.spec("iso", "ISO (manual)", .float, .immediate, min: Double(env.camera.isoMin), max: Double(env.camera.isoMax), current: Self.f(100)),
      Self.spec("exposure_ms", "Shutter (manual)", .float, .immediate, unit: "ms", min: env.camera.durationMinMs, max: env.camera.durationMaxMs, current: Self.f(8)),
      Self.spec("exposure_bias", "EV bias", .float, .immediate, unit: "EV", min: Double(env.camera.biasMin), max: Double(env.camera.biasMax), step: 0.5, current: Self.f(0)),
      Self.spec("white_balance_mode", "White balance", .enum, .immediate, choices: ["auto", "locked", "manual"], current: Self.s("auto")),
      Self.spec("wb_temperature_k", "WB temperature (manual)", .float, .immediate, unit: "K", min: 2000, max: 10000, step: 100, current: Self.f(5000)),
      Self.spec("wb_tint", "WB tint (manual)", .float, .immediate, min: -150, max: 150, step: 5, current: Self.f(0)),
      Self.spec("focus_mode", "Focus", .enum, .immediate, choices: ["auto", "locked", "manual"], current: Self.s("auto")),
      Self.spec("lens_position", "Lens position (manual)", .float, .immediate, min: 0, max: 1, step: 0.05, current: Self.f(0.5)),
      Self.spec("zoom", "Zoom (camera mode)", .float, .immediate, unit: "x", min: 1, max: env.camera.zoomMax, step: 0.1, current: Self.f(1)),
      Self.spec("torch", "Torch (camera mode)", .bool, .immediate, current: Self.b(false)),
      Self.spec("hdr", "Video HDR (camera mode)", .bool, .immediate, current: Self.b(false)),
      Self.spec("low_light_boost", "Low-light boost (camera mode)", .bool, .immediate, current: Self.b(false)),
      Self.spec("stabilization", "Stabilization (camera mode; off keeps intrinsics exact)", .enum, .immediate,
                choices: ["off", "standard", "cinematic"], current: Self.s("off")),
    ])

    addStream("health", .health, .udp, enabled: true, params: [
      Self.spec("rate_hz", "Health report rate", .float, .immediate, unit: "Hz", min: 0.1, max: 5, current: Self.f(0.2)),
    ])

    if env.depthAvailable {
      addStream("depth", .depth, .tcp, enabled: false, params: [
        Self.spec("smoothed", "Temporally smoothed", .bool, .restartSession, current: Self.b(false)),
        Self.spec("compression", "Compression", .enum, .immediate, choices: ["lz4", "none"], current: Self.s("lz4")),
        Self.spec("rate_divisor", "Send every Nth frame", .int, .immediate, min: 1, max: 6, step: 1, current: Self.i(1)),
      ])
    }
  }

  // MARK: queries

  public func capabilities(device: MnDeviceInfo) -> MnCapabilities {
    lock.lock(); defer { lock.unlock() }
    var c = MnCapabilities()
    c.device = device
    c.streams = streamDescriptors.map { d in
      var d = d
      d.params = d.params.map { spec in
        var s = spec
        if let cur = streamConfig(d.streamID)?.params[spec.key] { s.current = cur }
        return s
      }
      return d
    }
    c.sessionParams = sessionSpecs.values.map { spec in
      var s = spec
      if spec.key == "mode" { s.current.s = config.mode == .camera ? "camera" : "ar" }
      else if let cur = config.sessionParams[spec.key] { s.current = cur }
      return s
    }
    c.config = config
    return c
  }

  public func snapshot() -> MnDeviceConfig {
    lock.lock(); defer { lock.unlock() }
    return config
  }

  public var mode: MnSessionMode { snapshot().mode }

  public func streamConfig(_ id: String) -> MnStreamConfig? {
    config.streams.first { $0.streamID == id }
  }

  public func isEnabled(_ id: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    return streamConfig(id)?.enabled ?? false
  }

  public func param(_ stream: String, _ key: String) -> MnValue? {
    lock.lock(); defer { lock.unlock() }
    return streamConfig(stream)?.params[key]
  }

  public func bool(_ stream: String, _ key: String) -> Bool { param(stream, key)?.b ?? false }
  public func int(_ stream: String, _ key: String) -> Int { Int(param(stream, key)?.i ?? 0) }
  public func double(_ stream: String, _ key: String) -> Double {
    guard let v = param(stream, key) else { return 0 }
    switch v.v { case .f(let f)?: return f; case .i(let i)?: return Double(i); default: return 0 }
  }
  public func string(_ stream: String, _ key: String) -> String { param(stream, key)?.s ?? "" }

  /// Session-level parameter (DeviceConfig.session_params), e.g. "black_screen".
  public func sessionParam(_ key: String) -> MnValue? {
    lock.lock(); defer { lock.unlock() }
    return config.sessionParams[key]
  }
  public func sessionBool(_ key: String) -> Bool { sessionParam(key)?.b ?? false }

  // MARK: updates (§6.8 steps 3-5)

  public func apply(_ req: MnSetConfig) -> ConfigUpdate {
    lock.lock(); defer { lock.unlock() }
    var result = MnConfigResult()
    var changes: [AppliedChange] = []

    if req.baseConfigVersion != 0, req.baseConfigVersion != config.configVersion {
      var fr = MnConfigResult.FieldResult()
      fr.key = "config_version"; fr.status = .rejected
      fr.reason = "stale base_config_version \(req.baseConfigVersion), current \(config.configVersion)"
      result.fields.append(fr)
      result.configVersion = config.configVersion
      return ConfigUpdate(result: result, changes: [])
    }

    let patch = req.patch
    if patch.mode != .unspecified, patch.mode != config.mode {
      var fr = MnConfigResult.FieldResult()
      fr.key = "session.mode"
      if patch.mode == .ar, !env.arAvailable {
        fr.status = .rejected; fr.reason = "ARKit not supported on this device"
      } else {
        config.mode = patch.mode
        fr.status = .applied; fr.effective.s = patch.mode == .camera ? "camera" : "ar"
        changes.append(AppliedChange(stream: "", key: "mode", value: fr.effective, apply: .restartSession))
      }
      result.fields.append(fr)
    }

    for (key, value) in patch.sessionParams {
      var fr = MnConfigResult.FieldResult()
      fr.key = "session.\(key)"
      guard key != "mode", let spec = sessionSpecs[key] else {
        fr.status = .rejected; fr.reason = key == "mode" ? "set DeviceConfig.mode instead" : "unknown parameter"
        result.fields.append(fr); continue
      }
      guard let effective = Self.validate(spec, value, choices: spec.choices, into: &fr) else { result.fields.append(fr); continue }
      config.sessionParams[key] = effective
      fr.effective = effective
      result.fields.append(fr)
      changes.append(AppliedChange(stream: "", key: key, value: effective, apply: spec.apply))
    }

    for ps in patch.streams {
      guard let idx = config.streams.firstIndex(where: { $0.streamID == ps.streamID }) else {
        var fr = MnConfigResult.FieldResult()
        fr.key = "\(ps.streamID)"; fr.status = .rejected; fr.reason = "unknown stream"
        result.fields.append(fr)
        continue
      }
      if ps.hasEnabled {
        config.streams[idx].enabled = ps.enabled
        var fr = MnConfigResult.FieldResult()
        fr.key = "\(ps.streamID).enabled"; fr.status = .applied; fr.effective.b = ps.enabled
        result.fields.append(fr)
        changes.append(AppliedChange(stream: ps.streamID, key: "enabled", value: fr.effective, apply: .immediate))
      }
      for (key, value) in ps.params {
        var fr = MnConfigResult.FieldResult()
        fr.key = "\(ps.streamID).\(key)"
        guard let spec = specs[ps.streamID]?[key] else {
          fr.status = .rejected; fr.reason = "unknown parameter"
          result.fields.append(fr)
          continue
        }
        if spec.readOnly {
          fr.status = .rejected; fr.reason = "read only"
          result.fields.append(fr)
          continue
        }
        let choices = dynamicChoices(ps.streamID, key) ?? spec.choices
        guard let effective = Self.validate(spec, value, choices: choices, into: &fr) else { result.fields.append(fr); continue }
        config.streams[idx].params[key] = effective
        fr.effective = effective
        result.fields.append(fr)
        changes.append(AppliedChange(stream: ps.streamID, key: key, value: effective, apply: spec.apply))
      }
    }

    if !changes.isEmpty { config.configVersion &+= 1 }
    result.configVersion = config.configVersion
    result.sessionRestarted = changes.contains { $0.apply == .restartSession }
    return ConfigUpdate(result: result, changes: changes)
  }

  /// Type-check, clamp and snap one value against its spec. Fills `fr.status`/`fr.reason`;
  /// returns the effective value, or nil when rejected.
  private static func validate(_ spec: MnParamSpec, _ value: MnValue, choices: [String], into fr: inout MnConfigResult.FieldResult) -> MnValue? {
    var effective = MnValue()
    switch spec.kind {
    case .bool:
      guard case .b(let b)? = value.v else { fr.status = .rejected; fr.reason = "expected bool"; return nil }
      effective.b = b; fr.status = .applied
    case .int:
      var requested: Int64
      switch value.v {
      case .i(let i)?: requested = i
      case .f(let f)?: requested = Int64(f.rounded())
      default: fr.status = .rejected; fr.reason = "expected int"; return nil
      }
      var v = min(max(requested, Int64(spec.min)), Int64(spec.max))
      if spec.step > 0 { v = Int64((Double(v) / spec.step).rounded() * spec.step) }
      fr.status = v == requested ? .applied : .clamped
      effective.i = v
    case .float:
      var v: Double
      switch value.v {
      case .f(let f)?: v = f
      case .i(let i)?: v = Double(i)
      default: fr.status = .rejected; fr.reason = "expected float"; return nil
      }
      let clamped = min(max(v, spec.min), spec.max)
      fr.status = clamped == v ? .applied : .clamped
      effective.f = clamped
    case .enum, .string:
      guard case .s(let s)? = value.v else { fr.status = .rejected; fr.reason = "expected string"; return nil }
      if spec.kind == .enum, !choices.contains(s) { fr.status = .rejected; fr.reason = "not one of \(choices)"; return nil }
      effective.s = s; fr.status = .applied
    default:
      fr.status = .rejected; fr.reason = "unsupported kind"; return nil
    }
    return effective
  }

  /// Camera formats depend on the chosen lens; accept any format that lens offers.
  private func dynamicChoices(_ stream: String, _ key: String) -> [String]? {
    guard stream == "rgb", key == "camera_format" else { return nil }
    let lens = streamConfig("rgb")?.params["lens"]?.s ?? "wide"
    return env.cameraFormats[lens]
  }

  public func cameraFormats(for lens: String) -> [String] { env.cameraFormats[lens] ?? [] }

  /// Current rgb.* camera controls as a struct for CameraControl.
  public func cameraSettings() -> CameraSettings {
    var s = CameraSettings()
    s.exposureMode = string("rgb", "exposure_mode")
    s.iso = Float(double("rgb", "iso")); s.exposureMs = double("rgb", "exposure_ms"); s.exposureBias = Float(double("rgb", "exposure_bias"))
    s.whiteBalanceMode = string("rgb", "white_balance_mode")
    s.wbTemperatureK = Float(double("rgb", "wb_temperature_k")); s.wbTint = Float(double("rgb", "wb_tint"))
    s.focusMode = string("rgb", "focus_mode"); s.lensPosition = Float(double("rgb", "lens_position"))
    s.zoom = double("rgb", "zoom"); s.torch = bool("rgb", "torch"); s.hdr = bool("rgb", "hdr")
    s.lowLightBoost = bool("rgb", "low_light_boost"); s.stabilization = string("rgb", "stabilization")
    return s
  }
}
