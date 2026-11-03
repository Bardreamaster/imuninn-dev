// Local recording: the same length-prefixed DataMessage stream as the TCP channel,
// written to <filesDir>/recordings/<timestamp>.imuninn. The PC converts it to MCAP (M3).
package expo.modules.muninncore.core

import android.content.Context
import android.util.Log
import io.imuninn.proto.DataMessage
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

class FileSink(private val ctx: Context) {
  @Volatile private var stream: BufferedOutputStream? = null
  @Volatile var file: File? = null
    private set
  private val byteCount = AtomicLong()
  private val messageCount = AtomicLong()
  val bytes: Long get() = byteCount.get()
  val messages: Long get() = messageCount.get()
  val isRecording: Boolean get() = stream != null
  private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "imuninn.file").apply { isDaemon = true } }

  val directory: File get() = File(ctx.filesDir, "recordings").apply { mkdirs() }

  @Synchronized fun start(): File? {
    stop()
    val name = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
    val f = File(directory, "$name.imuninn")
    return try {
      val s = BufferedOutputStream(FileOutputStream(f), 1024 * 1024)
      s.write("IMUNINN1".toByteArray(Charsets.US_ASCII))   // 8-byte magic so the PC can sniff the format
      stream = s
      file = f
      byteCount.set(8)
      messageCount.set(0)
      f
    } catch (e: Exception) {
      Log.w(TAG, "cannot create recording at $f: $e")
      null
    }
  }

  @Synchronized fun stop() {
    val s = stream ?: return
    stream = null
    writer.execute { try { s.close() } catch (_: Exception) {} }
  }

  fun write(msg: DataMessage) {
    val s = stream ?: return
    val payload = msg.toByteArray()
    val frame = ByteBuffer.allocate(payload.size + 4).order(ByteOrder.LITTLE_ENDIAN)
    frame.putInt(payload.size).put(payload)
    byteCount.addAndGet(frame.capacity().toLong())
    messageCount.incrementAndGet()
    writer.execute { try { s.write(frame.array()) } catch (_: Exception) {} }
  }

  fun recordings(): List<Pair<String, Long>> =
    (directory.listFiles() ?: emptyArray())
      .filter { it.extension == "imuninn" }
      .map { it.name to it.length() }
      .sortedByDescending { it.first }
}
