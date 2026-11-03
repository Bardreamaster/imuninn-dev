// Thin Expo adapter (§4.2). Everything substantive lives in ios/Core/.
import ExpoModulesCore

public class MuninnCoreModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MuninnCore")

    Constants([
      "protocolVersion": Int(MuninnCore.protocolVersion),
    ])

    Events("onStatus")

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
  }
}
