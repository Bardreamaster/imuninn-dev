// Orchestrates the servers, sources, encoder, config and per-client sinks.
// The phone is the server (§6.7): PCs discover it over NSD and connect.
// Owns all state; the Expo module is a thin adapter over this class (§4.2).
// Port of ios/Core/SessionManager.swift; AR mode is not available yet (see ArSource).
package expo.modules.muninncore.core

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.SurfaceTexture
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import android.view.Surface
import io.imuninn.proto.ConfigChanged
import io.imuninn.proto.ConfigResult
import io.imuninn.proto.ControlMessage
import io.imuninn.proto.DataMessage
import io.imuninn.proto.DeviceConfig
import io.imuninn.proto.DeviceHealth
import io.imuninn.proto.DeviceInfo
import io.imuninn.proto.Header
import io.imuninn.proto.Intrinsics
import io.imuninn.proto.Lease
import io.imuninn.proto.PixelFormat
import io.imuninn.proto.Platform
import io.imuninn.proto.SessionControl
import io.imuninn.proto.SetConfig
import io.imuninn.proto.TimeSyncPong
import io.imuninn.proto.VideoFrame
import io.imuninn.proto.Welcome
import io.imuninn.proto.Error as PbError
import java.net.InetAddress
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class ClientStatus(
  val id: Int, val name: String, val host: String, val subscribed: List<String>,
  val udpDropped: Long, val tcpDropped: Long, val writer: Boolean,
)

data class Status(
  var server: String = "stopped",           // starting | listening | failed: … | stopped
  var serviceName: String = "",
  var addresses: List<String> = emptyList(),   // "wlan0 10.0.0.5"
  var controlPort: Int = 0,
  var tcpPort: Int = 0,
  var clients: List<ClientStatus> = emptyList(),
  var mode: String = "camera",
  var sessionRunning: Boolean = false,
  var previewing: Boolean = false,
  var tracking: String = "none",
  var poseHz: Double = 0.0,
  var imuHz: Double = 0.0,
  var videoHz: Double = 0.0,
  var depthHz: Double = 0.0,
  var videoKbps: Double = 0.0,
  var encoderDropped: Long = 0,
  var configVersion: Int = 0,
  var remoteControlled: Boolean = false,
  var writer: String = "",
  var recording: Boolean = false,
  var recordingFile: String = "",
  var recordingBytes: Long = 0,
  var lastError: String = "",
)

class SessionManager private constructor(private val ctx: Context) {
  companion object {
    const val DEFAULT_CONTROL_PORT = 7420
    const val DEFAULT_TCP_PORT = 7422
    @Volatile private var instance: SessionManager? = null
    fun get(ctx: Context): SessionManager = instance ?: synchronized(this) {
      instance ?: SessionManager(ctx.applicationContext).also { instance = it }
    }
    /** Null until the module created it; used by the preview view. */
    val shared: SessionManager? get() = instance
  }

  val control = ControlServer(ctx)
  val data = DataServer()
  val file = FileSink(ctx)
  val camera = CameraSource(ctx)
  val imu = ImuSource(ctx)
  val encoder = VideoEncoder()
  val profiles = ProfileStore(ctx)
  val config: ConfigStore

  // Everything that touches state runs on this one thread (the iOS "queue").
  private val queue = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "imuninn.session").apply { isDaemon = true } }
  @Volatile private var sessionRunning = false
  @Volatile private var previewEnabled = false
  @Volatile private var remoteControlled = false
  @Volatile private var lastError = ""
  private var serviceName = ""
  private var writerId: Int? = null
  private var healthSeq = 0L
  private var lastHealthNs = 0L
  private val startNs = deviceTimeNs()
  private val poseCounter = RateCounter()
  private val imuCounter = RateCounter()
  private val videoCounter = RateCounter()
  private val depthCounter = RateCounter()
  private val videoBytes = ByteRate()
  private var videoSeq = 0L
  @Volatile private var clientList: List<Client> = emptyList()
  private var previewSurface: Surface? = null
  private var previewTexture: SurfaceTexture? = null

  var onStatus: ((Status) -> Unit)? = null
  var onConfigChanged: ((DeviceConfig) -> Unit)? = null
  var onModeChanged: (() -> Unit)? = null

  init {
    val env = ConfigEnvironment()
    env.arAvailable = ArSource.supported(ctx)
    env.lenses = camera.lenses.map { it.lens }
    env.cameraFormats = camera.lenses.associate { it.lens to it.formats }
    env.imuAvailable = imu.available
    env.depthAvailable = false
    env.camera = CameraRanges.probe(camera.lenses.firstOrNull()?.characteristics)
    config = ConfigStore(env)
    camera.lenses.firstOrNull()?.let {
      if (!it.timestampsRealtime) Log.w(TAG, "camera timestamps are not CLOCK_BOOTTIME on this device; video/IMU time bases may differ")
    }

    control.onConnect = { c -> queue.execute { clientConnected(c) } }
    control.onDisconnect = { c -> queue.execute { clientDisconnected(c) } }
    control.onMessage = { c, m -> queue.execute { handle(c, m) } }
    data.onAttach = { id, sink -> attachData(id, sink) }
    imu.onSample = { s -> publishImu(s) }
    encoder.onFrame = { f -> publishVideo(f) }
    camera.onError = { e -> lastError = e }
    queue.scheduleAtFixedRate({ try { emitStatus() } catch (e: Exception) { Log.w(TAG, "status failed: $e") } }, 200, 200, TimeUnit.MILLISECONDS)
  }

  val isCameraMode: Boolean get() = config.isCameraMode

  // MARK: server lifecycle

  fun startServer(name: String? = null, controlPort: Int = DEFAULT_CONTROL_PORT, tcpPort: Int = DEFAULT_TCP_PORT) {
    queue.execute {
      serviceName = name ?: LocalDeviceInfo.current(ctx).deviceName
      control.start(controlPort, serviceName)
      data.start(tcpPort)
    }
  }

  fun stopServer() {
    queue.execute {
      control.stop()
      data.stop()
      clientList = emptyList()
    }
  }

  private fun clientConnected(c: Client) {
    clientList = control.clients.toList()
    Log.i(TAG, "client ${c.id} connected from ${c.remoteHost}")
  }

  private fun clientDisconnected(c: Client) {
    clientList = control.clients.toList()
    if (writerId == c.id) releaseLease(broadcast = true)
    Log.i(TAG, "client ${c.label} disconnected")
  }

  // MARK: lease (§6.8 控制权): one writer at a time, auto-released on disconnect.

  private val writerName: String
    get() = writerId?.let { control.client(it)?.label } ?: ""

  /** Returns true if `c` may write. A free lease is granted implicitly. */
  private fun acquireLease(c: Client): Boolean {
    if (writerId == null || writerId == c.id) {
      if (writerId == null) {
        writerId = c.id
        c.isWriter = true
        control.broadcast(ControlMessage.newBuilder().setLease(
          Lease.newBuilder().setAction(Lease.Action.ACTION_GRANTED).setHolder(c.label)).build())
      }
      return true
    }
    return false
  }

  private fun releaseLease(broadcast: Boolean) {
    writerId?.let { control.client(it)?.isWriter = false }
    writerId = null
    remoteControlled = false
    if (broadcast) {
      control.broadcast(ControlMessage.newBuilder().setLease(
        Lease.newBuilder().setAction(Lease.Action.ACTION_RELEASE).setHolder("")).build())
    }
  }

  /** Phone UI takes control back: the remote writer gets REVOKED. */
  fun takeOver() {
    queue.execute {
      val id = writerId ?: return@execute
      val name = writerName
      control.client(id)?.isWriter = false
      writerId = null
      remoteControlled = false
      control.broadcast(ControlMessage.newBuilder().setLease(
        Lease.newBuilder().setAction(Lease.Action.ACTION_REVOKED).setHolder(name)).build())
    }
  }

  private fun attachData(id: Int, sink: TcpSink): Boolean {
    return try {
      queue.submit<Boolean> {
        val c = control.client(id) ?: return@submit false
        c.tcp?.disconnect()
        c.tcp = sink
        sink.onDroppedVideo = { encoder.requestKeyframe() }
        sink.onClosed = { if (c.tcp === sink) c.tcp = null }
        encoder.requestKeyframe()
        true
      }.get(5, TimeUnit.SECONDS)
    } catch (e: Exception) { false }
  }

  // MARK: control messages

  private fun handle(c: Client, msg: ControlMessage) {
    val reply = ControlMessage.newBuilder().setRequestId(msg.requestId)
    when (msg.bodyCase) {
      ControlMessage.BodyCase.HELLO -> {
        val h = msg.hello
        c.name = h.client.name
        val host = c.remoteHost
        if (host != null && h.udpPort > 0) c.udp.connect(NetInfo.udpTarget(host), h.udpPort)
        val dev = deviceInfoProto()
        reply.welcome = Welcome.newBuilder()
          .setDevice(dev)
          .setCapabilities(config.capabilities(dev))
          .setProtocolVersion(PROTOCOL_VERSION)
          .setTcpPort(data.port)
          .setClientId(c.id)
          .build()
      }
      ControlMessage.BodyCase.GET_CAPABILITIES -> reply.capabilities = config.capabilities(deviceInfoProto())
      ControlMessage.BodyCase.GET_CONFIG -> reply.config = config.snapshot()
      ControlMessage.BodyCase.SET_CONFIG -> {
        if (!acquireLease(c)) {
          reply.error = PbError.newBuilder().setCode(409).setMessage("config lease held by $writerName").build()
          control.send(reply.build(), c)
          return
        }
        val update = config.apply(msg.setConfig)
        reply.configResult = update.result
        control.send(reply.build(), c)
        if (update.changes.isNotEmpty()) {
          remoteControlled = true
          applyChanges(update)
          broadcastConfig()
        }
        return
      }
      ControlMessage.BodyCase.SUBSCRIBE -> {
        val s = msg.subscribe
        if (s.unsubscribe) c.subscribed.removeAll(s.streamIdsList.toSet()) else c.subscribed.addAll(s.streamIdsList)
        if (c.subscribed.contains("rgb")) encoder.requestKeyframe()
        return
      }
      ControlMessage.BodyCase.SESSION_CONTROL -> {
        when (msg.sessionControl.action) {
          SessionControl.Action.ACTION_START -> startSession()
          SessionControl.Action.ACTION_STOP -> stopSession()
          SessionControl.Action.ACTION_START_RECORDING -> startRecording()
          SessionControl.Action.ACTION_STOP_RECORDING -> stopRecording()
          else -> {}
        }
        return
      }
      ControlMessage.BodyCase.TIME_SYNC_PING -> {
        val now = deviceTimeNs()
        reply.timeSyncPong = TimeSyncPong.newBuilder()
          .setClientSendNs(msg.timeSyncPing.clientSendNs)
          .setDeviceRecvNs(now)
          .setDeviceSendNs(deviceTimeNs())
          .build()
      }
      ControlMessage.BodyCase.LEASE -> {
        val l = Lease.newBuilder()
        when (msg.lease.action) {
          Lease.Action.ACTION_REQUEST ->
            if (acquireLease(c)) l.setAction(Lease.Action.ACTION_GRANTED).setHolder(c.label)
            else l.setAction(Lease.Action.ACTION_DENIED).setHolder(writerName)
          Lease.Action.ACTION_RELEASE -> {
            if (writerId == c.id) releaseLease(broadcast = true)
            l.setAction(Lease.Action.ACTION_RELEASE).setHolder(writerName)
          }
          else -> l.setAction(Lease.Action.ACTION_DENIED).setHolder(writerName)
        }
        reply.lease = l.build()
      }
      else -> return
    }
    control.send(reply.build(), c)
  }

  // MARK: session

  fun startSession() {
    queue.execute {
      sessionRunning = true
      restartSources()
    }
  }

  fun stopSession() {
    queue.execute {
      sessionRunning = false
      if (previewEnabled) restartSources() else stopSources()
    }
  }

  /** Preview-only: run the camera so the phone shows a picture, send nothing (§4.4). */
  fun setPreview(enabled: Boolean) {
    queue.execute {
      previewEnabled = enabled
      if (!sessionRunning) restartSources()
    }
  }

  /** The preview view hands over its SurfaceTexture; null when it goes away. */
  fun setPreviewTexture(texture: SurfaceTexture?) {
    queue.execute {
      previewSurface?.release()
      previewSurface = null
      previewTexture = texture
      if (texture != null) previewSurface = Surface(texture)
      if (sessionRunning || previewEnabled) restartSources()
    }
  }

  private fun stopSources() {
    camera.stop()
    imu.stop()
    encoder.stop()
  }

  private fun restartSources() {
    stopSources()
    if (!(sessionRunning || previewEnabled)) return
    if (isCameraMode) {
      val lens = config.string("rgb", "lens").ifEmpty { "wide" }
      val fmt = config.string("rgb", "camera_format").ifEmpty { camera.formats(lens).firstOrNull() ?: "" }
      val (w, h, fps) = CameraSource.parse(fmt).takeIf { it.first > 0 } ?: Triple(1280, 720, 30)
      val targets = ArrayList<Surface>()
      previewTexture?.let { t ->
        t.setDefaultBufferSize(w, h)
        previewSurface?.let { targets += it }
      }
      if (sessionRunning && config.isEnabled("rgb")) {
        encoder.start(w, h, fps, config.int("rgb", "bitrate_kbps") * 1000, config.int("rgb", "keyframe_interval").coerceAtLeast(1))
          ?.let { targets += it }
      }
      if (targets.isNotEmpty()) {
        camera.start(lens, fmt, config.cameraSettings(), targets)
      }
    } else {
      lastError = "AR mode not implemented on Android"
    }
    if (sessionRunning && config.isEnabled("imu") && imu.available) {
      imu.start(config.int("imu", "rate_hz").coerceAtLeast(10), config.bool("imu", "raw"))
    }
  }

  /** Local UI edits go through the same path as remote ones (§6.8). */
  fun setConfigLocally(patch: DeviceConfig): ConfigResult {
    val update = config.apply(SetConfig.newBuilder().setPatch(patch).setBaseConfigVersion(0).build())
    queue.execute {
      if (update.changes.isNotEmpty()) {
        remoteControlled = false
        applyChanges(update)
        broadcastConfig()
      }
    }
    return update.result
  }

  private fun applyChanges(update: ConfigUpdate) {
    if (update.changes.any { it.stream == "" && it.key == "mode" }) onModeChanged?.invoke()
    if (!(sessionRunning || previewEnabled)) return
    if (update.needsRestart) { restartSources(); return }
    for (c in update.changes) {
      when (c.stream to c.key) {
        "imu" to "rate_hz" -> imu.setRate(c.value.i.toInt())
        "imu" to "raw", "imu" to "enabled", "ar_pose" to "enabled", "rgb" to "enabled", "depth" to "enabled" -> restartSources()
        "rgb" to "bitrate_kbps" -> encoder.setBitrate(c.value.i.toInt() * 1000)
        "rgb" to "keyframe_interval" -> encoder.setKeyframeInterval(c.value.i.toInt())
        else -> if (c.stream == "rgb" && c.key in CameraControl.cameraKeys) camera.applyCamera(config.cameraSettings())
      }
    }
  }

  private fun broadcastConfig() {
    val snap = config.snapshot()
    control.broadcast(ControlMessage.newBuilder().setConfigChanged(ConfigChanged.newBuilder().setConfig(snap)).build())
    onConfigChanged?.invoke(snap)
  }

  // MARK: recording

  fun startRecording() {
    queue.execute {
      file.start()
      encoder.requestKeyframe()
    }
  }

  fun stopRecording() {
    queue.execute { file.stop() }
  }

  // MARK: data path

  private fun stamp(h: Header.Builder): Header.Builder =
    h.setProtocolVersion(PROTOCOL_VERSION).setConfigVersion(config.snapshot().configVersion)

  private fun publishImu(s: io.imuninn.proto.ImuSample) {
    imuCounter.tick()
    val msg = DataMessage.newBuilder().setImu(s.toBuilder().setHeader(stamp(s.header.toBuilder()))).build()
    for (c in clientList) if (c.subscribed.contains(ImuSource.STREAM_ID)) c.udp.send(msg)
    if (file.isRecording) file.write(msg)
  }

  private fun publishVideo(f: EncodedFrame) {
    videoCounter.tick()
    videoBytes.add(f.data.size)
    val k = camera.intrinsics()
    val v = VideoFrame.newBuilder()
      .setHeader(stamp(Header.newBuilder().setStreamId("rgb").setSeq(videoSeq++).setDeviceTimeNs(f.timeNs)))
      .setFormat(PixelFormat.PIXEL_FORMAT_H264_NAL)
      .setWidth(f.width).setHeight(f.height)
      .setKeyframe(f.keyframe)
      .setData(com.google.protobuf.ByteString.copyFrom(f.data))
      .setRotationDeg(camera.rotationDeg)
    if (k != null) {
      v.intrinsics = Intrinsics.newBuilder().setWidth(f.width).setHeight(f.height)
        .setFx(k.fx).setFy(k.fy).setCx(k.cx).setCy(k.cy).build()
    }
    val msg = DataMessage.newBuilder().setVideo(v).build()
    for (c in clientList) if (c.subscribed.contains("rgb")) c.tcp?.send(msg, droppable = true, keyframe = f.keyframe)
    if (file.isRecording) file.write(msg)
  }

  // MARK: status (throttled to 5 Hz, §4.3)

  private fun emitStatus() {
    val rate = config.double("health", "rate_hz").coerceAtLeast(0.1)
    val now = deviceTimeNs()
    if (config.isEnabled("health") && now - lastHealthNs >= (1e9 / rate).toLong()) {
      lastHealthNs = now
      publishHealth()
    }
    val s = Status()
    s.server = control.state
    s.serviceName = serviceName
    s.addresses = NetInfo.ipv4Addresses().map { "${it.first} ${it.second}" }
    s.controlPort = control.port
    s.tcpPort = data.port
    s.clients = clientList.map {
      ClientStatus(it.id, it.label, it.remoteHost?.hostAddress ?: "", it.subscribed.sorted(),
        it.udp.dropped, it.tcp?.dropped ?: 0, it.isWriter)
    }
    s.mode = if (isCameraMode) "camera" else "ar"
    s.sessionRunning = sessionRunning
    s.previewing = previewEnabled || sessionRunning
    s.tracking = "none"
    s.poseHz = poseCounter.rate()
    s.imuHz = imuCounter.rate()
    s.videoHz = videoCounter.rate()
    s.depthHz = depthCounter.rate()
    s.videoKbps = videoBytes.kbps()
    s.encoderDropped = encoder.dropped
    s.configVersion = config.snapshot().configVersion
    s.remoteControlled = remoteControlled
    s.writer = writerName
    s.recording = file.isRecording
    s.recordingFile = file.file?.name ?: ""
    s.recordingBytes = file.bytes
    s.lastError = lastError
    onStatus?.invoke(s)
  }

  private fun publishHealth() {
    val wanted = file.isRecording || clientList.any { it.subscribed.contains("health") }
    if (!wanted) return
    val h = DeviceHealth.newBuilder()
      .setHeader(stamp(Header.newBuilder().setStreamId("health").setSeq(healthSeq++).setDeviceTimeNs(deviceTimeNs())))
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
    h.thermal = if (Build.VERSION.SDK_INT >= 29 && pm != null) {
      when (pm.currentThermalStatus) {
        PowerManager.THERMAL_STATUS_NONE -> DeviceHealth.Thermal.THERMAL_NOMINAL
        PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> DeviceHealth.Thermal.THERMAL_FAIR
        PowerManager.THERMAL_STATUS_SEVERE -> DeviceHealth.Thermal.THERMAL_SERIOUS
        else -> DeviceHealth.Thermal.THERMAL_CRITICAL
      }
    } else DeviceHealth.Thermal.THERMAL_UNSPECIFIED
    val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    val level = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -100
    h.batteryLevel = if (level in 0..100) level / 100f else -1f
    val batt: Intent? = try { ctx.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) } catch (_: Exception) { null }
    h.batteryState = when (batt?.getIntExtra(BatteryManager.EXTRA_STATUS, -1)) {
      BatteryManager.BATTERY_STATUS_CHARGING -> DeviceHealth.BatteryState.BATTERY_CHARGING
      BatteryManager.BATTERY_STATUS_FULL -> DeviceHealth.BatteryState.BATTERY_FULL
      BatteryManager.BATTERY_STATUS_DISCHARGING, BatteryManager.BATTERY_STATUS_NOT_CHARGING -> DeviceHealth.BatteryState.BATTERY_UNPLUGGED
      else -> DeviceHealth.BatteryState.BATTERY_UNSPECIFIED
    }
    h.lowPowerMode = pm?.isPowerSaveMode ?: false
    h.poseHz = poseCounter.peek(); h.imuHz = imuCounter.peek(); h.videoFps = videoCounter.peek(); h.depthHz = depthCounter.peek()
    h.videoKbps = videoBytes.peek()
    h.encoderDropped = encoder.dropped
    h.uptimeS = (deviceTimeNs() - startNs) / 1e9
    val msg = DataMessage.newBuilder().setHealth(h).build()
    for (c in clientList) if (c.subscribed.contains("health")) c.udp.send(msg)
    if (file.isRecording) file.write(msg)
  }

  // MARK: helpers

  fun deviceInfoProto(): DeviceInfo {
    val d = LocalDeviceInfo.current(ctx)
    return DeviceInfo.newBuilder()
      .setDeviceId(d.deviceId)
      .setDeviceName(d.deviceName)
      .setModel(d.model)
      .setPlatform(Platform.PLATFORM_ANDROID)
      .setOsVersion(d.osVersion)
      .setProtocolVersion(d.protocolVersion)
      .setAppVersion(d.appVersion)
      .setHasLidar(d.hasLidar)
      .build()
  }
}
