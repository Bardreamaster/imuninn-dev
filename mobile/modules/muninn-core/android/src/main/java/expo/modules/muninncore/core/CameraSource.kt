// Pure camera mode (§4.2 "两种模式"): Camera2 with lens choice, no pose. Frames go
// directly to the given surfaces (preview TextureView and/or the encoder's input).
package expo.modules.muninncore.core

import android.content.Context
import android.graphics.Rect
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.media.MediaCodec
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Range
import android.view.Surface

data class CameraIntrinsics(val width: Int, val height: Int, val fx: Double, val fy: Double, val cx: Double, val cy: Double)

class CameraSource(ctx: Context) {
  class LensInfo(val cameraId: String, val lens: String, val characteristics: CameraCharacteristics) {
    val sensorOrientation: Int = characteristics.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
    val facingFront: Boolean = characteristics.get(CameraCharacteristics.LENS_FACING) == CameraMetadata.LENS_FACING_FRONT
    val focalMm: Float = characteristics.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: 0f
    /** Camera and sensor clocks share CLOCK_BOOTTIME only when this is REALTIME (§5.2 IMU note). */
    val timestampsRealtime: Boolean =
      characteristics.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE) == CameraMetadata.SENSOR_INFO_TIMESTAMP_SOURCE_REALTIME

    /** Format ids "WxH@fps" this lens offers for encoder (MediaCodec) output. */
    val formats: List<String> by lazy {
      val map = characteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP) ?: return@lazy emptyList()
      val sizes = map.getOutputSizes(MediaCodec::class.java) ?: emptyArray()
      val ids = ArrayList<String>()
      for (s in sizes) {
        if (s.width > 3840 || s.width < 640) continue
        val minDur = try { map.getOutputMinFrameDuration(MediaCodec::class.java, s) } catch (_: Exception) { 0L }
        val maxFps = if (minDur > 0) (1e9 / minDur).toInt() else 30
        for (fps in intArrayOf(120, 60, 30)) if (maxFps >= fps) ids += "${s.width}x${s.height}@$fps"
      }
      ids.distinct().sortedWith(compareBy({ parse(it).first }, { -parse(it).third }))
    }

    /**
     * Pinhole intrinsics at the given output size. LENS_INTRINSIC_CALIBRATION is rare;
     * otherwise derive fx from the focal length and the physical sensor size (§5.4).
     */
    fun intrinsics(width: Int, height: Int): CameraIntrinsics {
      val cal = characteristics.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION)
      val active: Rect? = characteristics.get(CameraCharacteristics.SENSOR_INFO_PRE_CORRECTION_ACTIVE_ARRAY_SIZE)
        ?: characteristics.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)
      if (cal != null && cal.size >= 4 && active != null && active.width() > 0 && cal[0] > 0f) {
        // Output is a centre crop/scale of the active array keeping aspect; scale by the output/array ratio.
        val sx = width.toDouble() / active.width()
        val sy = height.toDouble() / active.height()
        val s = maxOf(sx, sy)
        return CameraIntrinsics(width, height, cal[0] * s, cal[1] * s,
          (cal[2] - active.width() / 2.0) * s + width / 2.0, (cal[3] - active.height() / 2.0) * s + height / 2.0)
      }
      val phys = characteristics.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
      if (phys != null && focalMm > 0f && phys.width > 0f) {
        // Assume the output spans the full sensor width (true for 4:3; 16:9 crops rows, same fx).
        val fx = focalMm / phys.width * width
        return CameraIntrinsics(width, height, fx, fx, width / 2.0, height / 2.0)
      }
      return CameraIntrinsics(width, height, 0.0, 0.0, width / 2.0, height / 2.0)
    }
  }

  companion object {
    /** (width, height, fps) from "WxH@fps". */
    fun parse(id: String): Triple<Int, Int, Int> {
      val parts = id.split("@")
      val wh = parts.firstOrNull()?.split("x") ?: emptyList()
      return Triple(wh.getOrNull(0)?.toIntOrNull() ?: 0, wh.getOrNull(1)?.toIntOrNull() ?: 0, parts.getOrNull(1)?.toIntOrNull() ?: 0)
    }
  }

  private val manager = ctx.getSystemService(Context.CAMERA_SERVICE) as CameraManager
  private val thread = HandlerThread("imuninn.camera").apply { start() }
  private val handler = Handler(thread.looper)
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var request: CaptureRequest.Builder? = null
  private var targets: List<Surface> = emptyList()
  @Volatile var running = false
    private set
  var current: LensInfo? = null
    private set
  var formatId = ""
    private set
  var width = 0
    private set
  var height = 0
    private set
  var fps = 30
    private set
  private var exposureLocked = false
  private var focusLocked = false
  var onError: ((String) -> Unit)? = null

  /** Lenses by role: first back camera = wide; shorter/longer focal back cameras = ultra_wide/telephoto; front. */
  val lenses: List<LensInfo> by lazy {
    val out = ArrayList<LensInfo>()
    try {
      val backs = ArrayList<Pair<String, CameraCharacteristics>>()
      var front: Pair<String, CameraCharacteristics>? = null
      for (id in manager.cameraIdList) {
        val ch = manager.getCameraCharacteristics(id)
        when (ch.get(CameraCharacteristics.LENS_FACING)) {
          CameraMetadata.LENS_FACING_BACK -> backs += id to ch
          CameraMetadata.LENS_FACING_FRONT -> if (front == null) front = id to ch
        }
      }
      if (backs.isNotEmpty()) {
        val wide = backs.first()
        out += LensInfo(wide.first, "wide", wide.second)
        val wideFocal = wide.second.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: 0f
        for ((id, ch) in backs.drop(1)) {
          val f = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.firstOrNull() ?: 0f
          val role = when {
            f < wideFocal * 0.9f && out.none { it.lens == "ultra_wide" } -> "ultra_wide"
            f > wideFocal * 1.1f && out.none { it.lens == "telephoto" } -> "telephoto"
            else -> null
          } ?: continue
          out += LensInfo(id, role, ch)
        }
      }
      front?.let { out += LensInfo(it.first, "front", it.second) }
    } catch (e: Exception) {
      Log.w(TAG, "camera enumeration failed: $e")
    }
    out
  }

  fun lens(name: String): LensInfo? = lenses.firstOrNull { it.lens == name }
  fun formats(lens: String): List<String> = lens(lens)?.formats ?: emptyList()

  val rotationDeg: Int get() = current?.sensorOrientation ?: 90
  fun intrinsics(): CameraIntrinsics? = current?.intrinsics(width, height)

  /** Opens the lens and streams into `targets` (preview and/or encoder surfaces). */
  fun start(lensName: String, formatId: String, exposureLocked: Boolean, focusLocked: Boolean, targets: List<Surface>) {
    stop()
    val info = lens(lensName) ?: lenses.firstOrNull() ?: run { onError?.invoke("no camera"); return }
    val (w, h, f) = parse(formatId).takeIf { it.first > 0 } ?: parse(info.formats.firstOrNull() ?: "1280x720@30")
    current = info
    this.formatId = if (w > 0) "${w}x${h}@$f" else formatId
    width = w; height = h; fps = if (f > 0) f else 30
    this.exposureLocked = exposureLocked
    this.focusLocked = focusLocked
    this.targets = targets
    if (targets.isEmpty()) return
    running = true
    try {
      manager.openCamera(info.cameraId, object : CameraDevice.StateCallback() {
        override fun onOpened(cam: CameraDevice) {
          device = cam
          createSession(cam)
        }
        override fun onDisconnected(cam: CameraDevice) { cam.close(); if (device === cam) device = null }
        override fun onError(cam: CameraDevice, error: Int) {
          Log.w(TAG, "camera error $error")
          onError?.invoke("camera error $error")
          cam.close(); if (device === cam) device = null
        }
      }, handler)
    } catch (e: SecurityException) {
      running = false
      onError?.invoke("camera permission missing")
    } catch (e: CameraAccessException) {
      running = false
      onError?.invoke("camera unavailable: ${e.reason}")
    }
  }

  @Suppress("DEPRECATION")
  private fun createSession(cam: CameraDevice) {
    try {
      val b = cam.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
      for (t in targets) b.addTarget(t)
      applyControls(b)
      request = b
      cam.createCaptureSession(targets, object : CameraCaptureSession.StateCallback() {
        override fun onConfigured(s: CameraCaptureSession) {
          if (!running) { s.close(); return }
          session = s
          try { s.setRepeatingRequest(b.build(), null, handler) } catch (e: Exception) { Log.w(TAG, "camera request failed: $e") }
        }
        override fun onConfigureFailed(s: CameraCaptureSession) {
          Log.w(TAG, "camera session configure failed")
          onError?.invoke("camera session configure failed")
        }
      }, handler)
    } catch (e: Exception) {
      Log.w(TAG, "camera session failed: $e")
      onError?.invoke("camera session failed: $e")
    }
  }

  private fun applyControls(b: CaptureRequest.Builder) {
    b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
    b.set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, Range(fps, fps))
    b.set(CaptureRequest.CONTROL_AE_LOCK, exposureLocked)
    val afModes = current?.characteristics?.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
    val af = when {
      focusLocked && afModes.contains(CameraMetadata.CONTROL_AF_MODE_OFF) -> CameraMetadata.CONTROL_AF_MODE_OFF
      afModes.contains(CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO) -> CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO
      else -> CameraMetadata.CONTROL_AF_MODE_AUTO
    }
    b.set(CaptureRequest.CONTROL_AF_MODE, af)
  }

  fun setExposureLocked(locked: Boolean) {
    exposureLocked = locked
    val b = request ?: return
    val s = session ?: return
    handler.post {
      try {
        b.set(CaptureRequest.CONTROL_AE_LOCK, locked)
        s.setRepeatingRequest(b.build(), null, handler)
      } catch (e: Exception) { Log.w(TAG, "exposure lock failed: $e") }
    }
  }

  fun stop() {
    if (!running && device == null) return
    running = false
    try { session?.stopRepeating() } catch (_: Exception) {}
    try { session?.close() } catch (_: Exception) {}
    session = null
    try { device?.close() } catch (_: Exception) {}
    device = null
    request = null
  }
}
