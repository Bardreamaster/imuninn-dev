// Configuration presets (§6.8 Profile): full DeviceConfig snapshots saved as
// protobuf-JSON under Documents/profiles/<name>.json. PC-side YAML profiles are
// applied through the normal SetConfig path; these are the phone-local copies.
import Foundation
import SwiftProtobuf

public enum ProfileStore {
  public static var directory: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("profiles", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private static func url(_ name: String) -> URL {
    let safe = name.replacingOccurrences(of: "/", with: "_")
    return directory.appendingPathComponent("\(safe).json")
  }

  public static func list() -> [String] {
    let items = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    return items.filter { $0.pathExtension == "json" }.map { $0.deletingPathExtension().lastPathComponent }.sorted()
  }

  public static func save(_ config: MnDeviceConfig, as name: String) throws {
    var c = config
    c.configVersion = 0   // a profile is a patch, not a version
    var opts = JSONEncodingOptions()
    opts.preserveProtoFieldNames = true
    let data = try c.jsonUTF8Data(options: opts)
    try data.write(to: url(name), options: .atomic)
  }

  public static func load(_ name: String) throws -> MnDeviceConfig {
    let data = try Data(contentsOf: url(name))
    return try MnDeviceConfig(jsonUTF8Data: data)
  }

  public static func delete(_ name: String) {
    try? FileManager.default.removeItem(at: url(name))
  }
}
