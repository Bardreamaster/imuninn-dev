// TCP data channel for video / depth: uint32 little-endian length + DataMessage (§6.2).
// Keeps only the newest frames when the link is congested (§8.4), never queues up.
package expo.modules.muninncore.core

import io.imuninn.proto.DataMessage
import java.io.BufferedOutputStream
import java.io.OutputStream
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

class TcpSink(private val socket: Socket) {
  @Volatile var isReady = true
    private set
  private val inFlight = AtomicInteger()
  private val sentCount = AtomicLong()
  private val droppedCount = AtomicLong()
  private val byteCount = AtomicLong()
  val sent: Long get() = sentCount.get()
  val dropped: Long get() = droppedCount.get()
  val bytes: Long get() = byteCount.get()

  /** Set when a frame was dropped so the encoder can resync with a keyframe. */
  @Volatile var onDroppedVideo: (() -> Unit)? = null
  @Volatile var onClosed: (() -> Unit)? = null

  private val out: OutputStream = BufferedOutputStream(socket.getOutputStream(), 256 * 1024)
  private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "imuninn.tcp").apply { isDaemon = true } }

  init {
    try { socket.tcpNoDelay = true } catch (_: Exception) {}
    // Detect peer close: a read that completes with EOF/error.
    Thread({
      try {
        val input = socket.getInputStream()
        while (input.read() >= 0) { /* clients never send after the id */ }
      } catch (_: Exception) {}
      close()
    }, "imuninn.tcp-reader").apply { isDaemon = true }.start()
  }

  fun disconnect() = close()

  private fun close() {
    val wasReady = isReady
    isReady = false
    try { socket.close() } catch (_: Exception) {}
    writer.shutdown()
    if (wasReady) onClosed?.invoke()
  }

  /** `droppable`: video frames may be skipped under backpressure; depth / gaps are not. */
  fun send(msg: DataMessage, droppable: Boolean, keyframe: Boolean = false) {
    if (!isReady) { droppedCount.incrementAndGet(); return }
    if (droppable && inFlight.get() > 2 && !keyframe) {
      droppedCount.incrementAndGet()
      onDroppedVideo?.invoke()
      return
    }
    val payload = msg.toByteArray()
    val frame = ByteBuffer.allocate(payload.size + 4).order(ByteOrder.LITTLE_ENDIAN)
    frame.putInt(payload.size).put(payload)
    inFlight.incrementAndGet()
    sentCount.incrementAndGet()
    byteCount.addAndGet(frame.capacity().toLong())
    try {
      writer.execute {
        try {
          out.write(frame.array())
          out.flush()
        } catch (_: Exception) {
          close()
        } finally {
          inFlight.decrementAndGet()
        }
      }
    } catch (_: Exception) {
      inFlight.decrementAndGet()
      droppedCount.incrementAndGet()
    }
  }
}
