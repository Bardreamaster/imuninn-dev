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

    addStream("imu", .imu, .udp, enabled: env.imuAvailable, params: [
      Self.spec("rate_hz", "IMU rate", .int, .immediate, unit: "Hz", min: 10, max: 200, step: 10, current: Self.i(100)),
      Self.spec("raw", "Raw sensors (uncalibrated)", .bool, .immediate, current: Self.b(false)),
    ])

    addStream("ar_pose", .pose, .udp, enabled: env.arAvailable, params: [
      Self.spec("video_format", "AR video format", .enum, .restartSession,
                choices: env.arVideoFormats, current: Self.s(env.arVideoFormats.first ?? "")),
      Self.spec("exposure_locked", "Lock exposure", .bool, .immediate, current: Self.b(false)),
      Self.spec("focus_locked", "Lock focus", .bool, .restartSession, current: Self.b(false)),
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
    ])
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
  public func string(_ stream: String, _ key: String) -> String { param(stream, key)?.s ?? "" }

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
        var effective = MnValue()
        switch spec.kind {
        case .bool:
          guard case .b(let b)? = value.v else { fr.status = .rejected; fr.reason = "expected bool"; result.fields.append(fr); continue }
          effective.b = b; fr.status = .applied
        case .int:
          var requested: Int64
          switch value.v {
          case .i(let i)?: requested = i
          case .f(let f)?: requested = Int64(f.rounded())
          default: fr.status = .rejected; fr.reason = "expected int"; result.fields.append(fr); continue
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
          default: fr.status = .rejected; fr.reason = "expected float"; result.fields.append(fr); continue
          }
          let clamped = min(max(v, spec.min), spec.max)
          fr.status = clamped == v ? .applied : .clamped
          effective.f = clamped
        case .enum, .string:
          guard case .s(let s)? = value.v else { fr.status = .rejected; fr.reason = "expected string"; result.fields.append(fr); continue }
          let choices = dynamicChoices(ps.streamID, key) ?? spec.choices
          if spec.kind == .enum, !choices.contains(s) {
            fr.status = .rejected; fr.reason = "not one of \(choices)"
            result.fields.append(fr); continue
          }
          effective.s = s; fr.status = .applied
        default:
          fr.status = .rejected; fr.reason = "unsupported kind"
          result.fields.append(fr); continue
        }
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

  /// Camera formats depend on the chosen lens; accept any format that lens offers.
  private func dynamicChoices(_ stream: String, _ key: String) -> [String]? {
    guard stream == "rgb", key == "camera_format" else { return nil }
    let lens = streamConfig("rgb")?.params["lens"]?.s ?? "wide"
    return env.cameraFormats[lens]
  }

  public func cameraFormats(for lens: String) -> [String] { env.cameraFormats[lens] ?? [] }
}
