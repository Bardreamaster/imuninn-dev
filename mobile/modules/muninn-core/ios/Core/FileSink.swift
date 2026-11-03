// Local recording: the same length-prefixed MnDataMessage stream as the TCP channel,
// written to Documents/recordings/<timestamp>.imuninn. The PC converts it to MCAP (M3).
import Foundation

public final class FileSink {
  private var handle: FileHandle?
  private let queue = DispatchQueue(label: "imuninn.file", qos: .utility)
  public private(set) var url: URL?
  public private(set) var bytes: UInt64 = 0
  public private(set) var messages: UInt64 = 0
  public var isRecording: Bool { handle != nil }

  public init() {}

  public static var directory: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let dir = docs.appendingPathComponent("recordings", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  @discardableResult
  public func start() -> URL? {
    stop()
    let f = DateFormatter()
    f.dateFormat = "yyyyMMdd-HHmmss"
    let url = Self.directory.appendingPathComponent("\(f.string(from: Date())).imuninn")
    guard FileManager.default.createFile(atPath: url.path, contents: nil),
          let h = try? FileHandle(forWritingTo: url) else {
      NSLog("[imuninn] cannot create recording at \(url.path)")
      return nil
    }
    // 8-byte magic so the PC can sniff the format.
    h.write(Data("IMUNINN1".utf8))
    handle = h
    self.url = url
    bytes = 8
    messages = 0
    return url
  }

  public func stop() {
    guard let h = handle else { return }
    handle = nil
    queue.async { try? h.close() }
  }

  public func write(_ msg: MnDataMessage) {
    guard handle != nil, let payload = try? msg.serializedData() else { return }
    var len = UInt32(payload.count).littleEndian
    var frame = Data(capacity: payload.count + 4)
    withUnsafeBytes(of: &len) { frame.append(contentsOf: $0) }
    frame.append(payload)
    bytes &+= UInt64(frame.count)
    messages &+= 1
    queue.async { [weak self] in self?.handle?.write(frame) }
  }

  public static func recordings() -> [(name: String, bytes: UInt64)] {
    let fm = FileManager.default
    let items = (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])) ?? []
    return items.filter { $0.pathExtension == "imuninn" }.map {
      let size = (try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
      return ($0.lastPathComponent, UInt64(size))
    }.sorted { $0.name > $1.name }
  }
}
