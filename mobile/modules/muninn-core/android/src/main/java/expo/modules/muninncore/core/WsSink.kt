// WebSocket data channel (protocol v5, Hello.data_transport = WEBSOCKET): every subscribed
// stream as one binary DataMessage frame on a second WebSocket to the control port.
// Browsers use this because they have no raw TCP / UDP. Backpressure mirrors TcpSink:
// java-websocket writes from its own thread, and `hasBufferedData()` tells us whether the
// previous frames are still waiting, so video non-keyframes (and samples) are skipped then.
package expo.modules.muninncore.core

import io.imuninn.proto.DataMessage
import org.java_websocket.WebSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicLong

class WsSink(private val connection: WebSocket) {
  companion object {
    val MAGIC: ByteArray = "IMDATA01".toByteArray(Charsets.US_ASCII)

    /** First frame of a data connection: magic + uint32 LE client_id -> the id, or null. */
    fun parseHello(frame: ByteBuffer): Int? {
      if (frame.remaining() != MAGIC.size + 4) return null
      val b = ByteArray(frame.remaining())
      frame.duplicate().get(b)
      for (i in MAGIC.indices) if (b[i] != MAGIC[i]) return null
      return ByteBuffer.wrap(b, MAGIC.size, 4).order(ByteOrder.LITTLE_ENDIAN).int
    }
  }

  @Volatile var isReady = true
    private set
  private val sentCount = AtomicLong()
  private val droppedCount = AtomicLong()
  private val byteCount = AtomicLong()
  val sent: Long get() = sentCount.get()
  val dropped: Long get() = droppedCount.get()
  val bytes: Long get() = byteCount.get()
  @Volatile var onDroppedVideo: (() -> Unit)? = null
  @Volatile var onClosed: (() -> Unit)? = null

  private fun behind(): Boolean = try { connection.hasBufferedData() } catch (_: Exception) { false }

  fun disconnect() {
    isReady = false
    try { connection.close() } catch (_: Exception) {}
  }

  /** Called by the server when the connection closed. */
  fun markClosed() {
    if (!isReady) return
    isReady = false
    onClosed?.invoke()
  }

  /** Video / depth frames: skip non-keyframes while earlier frames are still queued. */
  fun send(msg: DataMessage, droppable: Boolean, keyframe: Boolean = false) {
    if (!isReady) { droppedCount.incrementAndGet(); return }
    if (droppable && !keyframe && behind()) {
      droppedCount.incrementAndGet()
      onDroppedVideo?.invoke()
      return
    }
    write(msg)
  }

  /** Pose / IMU / health: latest-only, dropped while the link is behind. */
  fun sendSample(msg: DataMessage) {
    if (!isReady) { droppedCount.incrementAndGet(); return }
    if (behind()) { droppedCount.incrementAndGet(); return }
    write(msg)
  }

  private fun write(msg: DataMessage) {
    val payload = msg.toByteArray()
    try {
      if (!connection.isOpen) { markClosed(); droppedCount.incrementAndGet(); return }
      connection.send(payload)
      sentCount.incrementAndGet()
      byteCount.addAndGet(payload.size.toLong())
    } catch (e: Exception) {
      droppedCount.incrementAndGet()
      markClosed()
    }
  }
}
