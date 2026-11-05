// Self-describing configuration model (§6.8): capabilities, current config,
// validated partial updates. No I/O here; SessionManager applies the results.
// Port of ios/Core/ConfigStore.swift; the parameter set is identical so PC-side
// profiles and tools work unchanged.
package expo.modules.muninncore.core

import io.imuninn.proto.Capabilities
import io.imuninn.proto.ConfigResult
import io.imuninn.proto.DeliveryConfig
import io.imuninn.proto.DeviceConfig
import io.imuninn.proto.DeviceInfo
import io.imuninn.proto.ParamSpec
import io.imuninn.proto.SessionMode
import io.imuninn.proto.SetConfig
import io.imuninn.proto.StreamConfig
import io.imuninn.proto.StreamDescriptor
import io.imuninn.proto.StreamKind
import io.imuninn.proto.Transport
import io.imuninn.proto.Value
import kotlin.math.roundToLong

data class AppliedChange(val stream: String, val key: String, val value: Value, val apply: ParamSpec.Apply)

data class ConfigUpdate(val result: ConfigResult, val changes: List<AppliedChange>) {
  val needsRestart: Boolean get() = changes.any { it.apply == ParamSpec.Apply.APPLY_RESTART_SESSION }
}

/** What the hardware offers; filled by SessionManager at startup. */
data class ConfigEnvironment(
  var arVideoFormats: List<String> = emptyList(),
  var lenses: List<String> = emptyList(),
  var cameraFormats: Map<String, List<String>> = emptyMap(),   // lens -> format ids
  var imuAvailable: Boolean = false,
  var arAvailable: Boolean = false,
  var depthAvailable: Boolean = false,
  var camera: CameraRanges = CameraRanges(),
)

fun pbBool(v: Boolean): Value = Value.newBuilder().setB(v).build()
fun pbInt(v: Long): Value = Value.newBuilder().setI(v).build()
fun pbFloat(v: Double): Value = Value.newBuilder().setF(v).build()
fun pbStr(v: String): Value = Value.newBuilder().setS(v).build()

class ConfigStore(private val env: ConfigEnvironment) {
  private var config: DeviceConfig.Builder = DeviceConfig.newBuilder()
  private val specs = HashMap<String, HashMap<String, ParamSpec>>()   // stream -> key -> spec
  private val sessionSpecs = LinkedHashMap<String, ParamSpec>()
  private val streamDescriptors = ArrayList<StreamDescriptor>()
  private val lock = Any()

  private fun spec(
    key: String, label: String, kind: ParamSpec.Kind, apply: ParamSpec.Apply, current: Value,
    unit: String = "", min: Double = 0.0, max: Double = 0.0, step: Double = 0.0, choices: List<String> = emptyList(),
  ): ParamSpec = ParamSpec.newBuilder()
    .setKey(key).setLabel(label).setKind(kind).setApply(apply).setUnit(unit)
    .setMin(min).setMax(max).setStep(step).addAllChoices(choices)
    .setCurrent(current).setDefault(current).build()

  private fun addStream(id: String, kind: StreamKind, transport: Transport, enabled: Boolean, params: List<ParamSpec>) {
    specs[id] = HashMap(params.associateBy { it.key })
    streamDescriptors += StreamDescriptor.newBuilder().setStreamId(id).setKind(kind).setTransport(transport).addAllParams(params).build()
    val c = StreamConfig.newBuilder().setStreamId(id).setEnabled(enabled)
    for (p in params) c.putParams(p.key, p.current)
    c.delivery = DeliveryConfig.newBuilder().setTransport(transport)
      .setDropPolicy(if (kind == StreamKind.STREAM_KIND_DEPTH) DeliveryConfig.DropPolicy.DROP_POLICY_NONE else DeliveryConfig.DropPolicy.DROP_POLICY_LATEST_ONLY)
      .build()
    config.addStreams(c)
  }

  init {
    val I = ParamSpec.Apply.APPLY_IMMEDIATE
    val R = ParamSpec.Apply.APPLY_RESTART_SESSION
    config.configVersion = 1
    config.mode = if (env.arAvailable) SessionMode.SESSION_MODE_AR else SessionMode.SESSION_MODE_CAMERA

    sessionSpecs["mode"] = spec("mode", "Session mode", ParamSpec.Kind.KIND_ENUM, R,
      pbStr(if (env.arAvailable) "ar" else "camera"), choices = listOf("ar", "camera"))

    addStream("imu", StreamKind.STREAM_KIND_IMU, Transport.TRANSPORT_UDP, env.imuAvailable, listOf(
      spec("rate_hz", "IMU rate", ParamSpec.Kind.KIND_INT, I, pbInt(100), unit = "Hz", min = 10.0, max = 200.0, step = 10.0),
      spec("raw", "Raw sensors (uncalibrated)", ParamSpec.Kind.KIND_BOOL, I, pbBool(false)),
    ))

    addStream("ar_pose", StreamKind.STREAM_KIND_POSE, Transport.TRANSPORT_UDP, env.arAvailable, listOf(
      spec("video_format", "AR video format", ParamSpec.Kind.KIND_ENUM, R, pbStr(env.arVideoFormats.firstOrNull() ?: ""), choices = env.arVideoFormats),
    ))

    val wideFormats = env.cameraFormats["wide"] ?: env.cameraFormats.values.firstOrNull() ?: emptyList()
    val defaultFormat = wideFormats.firstOrNull { it.startsWith("1920x1080@30") } ?: wideFormats.firstOrNull() ?: ""
    addStream("rgb", StreamKind.STREAM_KIND_VIDEO, Transport.TRANSPORT_TCP, true, listOf(
      spec("lens", "Lens (camera mode only)", ParamSpec.Kind.KIND_ENUM, R, pbStr(env.lenses.firstOrNull() ?: "wide"), choices = env.lenses),
      spec("camera_format", "Camera format (camera mode only)", ParamSpec.Kind.KIND_ENUM, R, pbStr(defaultFormat), choices = wideFormats),
      spec("bitrate_kbps", "H.264 bitrate", ParamSpec.Kind.KIND_INT, I, pbInt(4000), unit = "kbps", min = 500.0, max = 20000.0, step = 500.0),
      spec("keyframe_interval", "Keyframe interval", ParamSpec.Kind.KIND_INT, I, pbInt(60), unit = "frames", min = 1.0, max = 300.0, step = 1.0),
      // --- camera controls (Camera2 CaptureRequest); ranges probed from the wide camera at startup ---
      spec("exposure_mode", "Exposure", ParamSpec.Kind.KIND_ENUM, I, pbStr("auto"), choices = listOf("auto", "locked", "manual")),
      spec("iso", "ISO (manual)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(100.0), min = env.camera.isoMin.toDouble(), max = env.camera.isoMax.toDouble()),
      spec("exposure_ms", "Shutter (manual)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(8.0), unit = "ms", min = env.camera.durationMinMs, max = env.camera.durationMaxMs),
      spec("exposure_bias", "EV bias", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(0.0), unit = "EV", min = env.camera.biasMin.toDouble(), max = env.camera.biasMax.toDouble(), step = 0.5),
      spec("white_balance_mode", "White balance", ParamSpec.Kind.KIND_ENUM, I, pbStr("auto"), choices = listOf("auto", "locked", "manual")),
      spec("wb_temperature_k", "WB temperature (manual)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(5000.0), unit = "K", min = 2000.0, max = 10000.0, step = 100.0),
      spec("wb_tint", "WB tint (manual)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(0.0), min = -150.0, max = 150.0, step = 5.0),
      spec("focus_mode", "Focus", ParamSpec.Kind.KIND_ENUM, I, pbStr("auto"), choices = listOf("auto", "locked", "manual")),
      spec("lens_position", "Lens position (manual)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(0.5), min = 0.0, max = 1.0, step = 0.05),
      spec("zoom", "Zoom (camera mode)", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(1.0), unit = "x", min = 1.0, max = env.camera.zoomMax, step = 0.1),
      spec("torch", "Torch (camera mode)", ParamSpec.Kind.KIND_BOOL, I, pbBool(false)),
      spec("hdr", "Video HDR (camera mode)", ParamSpec.Kind.KIND_BOOL, I, pbBool(false)),
      spec("low_light_boost", "Low-light boost (camera mode)", ParamSpec.Kind.KIND_BOOL, I, pbBool(false)),
      spec("stabilization", "Stabilization (camera mode; off keeps intrinsics exact)", ParamSpec.Kind.KIND_ENUM, I, pbStr("off"), choices = listOf("off", "standard", "cinematic")),
    ))

    addStream("health", StreamKind.STREAM_KIND_HEALTH, Transport.TRANSPORT_UDP, true, listOf(
      spec("rate_hz", "Health report rate", ParamSpec.Kind.KIND_FLOAT, I, pbFloat(0.2), unit = "Hz", min = 0.1, max = 5.0),
    ))

    if (env.depthAvailable) {
      addStream("depth", StreamKind.STREAM_KIND_DEPTH, Transport.TRANSPORT_TCP, false, listOf(
        spec("smoothed", "Temporally smoothed", ParamSpec.Kind.KIND_BOOL, R, pbBool(false)),
        spec("compression", "Compression", ParamSpec.Kind.KIND_ENUM, I, pbStr("lz4"), choices = listOf("lz4", "none")),
        spec("rate_divisor", "Send every Nth frame", ParamSpec.Kind.KIND_INT, I, pbInt(1), min = 1.0, max = 6.0, step = 1.0),
      ))
    }
  }

  // MARK: queries

  fun capabilities(device: DeviceInfo): Capabilities = synchronized(lock) {
    val c = Capabilities.newBuilder().setDevice(device)
    for (d in streamDescriptors) {
      val sc = streamConfigLocked(d.streamId)
      val db = d.toBuilder()
      for (i in 0 until db.paramsCount) {
        val cur = sc?.paramsMap?.get(db.getParams(i).key) ?: continue
        db.setParams(i, db.getParams(i).toBuilder().setCurrent(cur))
      }
      c.addStreams(db)
    }
    for (s in sessionSpecs.values) {
      val sb = s.toBuilder()
      if (s.key == "mode") sb.current = pbStr(if (config.mode == SessionMode.SESSION_MODE_CAMERA) "camera" else "ar")
      c.addSessionParams(sb)
    }
    c.config = config.build()
    c.build()
  }

  fun snapshot(): DeviceConfig = synchronized(lock) { config.build() }

  val mode: SessionMode get() = snapshot().mode
  val isCameraMode: Boolean get() = mode == SessionMode.SESSION_MODE_CAMERA

  private fun streamConfigLocked(id: String): StreamConfig? = config.streamsList.firstOrNull { it.streamId == id }

  fun streamConfig(id: String): StreamConfig? = synchronized(lock) { streamConfigLocked(id) }

  fun isEnabled(id: String): Boolean = streamConfig(id)?.enabled ?: false

  fun param(stream: String, key: String): Value? = streamConfig(stream)?.paramsMap?.get(key)

  fun bool(stream: String, key: String): Boolean = param(stream, key)?.b ?: false
  fun int(stream: String, key: String): Int = (param(stream, key)?.i ?: 0L).toInt()
  fun double(stream: String, key: String): Double {
    val v = param(stream, key) ?: return 0.0
    return when (v.vCase) {
      Value.VCase.F -> v.f
      Value.VCase.I -> v.i.toDouble()
      else -> 0.0
    }
  }
  fun string(stream: String, key: String): String = param(stream, key)?.s ?: ""

  // MARK: updates (§6.8 steps 3-5)

  fun apply(req: SetConfig): ConfigUpdate = synchronized(lock) {
    val result = ConfigResult.newBuilder()
    val changes = ArrayList<AppliedChange>()
    val FR = { ConfigResult.FieldResult.newBuilder() }

    if (req.baseConfigVersion != 0 && req.baseConfigVersion != config.configVersion) {
      result.addFields(FR().setKey("config_version").setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED)
        .setReason("stale base_config_version ${req.baseConfigVersion}, current ${config.configVersion}"))
      result.configVersion = config.configVersion
      return ConfigUpdate(result.build(), emptyList())
    }

    val patch = req.patch
    if (patch.mode != SessionMode.SESSION_MODE_UNSPECIFIED && patch.mode != config.mode) {
      val fr = FR().setKey("session.mode")
      if (patch.mode == SessionMode.SESSION_MODE_AR && !env.arAvailable) {
        fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("ARCore not supported on this device")
      } else {
        config.mode = patch.mode
        val eff = pbStr(if (patch.mode == SessionMode.SESSION_MODE_CAMERA) "camera" else "ar")
        fr.setStatus(ConfigResult.FieldResult.Status.STATUS_APPLIED).setEffective(eff)
        changes += AppliedChange("", "mode", eff, ParamSpec.Apply.APPLY_RESTART_SESSION)
      }
      result.addFields(fr)
    }

    for (ps in patch.streamsList) {
      val idx = config.streamsList.indexOfFirst { it.streamId == ps.streamId }
      if (idx < 0) {
        result.addFields(FR().setKey(ps.streamId).setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("unknown stream"))
        continue
      }
      val sb = config.getStreams(idx).toBuilder()
      if (ps.hasEnabled()) {
        sb.enabled = ps.enabled
        val eff = pbBool(ps.enabled)
        result.addFields(FR().setKey("${ps.streamId}.enabled").setStatus(ConfigResult.FieldResult.Status.STATUS_APPLIED).setEffective(eff))
        changes += AppliedChange(ps.streamId, "enabled", eff, ParamSpec.Apply.APPLY_IMMEDIATE)
      }
      for ((key, value) in ps.paramsMap) {
        val fr = FR().setKey("${ps.streamId}.$key")
        val spec = specs[ps.streamId]?.get(key)
        if (spec == null) {
          result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("unknown parameter")); continue
        }
        if (spec.readOnly) {
          result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("read only")); continue
        }
        val effective: Value
        when (spec.kind) {
          ParamSpec.Kind.KIND_BOOL -> {
            if (value.vCase != Value.VCase.B) { result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("expected bool")); continue }
            effective = pbBool(value.b); fr.status = ConfigResult.FieldResult.Status.STATUS_APPLIED
          }
          ParamSpec.Kind.KIND_INT -> {
            val requested = when (value.vCase) {
              Value.VCase.I -> value.i
              Value.VCase.F -> value.f.roundToLong()
              else -> { result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("expected int")); continue }
            }
            var v = requested.coerceIn(spec.min.toLong(), spec.max.toLong())
            if (spec.step > 0) v = ((v / spec.step).roundToLong() * spec.step).roundToLong()
            fr.status = if (v == requested) ConfigResult.FieldResult.Status.STATUS_APPLIED else ConfigResult.FieldResult.Status.STATUS_CLAMPED
            effective = pbInt(v)
          }
          ParamSpec.Kind.KIND_FLOAT -> {
            val v = when (value.vCase) {
              Value.VCase.F -> value.f
              Value.VCase.I -> value.i.toDouble()
              else -> { result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("expected float")); continue }
            }
            val clamped = v.coerceIn(spec.min, spec.max)
            fr.status = if (clamped == v) ConfigResult.FieldResult.Status.STATUS_APPLIED else ConfigResult.FieldResult.Status.STATUS_CLAMPED
            effective = pbFloat(clamped)
          }
          ParamSpec.Kind.KIND_ENUM, ParamSpec.Kind.KIND_STRING -> {
            if (value.vCase != Value.VCase.S) { result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("expected string")); continue }
            val choices = dynamicChoices(ps.streamId, key) ?: spec.choicesList
            if (spec.kind == ParamSpec.Kind.KIND_ENUM && !choices.contains(value.s)) {
              result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("not one of $choices")); continue
            }
            effective = pbStr(value.s); fr.status = ConfigResult.FieldResult.Status.STATUS_APPLIED
          }
          else -> { result.addFields(fr.setStatus(ConfigResult.FieldResult.Status.STATUS_REJECTED).setReason("unsupported kind")); continue }
        }
        sb.putParams(key, effective)
        result.addFields(fr.setEffective(effective))
        changes += AppliedChange(ps.streamId, key, effective, spec.apply)
      }
      config.setStreams(idx, sb)
    }

    if (changes.isNotEmpty()) config.configVersion = config.configVersion + 1
    result.configVersion = config.configVersion
    result.sessionRestarted = changes.any { it.apply == ParamSpec.Apply.APPLY_RESTART_SESSION }
    ConfigUpdate(result.build(), changes)
  }

  /** Camera formats depend on the chosen lens; accept any format that lens offers. */
  private fun dynamicChoices(stream: String, key: String): List<String>? {
    if (stream != "rgb" || key != "camera_format") return null
    val lens = streamConfigLocked("rgb")?.paramsMap?.get("lens")?.s ?: "wide"
    return env.cameraFormats[lens]
  }

  fun cameraFormats(lens: String): List<String> = env.cameraFormats[lens] ?: emptyList()

  /** Current rgb.* camera controls as a struct for CameraControl. */
  fun cameraSettings(): CameraSettings = CameraSettings(
    exposureMode = string("rgb", "exposure_mode"),
    iso = double("rgb", "iso").toFloat(), exposureMs = double("rgb", "exposure_ms"), exposureBias = double("rgb", "exposure_bias").toFloat(),
    whiteBalanceMode = string("rgb", "white_balance_mode"),
    wbTemperatureK = double("rgb", "wb_temperature_k").toFloat(), wbTint = double("rgb", "wb_tint").toFloat(),
    focusMode = string("rgb", "focus_mode"), lensPosition = double("rgb", "lens_position").toFloat(),
    zoom = double("rgb", "zoom"), torch = bool("rgb", "torch"), hdr = bool("rgb", "hdr"),
    lowLightBoost = bool("rgb", "low_light_boost"), stabilization = string("rgb", "stabilization"),
  )
}
