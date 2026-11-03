// LiDAR depth packing (§5.4, §6.2): Float32 metres → uint16 millimetres (+ uint8
// confidence), optionally LZ4-compressed with Apple's Compression framework.
//
// Apple's COMPRESSION_LZ4 output is a sequence of "bv41" blocks (little-endian
// decompressed size, compressed size, raw LZ4 block) ending in "bv4$"; raw blocks
// may also appear as "bv4-". The PC side parses that framing (host/python/depth.py).
import Compression
import CoreVideo
import Foundation

public struct PackedDepth {
  public let width: Int
  public let height: Int
  public let depthMm: Data
  public let confidence: Data   // empty if unavailable
  public let compressed: Bool
}

public enum DepthPacker {
  /// Scratch buffers reused across frames (one caller at a time: the AR delegate queue).
  private static var mmScratch = [UInt16]()
  private static var outScratch = [UInt8]()

  public static func pack(depth: CVPixelBuffer, confidence: CVPixelBuffer?, compress: Bool) -> PackedDepth? {
    guard CVPixelBufferGetPixelFormatType(depth) == kCVPixelFormatType_DepthFloat32 else { return nil }
    let w = CVPixelBufferGetWidth(depth), h = CVPixelBufferGetHeight(depth)
    CVPixelBufferLockBaseAddress(depth, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(depth) else { return nil }
    let stride = CVPixelBufferGetBytesPerRow(depth) / MemoryLayout<Float32>.size
    if mmScratch.count != w * h { mmScratch = [UInt16](repeating: 0, count: w * h) }
    mmScratch.withUnsafeMutableBufferPointer { out in
      let src = base.assumingMemoryBound(to: Float32.self)
      for y in 0..<h {
        let row = src + y * stride
        let o = y * w
        for x in 0..<w {
          let m = row[x]
          // 0 = invalid; clamp to 65.535 m
          out[o + x] = (m.isFinite && m > 0) ? UInt16(min(65535, max(0, (m * 1000).rounded()))) : 0
        }
      }
    }
    var depthData = mmScratch.withUnsafeBufferPointer { Data(buffer: $0) }
    var confData = Data()
    if let c = confidence, CVPixelBufferGetPixelFormatType(c) == kCVPixelFormatType_OneComponent8 {
      CVPixelBufferLockBaseAddress(c, .readOnly)
      if let cb = CVPixelBufferGetBaseAddress(c) {
        let cs = CVPixelBufferGetBytesPerRow(c)
        confData = Data(count: w * h)
        confData.withUnsafeMutableBytes { dst in
          for y in 0..<h { memcpy(dst.baseAddress! + y * w, cb + y * cs, w) }
        }
      }
      CVPixelBufferUnlockBaseAddress(c, .readOnly)
    }
    if compress {
      depthData = lz4(depthData) ?? depthData
      if !confData.isEmpty { confData = lz4(confData) ?? confData }
    }
    return PackedDepth(width: w, height: h, depthMm: depthData, confidence: confData, compressed: compress)
  }

  private static func lz4(_ input: Data) -> Data? {
    let cap = input.count + input.count / 16 + 64
    if outScratch.count < cap { outScratch = [UInt8](repeating: 0, count: cap) }
    let n = input.withUnsafeBytes { src -> Int in
      outScratch.withUnsafeMutableBufferPointer { dst in
        compression_encode_buffer(dst.baseAddress!, cap, src.baseAddress!.assumingMemoryBound(to: UInt8.self),
                                  input.count, nil, COMPRESSION_LZ4)
      }
    }
    guard n > 0 else { return nil }
    return Data(outScratch[0..<n])
  }
}
