// Control server: the phone advertises `_imuninn._tcp` over NSD (Bonjour) and accepts
// WebSocket connections carrying ControlMessage (§6.2, §6.7). One `Client` per PC.
// A second WebSocket whose first frame is WsSink.MAGIC + client_id is a data connection
// (protocol v5, browsers): it becomes that client's WsSink instead of a Client.
package expo.modules.muninncore.core

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import io.imuninn.proto.ControlMessage
import io.imuninn.proto.DataMessage
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap

class Client(val id: Int, val connection: WebSocket) {
  val remoteHost: InetAddress? = try { connection.remoteSocketAddress?.address } catch (_: Exception) { null }
  @Volatile var name: String = ""
  val subscribed: MutableSet<String> = ConcurrentHashMap.newKeySet()
  val udp = UdpSink()
  @Volatile var tcp: TcpSink? = null
  @Volatile var ws: WsSink? = null
  @Volatile var isWriter = false

  val label: String get() = if (name.isEmpty()) "client-$id" else name

  /** Where video / depth go: the WebSocket data channel if the client opened one, else TCP. */
  val hasFrameSink: Boolean get() = ws != null || tcp != null
  val frameDropped: Long get() = (tcp?.dropped ?: 0) + (ws?.dropped ?: 0)

  fun sendFrame(msg: DataMessage, droppable: Boolean, keyframe: Boolean) {
    val w = ws
    if (w != null) w.send(msg, droppable, keyframe) else tcp?.send(msg, droppable, keyframe)
  }

  /** Pose / IMU / health: WebSocket data channel if present, else UDP. */
  fun sendSample(msg: DataMessage) {
    val w = ws
    if (w != null) w.sendSample(msg) else udp.send(msg)
  }
}

class ControlServer(private val ctx: Context) {
  companion object { const val SERVICE_TYPE = "_imuninn._tcp" }

  private var server: Server? = null
  private val clientMap = ConcurrentHashMap<Int, Client>()
  private val byConnection = ConcurrentHashMap<WebSocket, Client>()
  private val pending = ConcurrentHashMap.newKeySet<WebSocket>()   // open, first frame not seen yet
  private val dataSinks = ConcurrentHashMap<WebSocket, WsSink>()
  private var nextId = 1
  @Volatile var port = 0
    private set
  @Volatile var state: String = "stopped"
    private set
  private var nsd: NsdManager? = null
  private var nsdListener: NsdManager.RegistrationListener? = null

  val clients: Collection<Client> get() = clientMap.values

  var onMessage: ((Client, ControlMessage) -> Unit)? = null
  var onConnect: ((Client) -> Unit)? = null
  var onDisconnect: ((Client) -> Unit)? = null
  /** A data WebSocket announced itself for `client_id`; return false to reject. */
  var onAttachWs: ((Int, WsSink) -> Boolean)? = null

  private inner class Server(port: Int) : WebSocketServer(InetSocketAddress(port)) {
    override fun onStart() {
      this@ControlServer.port = this.port
      state = "listening"
      register(this.port)
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
      // The first frame decides what this connection is (control Hello or data magic).
      pending.add(conn)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
      pending.remove(conn)
      dataSinks.remove(conn)?.markClosed()
      val client = byConnection.remove(conn) ?: return
      clientMap.remove(client.id)
      client.udp.disconnect()
      client.tcp?.disconnect()
      client.ws?.disconnect()
      onDisconnect?.invoke(client)
    }

    override fun onMessage(conn: WebSocket, message: String) { /* binary only */ }

    override fun onMessage(conn: WebSocket, message: ByteBuffer) {
      var client = byConnection[conn]
      if (client == null) {
        if (!pending.remove(conn)) return   // a data connection: nothing expected after its hello
        val dataId = WsSink.parseHello(message)
        if (dataId != null) {
          val sink = WsSink(conn)
          if (onAttachWs?.invoke(dataId, sink) == true) dataSinks[conn] = sink else conn.close()
          return
        }
        client = synchronized(this@ControlServer) { Client(nextId++, conn) }
        clientMap[client.id] = client
        byConnection[conn] = client
        onConnect?.invoke(client)
      }
      val msg = try { ControlMessage.parseFrom(message) } catch (e: Exception) {
        Log.w(TAG, "bad control message: $e"); return
      }
      onMessage?.invoke(client, msg)
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
      if (conn == null) {
        state = "failed: ${ex.message ?: ex}"
        Log.w(TAG, "control server error: $ex")
      }
    }
  }

  @Synchronized fun start(port: Int, serviceName: String) {
    stop()
    state = "starting"
    val s = Server(port)
    s.isReuseAddr = true
    s.connectionLostTimeout = 30
    server = s
    this.serviceName = serviceName
    s.start()
  }

  private var serviceName = ""

  @Synchronized fun stop() {
    unregister()
    val s = server ?: return
    server = null
    try { s.stop(500) } catch (_: Exception) {}
    for (c in clientMap.values) { c.udp.disconnect(); c.tcp?.disconnect(); c.ws?.disconnect() }
    for (s in dataSinks.values) s.disconnect()
    clientMap.clear()
    byConnection.clear()
    pending.clear()
    dataSinks.clear()
    state = "stopped"
    port = 0
  }

  fun send(msg: ControlMessage, to: Client) {
    try {
      if (to.connection.isOpen) to.connection.send(msg.toByteArray())
    } catch (e: Exception) {
      Log.w(TAG, "send to ${to.label} failed: $e")
    }
  }

  fun broadcast(msg: ControlMessage) {
    val bytes = msg.toByteArray()
    for (c in clientMap.values) {
      try { if (c.connection.isOpen) c.connection.send(bytes) } catch (_: Exception) {}
    }
  }

  fun client(byId: Int): Client? = clientMap[byId]

  // MARK: NSD (Bonjour). Does not work inside the emulator's NAT; PCs use adb forward there.

  private fun register(port: Int) {
    try {
      val m = ctx.getSystemService(Context.NSD_SERVICE) as NsdManager
      val info = NsdServiceInfo().apply {
        this.serviceName = this@ControlServer.serviceName
        serviceType = SERVICE_TYPE
        this.port = port
        setAttribute("proto", PROTOCOL_VERSION.toString())
      }
      val l = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(i: NsdServiceInfo) { Log.i(TAG, "nsd registered as ${i.serviceName}") }
        override fun onRegistrationFailed(i: NsdServiceInfo, code: Int) { Log.w(TAG, "nsd registration failed: $code") }
        override fun onServiceUnregistered(i: NsdServiceInfo) {}
        override fun onUnregistrationFailed(i: NsdServiceInfo, code: Int) {}
      }
      m.registerService(info, NsdManager.PROTOCOL_DNS_SD, l)
      nsd = m
      nsdListener = l
    } catch (e: Exception) {
      Log.w(TAG, "nsd unavailable: $e")
    }
  }

  private fun unregister() {
    val l = nsdListener ?: return
    try { nsd?.unregisterService(l) } catch (_: Exception) {}
    nsdListener = null
  }
}
