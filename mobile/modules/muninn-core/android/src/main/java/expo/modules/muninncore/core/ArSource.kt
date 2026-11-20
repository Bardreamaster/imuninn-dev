// ARCore world-tracking source (§5.2): pose + intrinsics every frame, the camera image for
// the encoder and the preview, and depth from the ARCore Depth API. Port of
// ios/Core/ArSource.swift.
//
// How the image gets to the encoder: ARCore owns the camera and fills one external (OES)
// GL texture per frame. This class owns a GL thread with its own EGL context, runs
// session.update() there, and draws that texture into the encoder's input surface and the
// preview surface. The pixels never leave the GPU (§8.1), same as the Camera2 path.
//
// Conventions shared with iOS:
//  - the pose is Camera.getPose(): the physical camera, +X right / +Y up / -Z forward
//    relative to the image readout (sensor-native landscape), world Y up (gravity);
//  - the video frame is the sensor-native landscape image, rotation_deg = sensor orientation;
//  - intrinsics are those of the image that is sent (the GPU texture).
// Depth comes from the Depth API (depth from motion; ToF is used when the phone has one),
// so its range and accuracy are below LiDAR. It is uint16 millimetres, the protocol's unit.
package expo.modules.muninncore.core

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import com.google.ar.core.ArCoreApk
import com.google.ar.core.CameraConfig
import com.google.ar.core.CameraConfigFilter
import com.google.ar.core.Config
import com.google.ar.core.Coordinates2d
import com.google.ar.core.Frame
import com.google.ar.core.Session
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.NotYetAvailableException
import com.google.ar.core.exceptions.SessionPausedException
import io.imuninn.proto.Header
import io.imuninn.proto.Intrinsics
import io.imuninn.proto.PoseSample
import io.imuninn.proto.Quat
import io.imuninn.proto.Vec3
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.EnumSet
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** One depth image, ready for the wire. Intrinsics are already scaled to the depth size. */
class DepthData(
  val width: Int, val height: Int,
  val depthMm: ByteArray,          // uint16 LE, row-major
  val confidence: ByteArray?,      // uint8 0..2, null if unavailable
  val timeNs: Long,
  val fx: Double, val fy: Double, val cx: Double, val cy: Double,
)

class ArSource(private val ctx: Context) {
  companion object {
    const val POSE_STREAM_ID = "ar_pose"

    /** ARCore availability from Google Play Services for AR; waits briefly while it is still checking. */
    fun availability(ctx: Context): ArCoreApk.Availability {
      return try {
        var a = ArCoreApk.getInstance().checkAvailability(ctx)
        var tries = 0
        while (a.isTransient && tries++ < 8) {
          Thread.sleep(200)
          a = ArCoreApk.getInstance().checkAvailability(ctx)
        }
        a
      } catch (e: Throwable) {
        Log.w(TAG, "arcore availability check failed: $e")
        ArCoreApk.Availability.UNKNOWN_ERROR
      }
    }
  }

  private val thread = HandlerThread("imuninn.ar").apply { start() }
  private val handler = Handler(thread.looper)
  private var session: Session? = null
  private val configs = LinkedHashMap<String, CameraConfig>()   // format id -> camera config

  /** AR mode can be offered: ARCore is installed and a session could be created. */
  var supported = false
    private set
  var depthSupported = false
    private set
  /** The phone supports ARCore but Google Play Services for AR is missing or too old. */
  var installNeeded = false
    private set
  val videoFormats: List<String> get() = configs.keys.toList()

  @Volatile var running = false
    private set
  @Volatile var tracking: String = "none"     // none | limited | normal
    private set
  @Volatile var videoFormatId = ""
    private set
  @Volatile var width = 0
    private set
  @Volatile var height = 0
    private set
  /** Sensor orientation of ARCore's camera: how far to rotate the image to upright (portrait). */
  @Volatile var rotationDeg = 90
    private set
  /** Intrinsics of the image that is drawn into the encoder (the GPU texture). */
  @Volatile var intrinsics: CameraIntrinsics? = null
    private set

  var onPose: ((PoseSample) -> Unit)? = null
  var onDepth: ((DepthData) -> Unit)? = null
  var onError: ((String) -> Unit)? = null
  /** Whether anyone wants video right now; drawing into the encoder is skipped otherwise. */
  var wantVideo: (() -> Boolean)? = null

  private var seq = 0L
  private var depthEnabled = false
  private var depthSmoothed = true
  private var lastFrameTs = 0L
  private var lastDepthTs = 0L

  // GL state (AR thread only)
  private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
  private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
  private var eglConfig: EGLConfig? = null
  private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
  private var encoderSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var previewSurface: EGLSurface = EGL14.EGL_NO_SURFACE
  private var texture = 0
  private var program = 0
  private var aPos = 0
  private var aTex = 0
  private val quad: FloatBuffer = floats(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
  private var texCoords: FloatBuffer? = null

  // MARK: probing (once, at startup)

  /** Finds out what this phone offers. Creates the ARCore session, which is kept for start(). */
  fun probe() {
    when (val a = availability(ctx)) {
      ArCoreApk.Availability.SUPPORTED_INSTALLED -> {}
      ArCoreApk.Availability.SUPPORTED_NOT_INSTALLED, ArCoreApk.Availability.SUPPORTED_APK_TOO_OLD -> {
        installNeeded = true
        Log.i(TAG, "arcore: $a (Google Play Services for AR must be installed / updated)")
        return
      }
      else -> { Log.i(TAG, "arcore: $a, AR mode not offered"); return }
    }
    try {
      val s = Session(ctx)
      val filter = CameraConfigFilter(s)
        .setTargetFps(EnumSet.of(CameraConfig.TargetFps.TARGET_FPS_30, CameraConfig.TargetFps.TARGET_FPS_60))
        .setFacingDirection(CameraConfig.FacingDirection.BACK)
      val best = HashMap<String, CameraConfig>()
      for (c in s.getSupportedCameraConfigs(filter)) {
        val id = formatId(c)
        val cur = best[id]
        if (cur == null || score(c) > score(cur)) best[id] = c
      }
      // ARCore's own default first (it becomes the default video_format), then by size and rate.
      val defaultId = formatId(s.cameraConfig)
      best[defaultId]?.let { configs[defaultId] = it }
      for (id in best.keys.sortedWith(compareBy({ -CameraSource.parse(it).first }, { CameraSource.parse(it).third }))) {
        if (id != defaultId) configs[id] = best.getValue(id)
      }
      depthSupported = s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)
      session = s
      supported = configs.isNotEmpty()
      Log.i(TAG, "arcore ready: formats ${configs.keys}, depth $depthSupported")
    } catch (e: Throwable) {
      Log.w(TAG, "arcore session could not be created: $e")
    }
  }

  private fun formatId(c: CameraConfig): String =
    "${c.textureSize.width}x${c.textureSize.height}@${c.fpsRange.upper}"

  /** Prefer a CPU image with the texture's aspect (same field of view), then the smallest one. */
  private fun score(c: CameraConfig): Int {
    val t = c.textureSize; val i = c.imageSize
    val sameAspect = t.width * i.height == t.height * i.width
    return (if (sameAspect) 1_000_000_000 else 0) - i.width * i.height
  }

  // MARK: control

  /**
   * Starts tracking and draws every camera frame into `encoder` and `preview` (either may be null).
   * The camera permission must already be granted.
   */
  fun start(formatId: String, camera: CameraSettings, depth: Boolean, smoothed: Boolean, encoder: Surface?, preview: Surface?) {
    stop()
    val s = session ?: run { onError?.invoke("ARCore not available"); return }
    val cfg = configs[formatId] ?: configs.values.firstOrNull() ?: run { onError?.invoke("no AR video format"); return }
    val id = formatId(cfg)
    videoFormatId = id
    width = cfg.textureSize.width; height = cfg.textureSize.height
    rotationDeg = sensorOrientation(cfg.cameraId)
    running = true
    handler.post {
      try {
        ensureGl()
        s.cameraConfig = cfg
        depthEnabled = depth && depthSupported
        depthSmoothed = smoothed
        s.configure(buildConfig(s, camera))
        s.setCameraTextureName(texture)
        s.setDisplayGeometry(Surface.ROTATION_0, width, height)
        encoderSurface = windowSurface(encoder)
        previewSurface = windowSurface(preview)
        if (previewSurface != EGL14.EGL_NO_SURFACE) {
          // The preview must never throttle the capture loop to the display's refresh.
          EGL14.eglMakeCurrent(eglDisplay, previewSurface, previewSurface, eglContext)
          EGL14.eglSwapInterval(eglDisplay, 0)
        }
        EGL14.eglMakeCurrent(eglDisplay, pbuffer, pbuffer, eglContext)
        texCoords = null
        lastFrameTs = 0; lastDepthTs = 0
        s.resume()
        Log.i(TAG, "arcore started $id depth=$depthEnabled smoothed=$depthSmoothed")
        handler.post(loop)
      } catch (e: Throwable) {
        Log.w(TAG, "arcore start failed: $e")
        running = false
        onError?.invoke("AR session: ${e.message ?: e.javaClass.simpleName}")
        releaseSurfaces()
      }
    }
  }

  /** Stops tracking and waits until the GL thread has let go of the surfaces. */
  fun stop() {
    if (!running && encoderSurface == EGL14.EGL_NO_SURFACE && previewSurface == EGL14.EGL_NO_SURFACE) return
    running = false
    tracking = "none"
    val done = CountDownLatch(1)
    handler.post {
      try { session?.pause() } catch (e: Throwable) { Log.w(TAG, "arcore pause failed: $e") }
      releaseSurfaces()
      done.countDown()
    }
    if (Thread.currentThread() !== thread) {
      try { done.await(3, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
    }
  }

  /** Swaps the preview output while tracking keeps running; waits until the old surface is released. */
  fun setPreview(preview: Surface?) {
    if (!running) return
    val done = CountDownLatch(1)
    handler.post {
      try {
        previewSurface = destroy(previewSurface)
        previewSurface = windowSurface(preview)
        if (previewSurface != EGL14.EGL_NO_SURFACE) {
          EGL14.eglMakeCurrent(eglDisplay, previewSurface, previewSurface, eglContext)
          EGL14.eglSwapInterval(eglDisplay, 0)
          EGL14.eglMakeCurrent(eglDisplay, pbuffer, pbuffer, eglContext)
        }
      } catch (e: Throwable) {
        Log.w(TAG, "preview surface swap failed: $e")
      }
      done.countDown()
    }
    try { done.await(2, TimeUnit.SECONDS) } catch (_: InterruptedException) {}
  }

  /** rgb.* camera controls ARCore exposes: focus (auto / fixed) and the torch. The rest is ARCore's. */
  fun applyCamera(camera: CameraSettings) {
    val s = session ?: return
    if (!running) return
    handler.post {
      try { s.configure(buildConfig(s, camera)) } catch (e: Throwable) { Log.w(TAG, "arcore configure failed: $e") }
    }
  }

  private fun buildConfig(s: Session, camera: CameraSettings): Config {
    val c = Config(s)
    c.updateMode = Config.UpdateMode.BLOCKING          // update() returns once per camera frame
    c.planeFindingMode = Config.PlaneFindingMode.DISABLED
    c.lightEstimationMode = Config.LightEstimationMode.DISABLED
    c.focusMode = if (camera.focusMode == "auto") Config.FocusMode.AUTO else Config.FocusMode.FIXED
    c.depthMode = when {
      !depthEnabled -> Config.DepthMode.DISABLED
      !depthSmoothed && s.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY) -> Config.DepthMode.RAW_DEPTH_ONLY
      else -> Config.DepthMode.AUTOMATIC
    }
    try {
      c.flashMode = if (camera.torch) Config.FlashMode.TORCH else Config.FlashMode.OFF
    } catch (e: Throwable) {
      Log.w(TAG, "arcore torch not available: $e")
    }
    return c
  }

  private fun sensorOrientation(cameraId: String): Int = try {
    val m = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
    m.getCameraCharacteristics(cameraId).get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
  } catch (_: Exception) { 90 }

  // MARK: frame loop (AR thread). Images are closed before returning (§8.5).

  private val loop = object : Runnable {
    override fun run() {
      if (!running) return
      val s = session ?: return
      try {
        val frame = s.update()
        val ts = frame.androidCameraTimestamp
        if (ts != 0L && ts != lastFrameTs) {
          lastFrameTs = ts
          handle(frame, cameraTimeToDeviceNs(ts))
        }
      } catch (_: SessionPausedException) {
        return
      } catch (e: Throwable) {
        Log.w(TAG, "arcore frame failed: $e")
        if (running) onError?.invoke("AR frame: ${e.message ?: e.javaClass.simpleName}")
        // Keep trying at a low rate: the camera comes back after an interruption.
        if (running) handler.postDelayed(this, 500)
        return
      }
      handler.post(this)
    }
  }

  private fun handle(frame: Frame, timeNs: Long) {
    val cam = frame.camera
    tracking = when (cam.trackingState) {
      TrackingState.TRACKING -> "normal"
      TrackingState.PAUSED -> "limited"
      else -> "none"
    }
    val ti = cam.textureIntrinsics
    val f = ti.focalLength; val pp = ti.principalPoint; val dims = ti.imageDimensions
    val k = CameraIntrinsics(dims[0], dims[1], f[0].toDouble(), f[1].toDouble(), pp[0].toDouble(), pp[1].toDouble())
    intrinsics = k

    val pose = cam.pose
    onPose?.invoke(PoseSample.newBuilder()
      .setHeader(Header.newBuilder().setStreamId(POSE_STREAM_ID).setSeq(seq++).setDeviceTimeNs(timeNs))
      .setPosition(Vec3.newBuilder().setX(pose.tx().toDouble()).setY(pose.ty().toDouble()).setZ(pose.tz().toDouble()))
      .setOrientation(Quat.newBuilder().setX(pose.qx().toDouble()).setY(pose.qy().toDouble()).setZ(pose.qz().toDouble()).setW(pose.qw().toDouble()))
      .setTracking(when (cam.trackingState) {
        TrackingState.TRACKING -> io.imuninn.proto.TrackingState.TRACKING_STATE_NORMAL
        TrackingState.PAUSED -> io.imuninn.proto.TrackingState.TRACKING_STATE_LIMITED
        else -> io.imuninn.proto.TrackingState.TRACKING_STATE_NOT_AVAILABLE
      })
      .setIntrinsics(Intrinsics.newBuilder().setWidth(k.width).setHeight(k.height).setFx(k.fx).setFy(k.fy).setCx(k.cx).setCy(k.cy))
      .build())

    if (texCoords == null) texCoords = textureCoordinates(frame)
    if (encoderSurface != EGL14.EGL_NO_SURFACE && wantVideo?.invoke() != false) {
      if (!draw(encoderSurface, timeNs)) { Log.w(TAG, "encoder surface lost"); encoderSurface = destroy(encoderSurface) }
    }
    if (previewSurface != EGL14.EGL_NO_SURFACE) {
      if (!draw(previewSurface, 0)) previewSurface = destroy(previewSurface)
    }
    if (depthEnabled) depth(frame, timeNs)
  }

  private fun depth(frame: Frame, frameTimeNs: Long) {
    val image = try {
      if (depthSmoothed) frame.acquireDepthImage16Bits() else frame.acquireRawDepthImage16Bits()
    } catch (_: NotYetAvailableException) {
      return   // needs a second or two of motion first
    } catch (e: Throwable) {
      Log.w(TAG, "depth unavailable: $e"); return
    }
    try {
      if (image.timestamp == lastDepthTs) return   // depth updates slower than the camera
      lastDepthTs = image.timestamp
      val w = image.width; val h = image.height
      val mm = DepthPacker.depth16(image)
      var conf: ByteArray? = null
      if (!depthSmoothed) {
        try {
          val ci = frame.acquireRawDepthConfidenceImage()
          try { if (ci.width == w && ci.height == h) conf = DepthPacker.confidence(ci) } finally { ci.close() }
        } catch (_: Throwable) {}
      }
      // The depth image covers the CPU camera image's field of view: scale those intrinsics.
      val ii = frame.camera.imageIntrinsics
      val d = ii.imageDimensions
      val sx = w.toDouble() / d[0]; val sy = h.toDouble() / d[1]
      // Depth timestamps are on ARCore's frame clock; carry the offset over to the device clock.
      val t = frameTimeNs + (image.timestamp - frame.timestamp)
      onDepth?.invoke(DepthData(w, h, mm, conf, t,
        ii.focalLength[0] * sx, ii.focalLength[1] * sy, ii.principalPoint[0] * sx, ii.principalPoint[1] * sy))
    } finally {
      image.close()
    }
  }

  // MARK: GL (AR thread)

  private fun floats(vararg v: Float): FloatBuffer =
    ByteBuffer.allocateDirect(v.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(v); position(0) }

  /**
   * Texture coordinates for the four quad corners so the image appears in readout order
   * (top-left first). ARCore says how image coordinates map onto the texture; each corner
   * is snapped to the texture's own corner so the whole texture is drawn (the intrinsics
   * sent are the texture's, see `handle`).
   */
  private fun textureCoordinates(frame: Frame): FloatBuffer {
    // Quad order: bottom-left, bottom-right, top-left, top-right; image v grows downwards.
    val image = floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)
    val tex = FloatArray(8)
    try {
      frame.transformCoordinates2d(Coordinates2d.IMAGE_NORMALIZED, image, Coordinates2d.TEXTURE_NORMALIZED, tex)
      for (i in tex.indices) tex[i] = if (tex[i] < 0.5f) 0f else 1f
    } catch (e: Throwable) {
      Log.w(TAG, "texture coordinates unavailable, assuming identity: $e")
      System.arraycopy(image, 0, tex, 0, 8)
    }
    return floats(*tex)
  }

  private fun ensureGl() {
    if (eglContext != EGL14.EGL_NO_CONTEXT) return
    val d = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    val version = IntArray(2)
    check(EGL14.eglInitialize(d, version, 0, version, 1)) { "eglInitialize failed" }
    val attribs = intArrayOf(
      EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
      EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
      EGLExt.EGL_RECORDABLE_ANDROID, 1,   // required for MediaCodec input surfaces
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
      EGL14.EGL_NONE,
    )
    val cfgs = arrayOfNulls<EGLConfig>(1)
    val n = IntArray(1)
    check(EGL14.eglChooseConfig(d, attribs, 0, cfgs, 0, 1, n, 0) && n[0] > 0) { "no EGL config" }
    val cfg = cfgs[0]!!
    val ctxAttribs = intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE)
    val c = EGL14.eglCreateContext(d, cfg, EGL14.EGL_NO_CONTEXT, ctxAttribs, 0)
    check(c != EGL14.EGL_NO_CONTEXT) { "eglCreateContext failed" }
    val pb = EGL14.eglCreatePbufferSurface(d, cfg, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
    check(EGL14.eglMakeCurrent(d, pb, pb, c)) { "eglMakeCurrent failed" }
    eglDisplay = d; eglConfig = cfg; eglContext = c; pbuffer = pb

    val tex = IntArray(1)
    GLES20.glGenTextures(1, tex, 0)
    texture = tex[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

    val vs = shader(GLES20.GL_VERTEX_SHADER,
      "attribute vec4 aPos; attribute vec2 aTex; varying vec2 vTex; void main() { gl_Position = aPos; vTex = aTex; }")
    val fs = shader(GLES20.GL_FRAGMENT_SHADER,
      "#extension GL_OES_EGL_image_external : require\n" +
        "precision mediump float; varying vec2 vTex; uniform samplerExternalOES sTex; " +
        "void main() { gl_FragColor = texture2D(sTex, vTex); }")
    program = GLES20.glCreateProgram()
    GLES20.glAttachShader(program, vs)
    GLES20.glAttachShader(program, fs)
    GLES20.glLinkProgram(program)
    val ok = IntArray(1)
    GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, ok, 0)
    check(ok[0] != 0) { "GL program link failed: ${GLES20.glGetProgramInfoLog(program)}" }
    aPos = GLES20.glGetAttribLocation(program, "aPos")
    aTex = GLES20.glGetAttribLocation(program, "aTex")
  }

  private fun shader(type: Int, src: String): Int {
    val s = GLES20.glCreateShader(type)
    GLES20.glShaderSource(s, src)
    GLES20.glCompileShader(s)
    val ok = IntArray(1)
    GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
    check(ok[0] != 0) { "GL shader compile failed: ${GLES20.glGetShaderInfoLog(s)}" }
    return s
  }

  private fun windowSurface(surface: Surface?): EGLSurface {
    if (surface == null || !surface.isValid) return EGL14.EGL_NO_SURFACE
    return try {
      EGL14.eglCreateWindowSurface(eglDisplay, eglConfig, surface, intArrayOf(EGL14.EGL_NONE), 0)
    } catch (e: Throwable) {
      Log.w(TAG, "eglCreateWindowSurface failed: $e")
      EGL14.EGL_NO_SURFACE
    }
  }

  /** Draws the camera texture over the whole surface. `timeNs` > 0 stamps the frame for the encoder. */
  private fun draw(target: EGLSurface, timeNs: Long): Boolean {
    val tc = texCoords ?: return true
    if (!EGL14.eglMakeCurrent(eglDisplay, target, target, eglContext)) return false
    GLES20.glViewport(0, 0, width, height)
    GLES20.glUseProgram(program)
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture)
    GLES20.glEnableVertexAttribArray(aPos)
    GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, quad)
    GLES20.glEnableVertexAttribArray(aTex)
    GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 0, tc)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    if (timeNs > 0) EGLExt.eglPresentationTimeANDROID(eglDisplay, target, timeNs)
    return EGL14.eglSwapBuffers(eglDisplay, target)
  }

  private fun destroy(s: EGLSurface): EGLSurface {
    if (s != EGL14.EGL_NO_SURFACE) {
      EGL14.eglMakeCurrent(eglDisplay, pbuffer, pbuffer, eglContext)
      EGL14.eglDestroySurface(eglDisplay, s)
    }
    return EGL14.EGL_NO_SURFACE
  }

  private fun releaseSurfaces() {
    if (eglDisplay == EGL14.EGL_NO_DISPLAY) return
    encoderSurface = destroy(encoderSurface)
    previewSurface = destroy(previewSurface)
  }
}
