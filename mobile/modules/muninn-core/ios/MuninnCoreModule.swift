// Thin Expo adapter (§4.2). Everything substantive lives in ios/Core/.
import ExpoModulesCore
import Foundation
import UIKit

public class MuninnCoreModule: Module {
  private var manager: SessionManager { SessionManager.shared }

  public func definition() -> ModuleDefinition {
    Name("MuninnCore")

    Constants([
      "protocolVersion": Int(MuninnCore.protocolVersion),
    ])

    Events("onStatus", "onConfig", "onUserActivity")

    OnCreate {
      // The app exists to stream while in the foreground: never auto-lock (§11).
      DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
      // Touches anywhere in the app (incl. modals) and text edits reset the black-screen idle timer.
      UserActivityMonitor.shared.onActivity = { [weak self] in self?.sendEvent("onUserActivity", [:]) }
      UserActivityMonitor.shared.start()
      self.manager.onStatus = { [weak self] s in
        self?.sendEvent("onStatus", [
          "server": s.server,
          "serverError": s.serverError,
          "serviceName": s.serviceName,
          "addresses": s.addresses,
          "controlPort": Int(s.controlPort),
          "tcpPort": Int(s.tcpPort),
          "clients": s.clients.map { c -> [String: Any] in
            ["id": Int(c.id), "name": c.name, "host": c.host, "subscribed": c.subscribed,
             "udpDropped": Int(c.udpDropped), "tcpDropped": Int(c.tcpDropped), "writer": c.writer]
          },
          "mode": s.mode,
          "sessionRunning": s.sessionRunning,
          "previewing": s.previewing,
          "tracking": s.tracking,
          "poseHz": s.poseHz,
          "imuHz": s.imuHz,
          "videoHz": s.videoHz,
          "depthHz": s.depthHz,
          "videoKbps": s.videoKbps,
          "encoderDropped": Int(s.encoderDropped),
          "frameWidth": s.frameWidth,
          "frameHeight": s.frameHeight,
          "recording": s.recording,
          "recordingFile": s.recordingFile,
          "recordingBytes": Int(s.recordingBytes),
          "configVersion": Int(s.configVersion),
          "remoteControlled": s.remoteControlled,
          "blackScreen": s.blackScreen,
          "writer": s.writer,
          "lastError": s.lastError,
        ])
      }
      self.manager.onConfigChanged = { [weak self] cfg in
        self?.sendEvent("onConfig", ["config": ConfigJSON.config(cfg)])
      }
    }

    OnDestroy {
      DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
    }

    View(MuninnPreviewView.self) {}

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

    Function("startServer") { (name: String?) in
      self.manager.startServer(name: (name?.isEmpty == false) ? name : nil)
    }
    Function("stopServer") { self.manager.stopServer() }

    Function("setPreview") { (enabled: Bool) in self.manager.setPreview(enabled) }
    Function("startSession") { self.manager.startSession() }
    Function("stopSession") { self.manager.stopSession() }
    Function("startRecording") { self.manager.startRecording() }
    Function("stopRecording") { self.manager.stopRecording() }
    Function("listRecordings") { () -> [[String: Any]] in
      FileSink.recordings().map { ["name": $0.name, "bytes": Int($0.bytes)] }
    }
    // Small persistent preferences (UserDefaults): UI language etc.
    Function("getPreference") { (key: String) -> String? in
      UserDefaults.standard.string(forKey: "imuninn.\(key)")
    }
    Function("setPreference") { (key: String, value: String) in
      UserDefaults.standard.set(value, forKey: "imuninn.\(key)")
    }
    // Screen brightness (0..1) for the black-screen mode; the idle timer stays disabled.
    Function("setScreenBrightness") { (value: Double) in
      DispatchQueue.main.async { UIScreen.main.brightness = CGFloat(max(0, min(1, value))) }
    }
    // One call for the UI-environment bits (the module definition is near the Swift
    // type-checker's limit, so these share a function): system language, screen
    // brightness, window safe-area insets and which edge the camera island is on
    // ("top" in portrait, "left"/"right" in landscape; UIKit insets both sides
    // symmetrically in landscape, the JS layout skips the empty one).
    Function("uiInfo") { () -> [String: Any] in
      return UIInfo.sync()
    }
    Function("cameraFormats") { (lens: String) -> [String] in
      self.manager.config.cameraFormats(for: lens)
    }
    Function("takeOver") { self.manager.takeOver() }

    Function("listProfiles") { () -> [String] in ProfileStore.list() }
    Function("saveProfile") { (name: String) throws in
      try ProfileStore.save(self.manager.config.snapshot(), as: name)
    }
    Function("applyProfile") { (name: String) throws -> [String: Any] in
      let patch = try ProfileStore.load(name)
      return ConfigJSON.result(self.manager.setConfigLocally(patch))
    }
    Function("deleteProfile") { (name: String) in ProfileStore.delete(name) }

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

  static func value(from any: Any) -> MnValue {
    var v = MnValue()
    switch any {
    case let b as Bool: v.b = b
    case let i as Int: v.i = Int64(i)
    case let d as Double: if d.rounded() == d { v.i = Int64(d) } else { v.f = d }
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
    var session: [String: Any] = [:]
    for (k, v) in c.sessionParams { session[k] = value(v) }
    return [
      "configVersion": Int(c.configVersion),
      "mode": c.mode == .camera ? "camera" : "ar",
      "session": session,
      "streams": streams,
    ]
  }

  static func patch(from json: [String: Any]) -> MnDeviceConfig {
    var p = MnDeviceConfig()
    if let mode = json["mode"] as? String { p.mode = mode == "camera" ? .camera : .ar }
    if let session = json["session"] as? [String: Any] {
      for (k, v) in session { p.sessionParams[k] = value(from: v) }
    }
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

// UI-environment snapshot for the JS layout (kept outside the module class: referencing
// the module's own statics inside `definition()` trips the Swift type checker).
enum UIInfo {
  static func sync() -> [String: Any] {
    if Thread.isMainThread { return read() }
    return DispatchQueue.main.sync { read() }
  }

  static func read() -> [String: Any] {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first
    let i: UIEdgeInsets = window?.safeAreaInsets ?? UIEdgeInsets.zero
    var notch = "top"
    switch scene?.interfaceOrientation ?? UIInterfaceOrientation.portrait {
    case .landscapeRight: notch = "left"     // device turned left: island on the left
    case .landscapeLeft: notch = "right"
    case .portraitUpsideDown: notch = "bottom"
    default: break
    }
    var out: [String: Any] = [:]
    out["top"] = Double(i.top); out["left"] = Double(i.left)
    out["bottom"] = Double(i.bottom); out["right"] = Double(i.right)
    out["notch"] = notch
    out["brightness"] = Double(UIScreen.main.brightness)
    out["language"] = Locale.preferredLanguages.first ?? "en"
    return out
  }
}
