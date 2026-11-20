// Orchestrates the servers, sources, encoder, config and per-client sinks.
// The phone is the server (§6.7): PCs discover it over NSD and connect.
// Owns all state; the Expo module is a thin adapter over this class (§4.2).
// Port of ios/Core/SessionManager.swift.
package expo.modules.muninncore.core

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
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
import io.imuninn.proto.DepthCompression
import io.imuninn.proto.DepthFrame
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
  var server: String = "stopped",           // starting | listening | failed | stopped
  var serverError: String = "",             // last listener error (shown in the server card)
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
  var audioHz: Double = 0.0,
  var videoKbps: Double = 0.0,
  var encoderDropped: Long = 0,
  var configVersion: Int = 0,
  var remoteControlled: Boolean = false,
  var blackScreen: Boolean = false,         // session.black_screen (phone button or remote)
  var writer: String = "",
  var frameWidth: Int = 0,                  // current video format (sensor orientation)
  var frameHeight: Int = 0,
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
  val ar = ArSource(ctx)
  val imu = ImuSource(ctx)
  val audio = AudioSource(ctx)
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
  private val audioCounter = RateCounter()
  private var depthSeq = 0L
  private var depthFrameIndex = 0L
  @Volatile private var background = false
  private val deniedPermissions = HashSet<String>()
  private val pendingPermissions = HashSet<String>()
  private val videoBytes = ByteRate()
  private var videoSeq = 0L
  @Volatile private var clientList: List<Client> = emptyList()
  private var previewSurface: Surface? = null
  private var previewTexture: SurfaceTexture? = null

  var onStatus: ((Status) -> Unit)? = null
  var onConfigChanged: ((DeviceConfig) -> Unit)? = null
  var onModeChanged: (() -> Unit)? = null
  /**
   * Asks the user for a runtime permission and reports the answer. Set by the Expo module,
   * which owns the activity; without it a missing permission is only reported as an error.
   */
  var requestPermission: ((String, (Boolean) -> Unit) -> Unit)? = null
    set(value) { field = value; audio.requestPermission = value }

  init {
    val env = ConfigEnvironment()
    ar.probe()
    env.arAvailable = ar.supported
    env.arVideoFormats = ar.videoFormats
    env.lenses = camera.lenses.map { it.lens }
    env.cameraFormats = camera.lenses.associate { it.lens to it.formats }
    env.imuAvailable = imu.available
    env.depthAvailable = ar.supported && ar.depthSupported
    env.audioAvailable = AudioSource.available(ctx)
    env.camera = CameraRanges.probe(camera.lenses.firstOrNull()?.characteristics)
    config = ConfigStore(env)
    camera.lenses.firstOrNull()?.let {
      if (!it.timestampsRealtime) Log.i(TAG, "camera timestamps are not CLOCK_BOOTTIME on this device; they are moved onto it (cameraTimeToDeviceNs)")
    }

    control.onConnect = { c -> queue.execute { clientConnected(c) } }
    control.onDisconnect = { c -> queue.execute { clientDisconnected(c) } }
    control.onMessage = { c, m -> queue.execute { handle(c, m) } }
    data.onAttach = { id, sink -> attachData(id, sink) }
    control.onAttachWs = { id, sink -> attachWs(id, sink) }
    imu.onSample = { s -> publishImu(s) }
    ar.onPose = { p -> publishPose(p) }
    ar.onDepth = { d -> publishDepth(d) }
    ar.onError = { e -> lastError = e }
    ar.wantVideo = { file.isRecording || clientList.any { it.subscribed.contains("rgb") && it.hasFrameSink } }
    audio.onChunk = { c -> publishAudio(c) }
    audio.onError = { e -> lastError = e }
    if (ar.installNeeded) lastError = "Install or update Google Play Services for AR, then reopen the app to use AR mode"
    encoder.onFrame = { f -> publishVideo(f) }
    camera.onError = { e -> lastError = e }
    queue.scheduleAtFixedRate({ try { emitStatus() } catch (e: Exception) { Log.w(TAG, "status failed: $e") } }, 200, 200, TimeUnit.MILLISECONDS)
  }

  val isCameraMode: Boolean get() = config.isCameraMode

  // MARK: app lifecycle (§11): no background capture, but the foreground must recover.

  /** The activity is no longer visible: Android takes the camera away anyway. */
  fun enterBackground() {
    queue.execute {
      if (background) return@execute
      background = true
      stopSources()
      // Free the ports so another copy of the app (store build + dev build) can listen.
      control.stop()
      data.stop()
      clientList = emptyList()
    }
  }

  fun enterForeground() {
    queue.execute {
      if (!background) return@execute
      background = false
      control.restart()
      data.restart()
      clientList = emptyList()
      if (sessionRunning || previewEnabled) restartSources()
    }
  }

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

  /** Protocol v5: a browser's second WebSocket carries every stream for this client. */
  private fun attachWs(id: Int, sink: WsSink): Boolean {
    return try {
      queue.submit<Boolean> {
        val c = control.client(id) ?: return@submit false
        c.ws?.disconnect()
        c.ws = sink
        sink.onDroppedVideo = { encoder.requestKeyframe() }
        sink.onClosed = { if (c.ws === sink) c.ws = null }
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
      deniedPermissions.clear()
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
      if (enabled) deniedPermissions.clear()
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
      previewChanged()
    }
  }

  /** A preview view went away; ignored if another view has taken over since. */
  fun clearPreviewTexture(texture: SurfaceTexture) {
    queue.execute {
      if (previewTexture !== texture) return@execute
      previewSurface?.release()
      previewSurface = null
      previewTexture = null
      previewChanged()
    }
  }

  /**
   * The preview surface appeared or went away (full-screen toggle, preview switched off).
   * IMU and audio keep running. In AR mode the renderer just swaps its output; Camera2
   * needs a new capture session, so camera-mode video restarts (a short gap, then a keyframe).
   */
  private fun previewChanged() {
    if (background || !(sessionRunning || previewEnabled)) return
    if (!isCameraMode && ar.running) {
      previewTexture?.setDefaultBufferSize(ar.width, ar.height)
      ar.setPreview(if (previewTexture != null) previewSurface else null)
    } else {
      stopVideo()
      startVideo()
    }
    onModeChanged?.invoke()
  }

  private fun stopVideo() {
    camera.stop()
    ar.stop()
    encoder.stop()
  }

  private fun stopSources() {
    stopVideo()
    imu.stop()
    audio.stop()
  }

  /**
   * True when `permission` is granted. Otherwise asks once (the sources restart when the
   * user answers) and returns false; after a refusal it stays false until the next
   * explicit start, so a denied dialog is not shown in a loop.
   */
  private fun ensurePermission(permission: String): Boolean {
    if (ctx.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED) return true
    val ask = requestPermission
    if (ask == null || permission in deniedPermissions) return false
    if (pendingPermissions.add(permission)) {
      ask(permission) { ok ->
        queue.execute {
          pendingPermissions.remove(permission)
          if (!ok) deniedPermissions.add(permission)
          if (sessionRunning || previewEnabled) restartSources()
        }
      }
    }
    return false
  }

  private fun restartSources() {
    stopSources()
    if (background || !(sessionRunning || previewEnabled)) return
    startVideo()
    if (sessionRunning && config.isEnabled("imu") && imu.available) {
      imu.start(config.int("imu", "rate_hz").coerceAtLeast(10), config.bool("imu", "raw"))
    }
    restartAudio()
    // Preview views re-layout for the (possibly new) format.
    onModeChanged?.invoke()
  }

  /** Camera (or AR) plus the encoder, for the current mode and format. */
  private fun startVideo() {
    val wantEncoder = sessionRunning && config.isEnabled("rgb")
    val bitrate = config.int("rgb", "bitrate_kbps") * 1000
    val gop = config.int("rgb", "keyframe_interval").coerceAtLeast(1)
    if (!ensurePermission(Manifest.permission.CAMERA)) {
      lastError = "camera permission needed (Settings > Apps > iMuninn > Permissions)"
    } else if (isCameraMode) {
      val lens = config.string("rgb", "lens").ifEmpty { "wide" }
      val fmt = config.string("rgb", "camera_format").ifEmpty { camera.formats(lens).firstOrNull() ?: "" }
      val (w, h, fps) = CameraSource.parse(fmt).takeIf { it.first > 0 } ?: Triple(1280, 720, 30)
      val targets = ArrayList<Surface>()
      previewTexture?.let { t ->
        t.setDefaultBufferSize(w, h)
        previewSurface?.let { targets += it }
      }
      if (wantEncoder) encoder.start(w, h, fps, bitrate, gop)?.let { targets += it }
      if (targets.isNotEmpty()) {
        if (lastError.startsWith("camera permission")) lastError = ""
        camera.start(lens, fmt, config.cameraSettings(), targets)
      }
    } else if ((config.isEnabled("ar_pose") || config.isEnabled("rgb")) && ar.supported) {
      val fmt = config.string("ar_pose", "video_format").ifEmpty { ar.videoFormats.firstOrNull() ?: "" }
      val (w, h, fps) = CameraSource.parse(fmt).takeIf { it.first > 0 } ?: Triple(1920, 1080, 30)
      previewTexture?.setDefaultBufferSize(w, h)
      val enc = if (wantEncoder) encoder.start(w, h, fps, bitrate, gop) else null
      if (lastError.startsWith("camera permission")) lastError = ""
      ar.start(fmt, config.cameraSettings(), config.isEnabled("depth"), config.bool("depth", "smoothed"),
        enc, if (previewTexture != null) previewSurface else null)
    }
  }

  /**
   * The microphone only runs while capturing (never for the local preview) and restarts on
   * its own, so audio parameter changes do not interrupt the camera.
   */
  private fun restartAudio() {
    audio.stop()
    if (!background && sessionRunning && config.isEnabled(AudioSource.STREAM_ID)) audio.start(config.audioSettings())
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
        else -> when {
          c.stream == "audio" -> restartAudio()
          c.stream == "rgb" && c.key in CameraControl.cameraKeys ->
            if (isCameraMode) camera.applyCamera(config.cameraSettings()) else ar.applyCamera(config.cameraSettings())
        }
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
    for (c in clientList) if (c.subscribed.contains(ImuSource.STREAM_ID)) c.sendSample(msg)
    if (file.isRecording) file.write(msg)
  }

  private fun publishPose(p: io.imuninn.proto.PoseSample) {
    poseCounter.tick()
    if (!sessionRunning) return
    val msg = DataMessage.newBuilder().setPose(p.toBuilder().setHeader(stamp(p.header.toBuilder()))).build()
    for (c in clientList) if (c.subscribed.contains(ArSource.POSE_STREAM_ID)) c.sendSample(msg)
    if (file.isRecording) file.write(msg)
  }

  private fun publishAudio(a: io.imuninn.proto.AudioChunk) {
    audioCounter.tick()
    if (!sessionRunning) return
    val msg = DataMessage.newBuilder().setAudio(a.toBuilder().setHeader(stamp(a.header.toBuilder()))).build()
    // Reliable, in order, never skipped: a missing chunk is an audible click.
    for (c in clientList) if (c.subscribed.contains(AudioSource.STREAM_ID)) c.sendFrame(msg, droppable = false, keyframe = true)
    if (file.isRecording) file.write(msg)
  }

  private fun publishDepth(d: DepthData) {
    if (!sessionRunning) return
    depthFrameIndex++
    val divisor = config.int("depth", "rate_divisor").coerceAtLeast(1)
    if (depthFrameIndex % divisor != 0L) return
    val wanted = file.isRecording || clientList.any { it.subscribed.contains("depth") && it.hasFrameSink }
    if (!wanted) return
    val compress = config.string("depth", "compression") != "none"
    depthCounter.tick()
    val conf = d.confidence
    val f = DepthFrame.newBuilder()
      .setHeader(stamp(Header.newBuilder().setStreamId("depth").setSeq(depthSeq++).setDeviceTimeNs(d.timeNs)))
      .setWidth(d.width).setHeight(d.height)
      .setCompression(if (compress) DepthCompression.DEPTH_COMPRESSION_LZ4 else DepthCompression.DEPTH_COMPRESSION_NONE)
      .setDepthMm(com.google.protobuf.ByteString.copyFrom(if (compress) DepthPacker.appleLz4(d.depthMm) else d.depthMm))
      .setIntrinsics(Intrinsics.newBuilder().setWidth(d.width).setHeight(d.height).setFx(d.fx).setFy(d.fy).setCx(d.cx).setCy(d.cy))
      .setRotationDeg(ar.rotationDeg)
    if (conf != null) f.confidence = com.google.protobuf.ByteString.copyFrom(if (compress) DepthPacker.appleLz4(conf) else conf)
    val msg = DataMessage.newBuilder().setDepth(f).build()
    // Independent frames: never block, never skip for resync.
    for (c in clientList) if (c.subscribed.contains("depth")) c.sendFrame(msg, droppable = true, keyframe = true)
    if (file.isRecording) file.write(msg)
  }

  private fun publishVideo(f: EncodedFrame) {
    videoCounter.tick()
    videoBytes.add(f.data.size)
    val arMode = !isCameraMode
    val k = if (arMode) ar.intrinsics else camera.intrinsics()
    val v = VideoFrame.newBuilder()
      .setHeader(stamp(Header.newBuilder().setStreamId("rgb").setSeq(videoSeq++).setDeviceTimeNs(cameraTimeToDeviceNs(f.timeNs))))
      .setFormat(PixelFormat.PIXEL_FORMAT_H264_NAL)
      .setWidth(f.width).setHeight(f.height)
      .setKeyframe(f.keyframe)
      .setData(com.google.protobuf.ByteString.copyFrom(f.data))
      .setRotationDeg(if (arMode) ar.rotationDeg else camera.rotationDeg)
    if (k != null) {
      v.intrinsics = Intrinsics.newBuilder().setWidth(f.width).setHeight(f.height)
        .setFx(k.fx).setFy(k.fy).setCx(k.cx).setCy(k.cy).build()
    }
    val msg = DataMessage.newBuilder().setVideo(v).build()
    for (c in clientList) if (c.subscribed.contains("rgb")) c.sendFrame(msg, droppable = true, keyframe = f.keyframe)
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
    s.serverError = control.lastError
    s.serviceName = serviceName
    s.addresses = NetInfo.ipv4Addresses().map { "${it.first} ${it.second}" }
    s.controlPort = control.port
    s.tcpPort = data.port
    s.clients = clientList.map {
      ClientStatus(it.id, it.label, it.remoteHost?.hostAddress ?: "", it.subscribed.sorted(),
        it.udp.dropped, it.frameDropped, it.isWriter)
    }
    s.mode = if (isCameraMode) "camera" else "ar"
    s.sessionRunning = sessionRunning
    s.previewing = previewEnabled || sessionRunning
    s.blackScreen = config.sessionBool("black_screen")
    s.tracking = if (isCameraMode) "none" else ar.tracking
    s.poseHz = poseCounter.rate()
    s.imuHz = imuCounter.rate()
    s.videoHz = videoCounter.rate()
    s.depthHz = depthCounter.rate()
    s.audioHz = audioCounter.rate()
    s.videoKbps = videoBytes.kbps()
    s.encoderDropped = encoder.dropped
    s.configVersion = config.snapshot().configVersion
    s.remoteControlled = remoteControlled
    s.writer = writerName
    val (fw, fh, _) = CameraSource.parse(if (isCameraMode) camera.formatId else ar.videoFormatId)
    s.frameWidth = fw; s.frameHeight = fh
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
    h.poseHz = poseCounter.peek(); h.imuHz = imuCounter.peek(); h.videoFps = videoCounter.peek(); h.depthHz = depthCounter.peek(); h.audioHz = audioCounter.peek()
    h.videoKbps = videoBytes.peek()
    h.encoderDropped = encoder.dropped
    h.uptimeS = (deviceTimeNs() - startNs) / 1e9
    val msg = DataMessage.newBuilder().setHealth(h).build()
    for (c in clientList) if (c.subscribed.contains("health")) c.sendSample(msg)
    if (file.isRecording) file.write(msg)
  }

  // MARK: helpers

  /** What the preview view needs to lay the picture out; null while nothing is running. */
  class PreviewGeometry(
    val width: Int, val height: Int,
    /** Clockwise degrees that turn the sensor image upright in the phone's natural orientation. */
    val sensorOrientation: Int,
    /** Camera2 already rotates the buffer for the natural orientation; our GL (AR) output is raw. */
    val prerotated: Boolean,
  )

  fun previewGeometry(): PreviewGeometry? {
    return if (isCameraMode) {
      if (camera.width <= 0) null else PreviewGeometry(camera.width, camera.height, camera.rotationDeg, true)
    } else {
      if (ar.width <= 0) null else PreviewGeometry(ar.width, ar.height, ar.rotationDeg, false)
    }
  }

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
