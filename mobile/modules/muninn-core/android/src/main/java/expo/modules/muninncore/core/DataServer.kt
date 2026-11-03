// TCP data server: clients connect, write their 4-byte client_id (LE), then receive
// the length-prefixed DataMessage stream (video / depth) for their subscriptions.
package expo.modules.muninncore.core

import android.util.Log
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.nio.ByteBuffer
import java.nio.ByteOrder

class DataServer {
  @Volatile private var server: ServerSocket? = null
  @Volatile var port = 0
    private set
  /** Called once the client id has been read; return false to reject. */
  var onAttach: ((Int, TcpSink) -> Boolean)? = null

  @Synchronized fun start(port: Int) {
    stop()
    val s = try {
      ServerSocket().apply {
        reuseAddress = true
        bind(InetSocketAddress(port), 8)
      }
    } catch (e: Exception) {
      Log.w(TAG, "data server cannot listen on $port: $e")
      return
    }
    server = s
    this.port = s.localPort
    Thread({
      while (true) {
        val conn = try { s.accept() } catch (_: Exception) { break }
        Thread({ attach(conn) }, "imuninn.data-attach").apply { isDaemon = true }.start()
      }
    }, "imuninn.data").apply { isDaemon = true }.start()
  }

  @Synchronized fun stop() {
    try { server?.close() } catch (_: Exception) {}
    server = null
    port = 0
  }

  private fun attach(conn: Socket) {
    try {
      conn.soTimeout = 5000
      val header = ByteArray(4)
      val input = conn.getInputStream()
      var got = 0
      while (got < 4) {
        val n = input.read(header, got, 4 - got)
        if (n < 0) { conn.close(); return }
        got += n
      }
      conn.soTimeout = 0
      val id = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN).int
      val sink = TcpSink(conn)
      if (onAttach?.invoke(id, sink) != true) sink.disconnect()
    } catch (e: Exception) {
      try { conn.close() } catch (_: Exception) {}
    }
  }
}
