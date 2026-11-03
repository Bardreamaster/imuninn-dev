// Control server: the phone advertises `_imuninn._tcp` over NSD (Bonjour) and accepts
// WebSocket connections carrying ControlMessage (§6.2, §6.7). One `Client` per PC.
package expo.modules.muninncore.core

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import io.imuninn.proto.ControlMessage
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
  @Volatile var isWriter = false

  val label: String get() = if (name.isEmpty()) "client-$id" else name
}

class ControlServer(private val ctx: Context) {
  companion object { const val SERVICE_TYPE = "_imuninn._tcp" }

  private var server: Server? = null
  private val clientMap = ConcurrentHashMap<Int, Client>()
  private val byConnection = ConcurrentHashMap<WebSocket, Client>()
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

  private inner class Server(port: Int) : WebSocketServer(InetSocketAddress(port)) {
    override fun onStart() {
      this@ControlServer.port = this.port
      state = "listening"
      register(this.port)
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
      val client = synchronized(this@ControlServer) { Client(nextId++, conn) }
      clientMap[client.id] = client
      byConnection[conn] = client
      onConnect?.invoke(client)
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
      val client = byConnection.remove(conn) ?: return
      clientMap.remove(client.id)
      client.udp.disconnect()
      client.tcp?.disconnect()
      onDisconnect?.invoke(client)
    }

    override fun onMessage(conn: WebSocket, message: String) { /* binary only */ }

    override fun onMessage(conn: WebSocket, message: ByteBuffer) {
      val client = byConnection[conn] ?: return
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
    for (c in clientMap.values) { c.udp.disconnect(); c.tcp?.disconnect() }
    clientMap.clear()
    byConnection.clear()
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
