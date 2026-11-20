// Depth packing (§5.4, §6.2): ARCore depth images (uint16 millimetres, already the protocol's
// unit) copied row by row, plus an optional uint8 confidence plane, optionally LZ4-compressed.
//
// The PC decoder (host/python/depth.py) parses Apple's COMPRESSION_LZ4 framing because that
// is what iOS produces: "bv41" + u32 decompressed size + u32 compressed size + raw LZ4 block,
// or "bv4-" + u32 size + raw bytes for an incompressible block, terminated by "bv4$"
// (sizes little-endian). The same framing is written here so nothing changes on the PC.
package expo.modules.muninncore.core

import android.media.Image
import net.jpountz.lz4.LZ4Factory
import java.nio.ByteBuffer
import java.nio.ByteOrder

object DepthPacker {
  // Pure-Java block compressor: the JNI one does not ship for Android.
  private val lz4 by lazy { LZ4Factory.safeInstance().fastCompressor() }

  /** Plane 0 of a 16-bit image as tightly packed little-endian uint16 (width * height * 2 bytes). */
  fun depth16(image: Image): ByteArray {
    val w = image.width; val h = image.height
    val plane = image.planes[0]
    val src = plane.buffer.duplicate().order(ByteOrder.nativeOrder())
    val out = ByteArray(w * h * 2)
    val dst = ByteBuffer.wrap(out).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
    val rowStride = plane.rowStride; val pixelStride = plane.pixelStride
    if (pixelStride == 2) {
      val row = ShortArray(w)
      for (y in 0 until h) {
        src.position(y * rowStride)
        src.asShortBuffer().get(row, 0, w)
        dst.put(row)
      }
    } else {
      for (y in 0 until h) for (x in 0 until w) dst.put(src.getShort(y * rowStride + x * pixelStride))
    }
    return out
  }

  /**
   * ARCore raw-depth confidence (uint8, 0..255) mapped onto the protocol's ARKit scale:
   * 0 = low, 1 = medium, 2 = high.
   */
  fun confidence(image: Image): ByteArray {
    val w = image.width; val h = image.height
    val plane = image.planes[0]
    val src = plane.buffer
    val out = ByteArray(w * h)
    val rowStride = plane.rowStride; val pixelStride = plane.pixelStride
    for (y in 0 until h) for (x in 0 until w) {
      val c = src.get(y * rowStride + x * pixelStride).toInt() and 0xFF
      out[y * w + x] = (if (c >= 170) 2 else if (c >= 85) 1 else 0).toByte()
    }
    return out
  }

  /** One block in Apple's LZ4 framing (see the header comment). */
  fun appleLz4(input: ByteArray): ByteArray {
    val compressed = lz4.compress(input)
    val raw = compressed.size >= input.size
    val body = if (raw) input else compressed
    val out = ByteBuffer.allocate(body.size + 16).order(ByteOrder.LITTLE_ENDIAN)
    if (raw) {
      out.put("bv4-".toByteArray(Charsets.US_ASCII)).putInt(input.size)
    } else {
      out.put("bv41".toByteArray(Charsets.US_ASCII)).putInt(input.size).putInt(compressed.size)
    }
    out.put(body).put("bv4$".toByteArray(Charsets.US_ASCII))
    return out.array().copyOf(out.position())
  }
}
