// Plain Swift, no ExpoModulesCore dependency (§4.2).
import ARKit
import Foundation
import UIKit

public let protocolVersion: UInt32 = 1  // keep in sync with protocol/VERSION

public struct DeviceInfo: Codable {
  public let deviceId: String
  public let deviceName: String
  public let model: String
  public let platform: String
  public let osVersion: String
  public let protocolVersion: UInt32
  public let appVersion: String
  public let hasLidar: Bool
  public let arSupported: Bool

  public static func current() -> DeviceInfo {
    let bundle = Bundle.main
    let appVersion = bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    return DeviceInfo(
      deviceId: UIDevice.current.identifierForVendor?.uuidString ?? "unknown",
      deviceName: UIDevice.current.name,
      model: hardwareModel(),
      platform: "ios",
      osVersion: UIDevice.current.systemVersion,
      protocolVersion: MuninnCore.protocolVersion,
      appVersion: appVersion,
      hasLidar: ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
      arSupported: ARWorldTrackingConfiguration.isSupported
    )
  }

  private static func hardwareModel() -> String {
    var sys = utsname()
    uname(&sys)
    return withUnsafePointer(to: &sys.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
    }
  }
}
