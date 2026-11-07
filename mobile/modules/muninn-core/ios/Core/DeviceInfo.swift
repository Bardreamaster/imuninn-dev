// Plain Swift, no ExpoModulesCore dependency (§4.2).
import ARKit
import Foundation
import UIKit

public let protocolVersion: UInt32 = 5  // keep in sync with protocol/VERSION

public struct DeviceInfo: Codable {
  public let deviceId: String
  public let deviceName: String
  public let model: String          // hardware identifier, e.g. "iPhone18,1"
  public let marketingName: String  // e.g. "iPhone 17 Pro"
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
      marketingName: marketingName(for: hardwareModel()),
      platform: "ios",
      osVersion: UIDevice.current.systemVersion,
      protocolVersion: MuninnCore.protocolVersion,
      appVersion: appVersion,
      hasLidar: ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
      arSupported: ARWorldTrackingConfiguration.isSupported
    )
  }

  /// Apple's internal identifiers run one generation ahead of marketing names.
  /// Unknown identifiers fall back to the identifier itself.
  private static func marketingName(for id: String) -> String {
    let table: [String: String] = [
      "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
      "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
      "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
      "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max",
      "iPhone18,3": "iPhone Air", "iPhone18,4": "iPhone 17",
      "x86_64": "Simulator", "arm64": "Simulator",
    ]
    return table[id] ?? id
  }

  private static func hardwareModel() -> String {
    var sys = utsname()
    uname(&sys)
    return withUnsafePointer(to: &sys.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
    }
  }
}
