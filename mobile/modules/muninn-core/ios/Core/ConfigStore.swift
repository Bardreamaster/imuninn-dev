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

public final class ConfigStore {
  public private(set) var config = MnDeviceConfig()
  private var specs: [String: [String: MnParamSpec]] = [:]   // stream -> key -> spec
  private var sessionSpecs: [String: MnParamSpec] = [:]
  private var streamDescriptors: [MnStreamDescriptor] = []
  private let lock = NSLock()

  public init(videoFormatIds: [String], imuAvailable: Bool, arAvailable: Bool) {
    config.configVersion = 1
    config.mode = .ar

    // session.mode
    var mode = MnParamSpec()
    mode.key = "mode"; mode.label = "Session mode"; mode.kind = .enum; mode.apply = .restartSession
    mode.choices = ["ar", "camera"]
    mode.current.s = "ar"; mode.`default`.s = "ar"
    sessionSpecs["mode"] = mode

    // imu
    var imuRate = MnParamSpec()
    imuRate.key = "rate_hz"; imuRate.label = "IMU rate"; imuRate.unit = "Hz"; imuRate.kind = .int
    imuRate.apply = .immediate; imuRate.min = 10; imuRate.max = 200; imuRate.step = 10
    imuRate.current.i = 100; imuRate.`default`.i = 100
    specs["imu"] = ["rate_hz": imuRate]
    var imuDesc = MnStreamDescriptor()
    imuDesc.streamID = "imu"; imuDesc.kind = .imu; imuDesc.transport = .udp
    imuDesc.params = [imuRate]
    streamDescriptors.append(imuDesc)
    var imuCfg = MnStreamConfig()
    imuCfg.streamID = "imu"; imuCfg.enabled = imuAvailable
    imuCfg.params["rate_hz"] = imuRate.current
    imuCfg.delivery.transport = .udp; imuCfg.delivery.dropPolicy = .latestOnly
    config.streams.append(imuCfg)

    // ar_pose
    var fmt = MnParamSpec()
    fmt.key = "video_format"; fmt.label = "Video format"; fmt.kind = .enum; fmt.apply = .restartSession
    fmt.choices = videoFormatIds
    fmt.current.s = videoFormatIds.first ?? ""; fmt.`default`.s = fmt.current.s
    var exp = MnParamSpec()
    exp.key = "exposure_locked"; exp.label = "Lock exposure"; exp.kind = .bool; exp.apply = .immediate
    exp.current.b = false; exp.`default`.b = false
    var foc = MnParamSpec()
    foc.key = "focus_locked"; foc.label = "Lock focus"; foc.kind = .bool; foc.apply = .restartSession
    foc.current.b = false; foc.`default`.b = false
    specs["ar_pose"] = ["video_format": fmt, "exposure_locked": exp, "focus_locked": foc]
    var poseDesc = MnStreamDescriptor()
    poseDesc.streamID = "ar_pose"; poseDesc.kind = .pose; poseDesc.transport = .udp
    poseDesc.params = [fmt, exp, foc]
    streamDescriptors.append(poseDesc)
    var poseCfg = MnStreamConfig()
    poseCfg.streamID = "ar_pose"; poseCfg.enabled = arAvailable
    poseCfg.params["video_format"] = fmt.current
    poseCfg.params["exposure_locked"] = exp.current
    poseCfg.params["focus_locked"] = foc.current
    poseCfg.delivery.transport = .udp; poseCfg.delivery.dropPolicy = .latestOnly
    config.streams.append(poseCfg)
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

  public func streamConfig(_ id: String) -> MnStreamConfig? {
    config.streams.first { $0.streamID == id }
  }

  public func isEnabled(_ id: String) -> Bool { streamConfig(id)?.enabled ?? false }

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
      if patch.mode == .camera {
        fr.status = .rejected; fr.reason = "camera mode not implemented yet (M4)"
      } else {
        config.mode = patch.mode
        fr.status = .applied; fr.effective.s = "ar"
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
          v = clamped
          effective.f = v
        case .enum, .string:
          guard case .s(let s)? = value.v else { fr.status = .rejected; fr.reason = "expected string"; result.fields.append(fr); continue }
          if spec.kind == .enum, !spec.choices.contains(s) {
            fr.status = .rejected; fr.reason = "not one of \(spec.choices)"
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
}
