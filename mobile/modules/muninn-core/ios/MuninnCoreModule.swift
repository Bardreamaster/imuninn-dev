// Thin Expo adapter (§4.2). Everything substantive lives in ios/Core/.
import ExpoModulesCore
import Foundation

public class MuninnCoreModule: Module {
  private var manager: SessionManager { SessionManager.shared }

  public func definition() -> ModuleDefinition {
    Name("MuninnCore")

    Constants([
      "protocolVersion": Int(MuninnCore.protocolVersion),
    ])

    Events("onStatus", "onConfig", "onGateways")

    OnCreate {
      self.manager.onStatus = { [weak self] s in
        self?.sendEvent("onStatus", [
          "connection": s.connection,
          "gatewayName": s.gatewayName,
          "gatewayHost": s.gatewayHost,
          "sessionRunning": s.sessionRunning,
          "tracking": s.tracking,
          "poseHz": s.poseHz,
          "imuHz": s.imuHz,
          "udpSent": Int(s.udpSent),
          "udpDropped": Int(s.udpDropped),
          "configVersion": Int(s.configVersion),
          "remoteControlled": s.remoteControlled,
          "lastError": s.lastError,
          "gateways": s.gateways,
        ])
      }
      self.manager.onConfigChanged = { [weak self] cfg in
        self?.sendEvent("onConfig", ["config": ConfigJSON.config(cfg)])
      }
      self.manager.onGateways = { [weak self] list in
        self?.sendEvent("onGateways", ["gateways": list.map { $0.name }])
      }
    }

    Function("getDeviceInfo") { () -> [String: Any] in
      let d = DeviceInfo.current()
      return [
        "deviceId": d.deviceId,
        "deviceName": d.deviceName,
        "model": d.model,
        "marketingName": d.marketingName,
        "platform": d.platform,
        "osVersion": d.osVersion,
        "protocolVersion": Int(d.protocolVersion),
        "appVersion": d.appVersion,
        "hasLidar": d.hasLidar,
        "arSupported": d.arSupported,
      ]
    }

    View(MuninnPreviewView.self) {}

    Function("startDiscovery") { self.manager.startDiscovery() }
    Function("stopDiscovery") { self.manager.stopDiscovery() }

    Function("connectToGateway") { (name: String) -> Bool in
      guard let g = self.manager.discovery.results.first(where: { $0.name == name }) else { return false }
      self.manager.connect(to: g.endpoint, name: g.name)
      return true
    }
    Function("connectToHost") { (host: String, port: Int) in
      self.manager.connect(host: host, port: UInt16(port))
    }
    Function("disconnect") { self.manager.disconnect() }

    Function("startSession") { self.manager.startSession() }
    Function("stopSession") { self.manager.stopSession() }

    Function("getCapabilities") { () -> [String: Any] in
      let dev = DeviceInfo.current()
      var p = MnDeviceInfo()
      p.model = dev.model; p.deviceName = dev.deviceName
      return ConfigJSON.capabilities(self.manager.config.capabilities(device: p))
    }
    Function("getConfig") { () -> [String: Any] in
      ConfigJSON.config(self.manager.config.snapshot())
    }
    /// patch: { mode?: "ar"|"camera", streams?: { [id]: { enabled?: bool, params?: { [key]: value } } } }
    Function("setConfig") { (patch: [String: Any]) -> [String: Any] in
      let result = self.manager.setConfigLocally(ConfigJSON.patch(from: patch))
      return ConfigJSON.result(result)
    }
  }
}

/// JSON <-> protobuf bridging for the JS side. Kept here because it exists only for Expo.
enum ConfigJSON {
  static func value(_ v: MnValue) -> Any {
    switch v.v {
    case .b(let b)?: return b
    case .i(let i)?: return Int(i)
    case .f(let f)?: return f
    case .s(let s)?: return s
    default: return NSNull()
    }
  }

  static func value(from any: Any, kindHint: MnParamSpec.Kind? = nil) -> MnValue {
    var v = MnValue()
    switch any {
    case let b as Bool: v.b = b
    case let i as Int: v.i = Int64(i)
    case let d as Double:
      if kindHint == .int || d.rounded() == d && kindHint != .float { v.i = Int64(d) } else { v.f = d }
    case let s as String: v.s = s
    default: break
    }
    return v
  }

  static func spec(_ s: MnParamSpec) -> [String: Any] {
    let kind: String
    switch s.kind {
    case .bool: kind = "bool"
    case .int: kind = "int"
    case .float: kind = "float"
    case .enum: kind = "enum"
    case .string: kind = "string"
    default: kind = "unknown"
    }
    return [
      "key": s.key, "label": s.label, "unit": s.unit, "kind": kind,
      "apply": s.apply == .restartSession ? "restart" : "immediate",
      "min": s.min, "max": s.max, "step": s.step, "choices": s.choices,
      "current": value(s.current), "default": value(s.`default`), "readOnly": s.readOnly,
    ]
  }

  static func capabilities(_ c: MnCapabilities) -> [String: Any] {
    [
      "streams": c.streams.map { d -> [String: Any] in
        let kind: String
        switch d.kind {
        case .imu: kind = "imu"
        case .pose: kind = "pose"
        case .video: kind = "video"
        case .depth: kind = "depth"
        default: kind = "other"
        }
        return ["streamId": d.streamID, "kind": kind, "params": d.params.map(spec)]
      },
      "sessionParams": c.sessionParams.map(spec),
      "config": config(c.config),
    ]
  }

  static func config(_ c: MnDeviceConfig) -> [String: Any] {
    var streams: [String: Any] = [:]
    for s in c.streams {
      var params: [String: Any] = [:]
      for (k, v) in s.params { params[k] = value(v) }
      streams[s.streamID] = ["enabled": s.enabled, "params": params]
    }
    return [
      "configVersion": Int(c.configVersion),
      "mode": c.mode == .camera ? "camera" : "ar",
      "streams": streams,
    ]
  }

  static func patch(from json: [String: Any]) -> MnDeviceConfig {
    var p = MnDeviceConfig()
    if let mode = json["mode"] as? String { p.mode = mode == "camera" ? .camera : .ar }
    if let streams = json["streams"] as? [String: Any] {
      for (id, raw) in streams {
        guard let obj = raw as? [String: Any] else { continue }
        var sc = MnStreamConfig()
        sc.streamID = id
        if let e = obj["enabled"] as? Bool { sc.enabled = e }
        if let params = obj["params"] as? [String: Any] {
          for (k, v) in params { sc.params[k] = value(from: v) }
        }
        p.streams.append(sc)
      }
    }
    return p
  }

  static func result(_ r: MnConfigResult) -> [String: Any] {
    [
      "configVersion": Int(r.configVersion),
      "sessionRestarted": r.sessionRestarted,
      "fields": r.fields.map { f -> [String: Any] in
        let status: String
        switch f.status {
        case .applied: status = "applied"
        case .clamped: status = "clamped"
        case .rejected: status = "rejected"
        default: status = "unknown"
        }
        return ["key": f.key, "status": status, "effective": value(f.effective), "reason": f.reason]
      },
    ]
  }
}
