// UDP data channel sink: one DataMessage per datagram (§6.2). Drops when the queue is full.
package expo.modules.muninncore.core

import android.util.Log
import io.imuninn.proto.DataMessage
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

class UdpSink {
  private var socket: DatagramSocket? = null
  private var target: InetAddress? = null
  private var port = 0
  @Volatile private var ready = false
  private val sentCount = AtomicLong()
  private val droppedCount = AtomicLong()
  val sent: Long get() = sentCount.get()
  val dropped: Long get() = droppedCount.get()

  // One writer thread; a bounded queue so a slow link never backs up the sources (§8.4).
  private val executor = ThreadPoolExecutor(
    1, 1, 1, TimeUnit.SECONDS, ArrayBlockingQueue(256),
    { r -> Thread(r, "imuninn.udp").apply { isDaemon = true } },
    ThreadPoolExecutor.DiscardPolicy(),
  )

  @Synchronized fun connect(host: InetAddress, port: Int) {
    disconnect()
    try {
      socket = DatagramSocket()
      target = host
      this.port = port
      ready = true
    } catch (e: Exception) {
      Log.w(TAG, "udp socket failed: $e")
      ready = false
    }
  }

  @Synchronized fun disconnect() {
    ready = false
    socket?.close()
    socket = null
    target = null
  }

  fun send(msg: DataMessage) {
    val sock = socket
    val host = target
    if (!ready || sock == null || host == null) {
      droppedCount.incrementAndGet()
      return
    }
    val bytes = msg.toByteArray()
    if (executor.queue.remainingCapacity() == 0) {
      droppedCount.incrementAndGet()
      return
    }
    executor.execute {
      try {
        sock.send(DatagramPacket(bytes, bytes.size, host, port))
        sentCount.incrementAndGet()
      } catch (e: Exception) {
        droppedCount.incrementAndGet()
      }
    }
  }
}
