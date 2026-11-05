// Everything Camera2 lets us adjust at runtime (§5.2, §6.8), exposed as the same
// `rgb.*` parameters as iOS (ios/Core/CameraControl.swift). Settings are written into
// the CaptureRequest; what the HAL does not support is skipped and logged once.
package expo.modules.muninncore.core

import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.params.RggbChannelVector
import android.os.Build
import android.util.Log
import android.util.Range
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.roundToInt

/** Ranges probed from the wide camera at startup; the ConfigStore uses them as min/max. */
data class CameraRanges(
  var isoMin: Float = 100f, var isoMax: Float = 1600f,
  var durationMinMs: Double = 0.02, var durationMaxMs: Double = 1000.0,
  var biasMin: Float = -8f, var biasMax: Float = 8f,
  var zoomMax: Double = 1.0,
  var hasTorch: Boolean = false,
  var hdrSupported: Boolean = false,
  var lowLightSupported: Boolean = false,
  var manualSensor: Boolean = false,      // MANUAL_SENSOR capability: ISO / shutter
  var manualWb: Boolean = false,          // MANUAL_POST_PROCESSING: colour gains
  var manualFocus: Boolean = false,       // LENS_INFO_MINIMUM_FOCUS_DISTANCE > 0
  var minFocusDiopters: Float = 0f,
  var biasStep: Double = 1.0 / 3.0,
  var biasRange: IntArray = intArrayOf(0, 0),
) {
  companion object {
    fun probe(ch: CameraCharacteristics?): CameraRanges {
      val r = CameraRanges()
      ch ?: return r
      val caps = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: intArrayOf()
      r.manualSensor = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_SENSOR)
      r.manualWb = caps.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_MANUAL_POST_PROCESSING)
      ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)?.let { r.isoMin = it.lower.toFloat(); r.isoMax = it.upper.toFloat() }
      ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)?.let {
        r.durationMinMs = it.lower / 1e6; r.durationMaxMs = minOf(1000.0, it.upper / 1e6)
      }
      ch.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_STEP)?.let { r.biasStep = it.toDouble() }
      ch.get(CameraCharacteristics.CONTROL_AE_COMPENSATION_RANGE)?.let {
        r.biasRange = intArrayOf(it.lower, it.upper)
        r.biasMin = (it.lower * r.biasStep).toFloat(); r.biasMax = (it.upper * r.biasStep).toFloat()
      }
      r.zoomMax = if (Build.VERSION.SDK_INT >= 30) {
        ch.get(CameraCharacteristics.CONTROL_ZOOM_RATIO_RANGE)?.upper?.toDouble() ?: 1.0
      } else {
        ch.get(CameraCharacteristics.SCALER_AVAILABLE_MAX_DIGITAL_ZOOM)?.toDouble() ?: 1.0
      }.coerceIn(1.0, 10.0)
      r.hasTorch = ch.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
      r.hdrSupported = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_SCENE_MODES)?.contains(CameraMetadata.CONTROL_SCENE_MODE_HDR) ?: false
      r.lowLightSupported = Build.VERSION.SDK_INT >= 35 &&
        (ch.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES)?.contains(CameraMetadata.CONTROL_AE_MODE_ON_LOW_LIGHT_BOOST_BRIGHTNESS_PRIORITY) ?: false)
      r.minFocusDiopters = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
      r.manualFocus = r.minFocusDiopters > 0f
      return r
    }
  }
}

/** Snapshot of the rgb.* camera parameters (strings/numbers straight from the config). */
data class CameraSettings(
  var exposureMode: String = "auto",        // auto | locked | manual
  var iso: Float = 100f,
  var exposureMs: Double = 8.0,
  var exposureBias: Float = 0f,
  var whiteBalanceMode: String = "auto",    // auto | locked | manual
  var wbTemperatureK: Float = 5000f,
  var wbTint: Float = 0f,
  var focusMode: String = "auto",           // auto | locked | manual
  var lensPosition: Float = 0.5f,
  var zoom: Double = 1.0,
  var torch: Boolean = false,
  var hdr: Boolean = false,
  var lowLightBoost: Boolean = false,
  var stabilization: String = "off",        // off | standard | cinematic
)

object CameraControl {
  private val warned = HashSet<String>()
  /** Unsupported-feature warnings are logged once per camera start, not on every change. */
  fun resetWarnings() = warned.clear()
  private fun warnOnce(msg: String) { if (warned.add(msg)) Log.w(TAG, msg) }

  val cameraKeys = setOf(
    "exposure_mode", "iso", "exposure_ms", "exposure_bias",
    "white_balance_mode", "wb_temperature_k", "wb_tint",
    "focus_mode", "lens_position", "zoom", "torch", "hdr", "low_light_boost", "stabilization",
  )

  /**
   * Write every setting into the request. `lockedFocusDiopters` is the last focus
   * distance reported by the HAL, used for focus_mode=locked.
   */
  fun applyAll(s: CameraSettings, b: CaptureRequest.Builder, ch: CameraCharacteristics, r: CameraRanges, lockedFocusDiopters: Float?) {
    applyExposure(s, b, r)
    applyWhiteBalance(s, b, ch, r)
    applyFocus(s, b, ch, r, lockedFocusDiopters)
    applyZoom(s, b, ch, r)
    applyTorch(s, b, r)
    applyStabilization(s, b, ch)
  }

  private fun applyExposure(s: CameraSettings, b: CaptureRequest.Builder, r: CameraRanges) {
    // HDR / low-light boost are AE modes on Android, so they live here.
    var aeMode = CameraMetadata.CONTROL_AE_MODE_ON
    b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
    if (s.hdr && r.hdrSupported) {
      b.set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_USE_SCENE_MODE)
      b.set(CaptureRequest.CONTROL_SCENE_MODE, CameraMetadata.CONTROL_SCENE_MODE_HDR)
    } else {
      b.set(CaptureRequest.CONTROL_SCENE_MODE, CameraMetadata.CONTROL_SCENE_MODE_DISABLED)
    }
    if (s.lowLightBoost && r.lowLightSupported && Build.VERSION.SDK_INT >= 35) {
      aeMode = CameraMetadata.CONTROL_AE_MODE_ON_LOW_LIGHT_BOOST_BRIGHTNESS_PRIORITY
    }
    when (s.exposureMode) {
      "manual" -> if (r.manualSensor) {
        b.set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_OFF)
        b.set(CaptureRequest.SENSOR_SENSITIVITY, s.iso.roundToInt().coerceIn(r.isoMin.toInt(), r.isoMax.toInt()))
        b.set(CaptureRequest.SENSOR_EXPOSURE_TIME, (s.exposureMs.coerceIn(r.durationMinMs, r.durationMaxMs) * 1e6).toLong())
        return
      } else {
        warnOnce("manual exposure unsupported (no MANUAL_SENSOR); locking AE instead")
        b.set(CaptureRequest.CONTROL_AE_MODE, aeMode); b.set(CaptureRequest.CONTROL_AE_LOCK, true)
      }
      "locked" -> { b.set(CaptureRequest.CONTROL_AE_MODE, aeMode); b.set(CaptureRequest.CONTROL_AE_LOCK, true) }
      else -> { b.set(CaptureRequest.CONTROL_AE_MODE, aeMode); b.set(CaptureRequest.CONTROL_AE_LOCK, false) }
    }
    if (r.biasStep > 0) {
      val steps = (s.exposureBias / r.biasStep).roundToInt().coerceIn(r.biasRange[0], r.biasRange[1])
      b.set(CaptureRequest.CONTROL_AE_EXPOSURE_COMPENSATION, steps)
    }
  }

  private fun applyWhiteBalance(s: CameraSettings, b: CaptureRequest.Builder, ch: CameraCharacteristics, r: CameraRanges) {
    when (s.whiteBalanceMode) {
      "manual" -> {
        if (r.manualWb) {
          b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_OFF)
          b.set(CaptureRequest.COLOR_CORRECTION_MODE, CameraMetadata.COLOR_CORRECTION_MODE_TRANSFORM_MATRIX)
          b.set(CaptureRequest.COLOR_CORRECTION_GAINS, gains(s.wbTemperatureK, s.wbTint))
        } else {
          // No colour gains: pick the nearest AWB preset by colour temperature.
          val modes = ch.get(CameraCharacteristics.CONTROL_AWB_AVAILABLE_MODES) ?: intArrayOf()
          val presets = listOf(
            2700f to CameraMetadata.CONTROL_AWB_MODE_INCANDESCENT, 3000f to CameraMetadata.CONTROL_AWB_MODE_WARM_FLUORESCENT,
            4000f to CameraMetadata.CONTROL_AWB_MODE_FLUORESCENT, 5500f to CameraMetadata.CONTROL_AWB_MODE_DAYLIGHT,
            6500f to CameraMetadata.CONTROL_AWB_MODE_CLOUDY_DAYLIGHT, 7500f to CameraMetadata.CONTROL_AWB_MODE_SHADE,
          ).filter { modes.contains(it.second) }
          val pick = presets.minByOrNull { kotlin.math.abs(it.first - s.wbTemperatureK) }?.second ?: CameraMetadata.CONTROL_AWB_MODE_AUTO
          warnOnce("manual white balance unsupported (no MANUAL_POST_PROCESSING); using preset $pick")
          b.set(CaptureRequest.CONTROL_AWB_MODE, pick); b.set(CaptureRequest.CONTROL_AWB_LOCK, false)
        }
      }
      "locked" -> { b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_AUTO); b.set(CaptureRequest.CONTROL_AWB_LOCK, true) }
      else -> { b.set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_AUTO); b.set(CaptureRequest.CONTROL_AWB_LOCK, false) }
    }
  }

  /** Colour temperature (K) + tint (−150…150, green↔magenta) → RGGB gains, green = 1. */
  private fun gains(kelvin: Float, tint: Float): RggbChannelVector {
    // Tanner Helland's black-body approximation, normalised to green.
    val t = kelvin.coerceIn(1000f, 40000f) / 100f
    val red = if (t <= 66) 255.0 else 329.698727446 * (t - 60.0).pow(-0.1332047592)
    val green = if (t <= 66) 99.4708025861 * ln(t.toDouble()) - 161.1195681661 else 288.1221695283 * (t - 60.0).pow(-0.0755148492)
    val blue = if (t >= 66) 255.0 else if (t <= 19) 0.0 else 138.5177312231 * ln(t - 10.0) - 305.0447927307
    val rr = red.coerceIn(1.0, 255.0); val gg = green.coerceIn(1.0, 255.0); val bb = blue.coerceIn(1.0, 255.0)
    // Gains are the inverse of the scene illuminant's colour; positive tint shifts towards magenta (less green).
    val gGain = (1.0 - tint / 150.0 * 0.3).coerceIn(0.5, 2.0).toFloat()
    val rGain = (gg / rr).coerceIn(0.25, 4.0).toFloat()
    val bGain = (gg / bb).coerceIn(0.25, 4.0).toFloat()
    return RggbChannelVector(rGain, gGain, gGain, bGain)
  }

  private fun applyFocus(s: CameraSettings, b: CaptureRequest.Builder, ch: CameraCharacteristics, r: CameraRanges, lockedDiopters: Float?) {
    val afModes = ch.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
    val continuous = if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO)) CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO
      else if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_AUTO)) CameraMetadata.CONTROL_AF_MODE_AUTO else CameraMetadata.CONTROL_AF_MODE_OFF
    when (s.focusMode) {
      "manual" -> if (r.manualFocus && afModes.contains(CameraMetadata.CONTROL_AF_MODE_OFF)) {
        b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
        // iOS lens_position: 0 = near, 1 = far. Camera2: diopters, 0 = infinity, min-focus = nearest.
        b.set(CaptureRequest.LENS_FOCUS_DISTANCE, (1f - s.lensPosition.coerceIn(0f, 1f)) * r.minFocusDiopters)
      } else {
        warnOnce("manual focus unsupported; keeping autofocus")
        b.set(CaptureRequest.CONTROL_AF_MODE, continuous)
      }
      "locked" -> if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_OFF)) {
        b.set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_OFF)
        lockedDiopters?.let { b.set(CaptureRequest.LENS_FOCUS_DISTANCE, it) }
      } else {
        b.set(CaptureRequest.CONTROL_AF_MODE, continuous)
      }
      else -> b.set(CaptureRequest.CONTROL_AF_MODE, continuous)
    }
  }

  private fun applyZoom(s: CameraSettings, b: CaptureRequest.Builder, ch: CameraCharacteristics, r: CameraRanges) {
    val z = s.zoom.coerceIn(1.0, r.zoomMax)
    if (Build.VERSION.SDK_INT >= 30) {
      b.set(CaptureRequest.CONTROL_ZOOM_RATIO, z.toFloat())
    } else {
      val active = ch.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: return
      val w = (active.width() / z).toInt(); val h = (active.height() / z).toInt()
      val l = active.left + (active.width() - w) / 2; val t = active.top + (active.height() - h) / 2
      b.set(CaptureRequest.SCALER_CROP_REGION, android.graphics.Rect(l, t, l + w, t + h))
    }
  }

  private fun applyTorch(s: CameraSettings, b: CaptureRequest.Builder, r: CameraRanges) {
    if (!r.hasTorch) return
    b.set(CaptureRequest.FLASH_MODE, if (s.torch) CameraMetadata.FLASH_MODE_TORCH else CameraMetadata.FLASH_MODE_OFF)
  }

  private fun applyStabilization(s: CameraSettings, b: CaptureRequest.Builder, ch: CameraCharacteristics) {
    val video = ch.get(CameraCharacteristics.CONTROL_AVAILABLE_VIDEO_STABILIZATION_MODES) ?: intArrayOf()
    val ois = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_OPTICAL_STABILIZATION) ?: intArrayOf()
    val mode = when (s.stabilization) {
      "cinematic" -> if (Build.VERSION.SDK_INT >= 33 && video.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_PREVIEW_STABILIZATION))
        CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_PREVIEW_STABILIZATION
        else if (video.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON)) CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON
        else CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF
      "standard" -> if (video.contains(CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON)) CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_ON
        else CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF
      else -> CameraMetadata.CONTROL_VIDEO_STABILIZATION_MODE_OFF
    }
    b.set(CaptureRequest.CONTROL_VIDEO_STABILIZATION_MODE, mode)
    if (ois.isNotEmpty()) {
      // OIS also moves the image relative to the sensor: off keeps intrinsics exact.
      val on = s.stabilization != "off" && ois.contains(CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON)
      b.set(CaptureRequest.LENS_OPTICAL_STABILIZATION_MODE,
        if (on) CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_ON else CameraMetadata.LENS_OPTICAL_STABILIZATION_MODE_OFF)
    }
  }
}
