// JSON <-> protobuf bridging for the JS side (mirrors the Swift ConfigJSON enum).
package expo.modules.muninncore.core

import io.imuninn.proto.Capabilities
import io.imuninn.proto.ConfigResult
import io.imuninn.proto.DeviceConfig
import io.imuninn.proto.ParamSpec
import io.imuninn.proto.SessionMode
import io.imuninn.proto.StreamConfig
import io.imuninn.proto.StreamKind
import io.imuninn.proto.Value

object ConfigJSON {
  fun value(v: Value): Any? = when (v.vCase) {
    Value.VCase.B -> v.b
    Value.VCase.I -> v.i.toInt()
    Value.VCase.F -> v.f
    Value.VCase.S -> v.s
    else -> null
  }

  fun value(any: Any?): Value = when (any) {
    is Boolean -> pbBool(any)
    is Int -> pbInt(any.toLong())
    is Long -> pbInt(any)
    is Double -> if (any == Math.rint(any)) pbInt(any.toLong()) else pbFloat(any)
    is Float -> value(any.toDouble())
    is String -> pbStr(any)
    else -> Value.getDefaultInstance()
  }

  fun spec(s: ParamSpec): Map<String, Any?> = mapOf(
    "key" to s.key, "label" to s.label, "unit" to s.unit,
    "kind" to when (s.kind) {
      ParamSpec.Kind.KIND_BOOL -> "bool"
      ParamSpec.Kind.KIND_INT -> "int"
      ParamSpec.Kind.KIND_FLOAT -> "float"
      ParamSpec.Kind.KIND_ENUM -> "enum"
      ParamSpec.Kind.KIND_STRING -> "string"
      else -> "unknown"
    },
    "apply" to if (s.apply == ParamSpec.Apply.APPLY_RESTART_SESSION) "restart" else "immediate",
    "min" to s.min, "max" to s.max, "step" to s.step, "choices" to s.choicesList.toList(),
    "current" to value(s.current), "default" to value(s.default), "readOnly" to s.readOnly,
  )

  fun capabilities(c: Capabilities): Map<String, Any?> = mapOf(
    "streams" to c.streamsList.map { d ->
      mapOf(
        "streamId" to d.streamId,
        "kind" to when (d.kind) {
          StreamKind.STREAM_KIND_IMU -> "imu"
          StreamKind.STREAM_KIND_POSE -> "pose"
          StreamKind.STREAM_KIND_VIDEO -> "video"
          StreamKind.STREAM_KIND_DEPTH -> "depth"
          else -> "other"
        },
        "params" to d.paramsList.map { spec(it) },
      )
    },
    "sessionParams" to c.sessionParamsList.map { spec(it) },
    "config" to config(c.config),
  )

  fun config(c: DeviceConfig): Map<String, Any?> {
    val streams = HashMap<String, Any?>()
    for (s in c.streamsList) {
      val params = HashMap<String, Any?>()
      for ((k, v) in s.paramsMap) params[k] = value(v)
      streams[s.streamId] = mapOf("enabled" to s.enabled, "params" to params)
    }
    return mapOf(
      "configVersion" to c.configVersion,
      "mode" to if (c.mode == SessionMode.SESSION_MODE_CAMERA) "camera" else "ar",
      "streams" to streams,
    )
  }

  @Suppress("UNCHECKED_CAST")
  fun patch(json: Map<String, Any?>): DeviceConfig {
    val p = DeviceConfig.newBuilder()
    (json["mode"] as? String)?.let { p.mode = if (it == "camera") SessionMode.SESSION_MODE_CAMERA else SessionMode.SESSION_MODE_AR }
    (json["streams"] as? Map<String, Any?>)?.forEach { (id, raw) ->
      val obj = raw as? Map<String, Any?> ?: return@forEach
      val sc = StreamConfig.newBuilder().setStreamId(id)
      (obj["enabled"] as? Boolean)?.let { sc.enabled = it }
      (obj["params"] as? Map<String, Any?>)?.forEach { (k, v) -> sc.putParams(k, value(v)) }
      p.addStreams(sc)
    }
    return p.build()
  }

  fun result(r: ConfigResult): Map<String, Any?> = mapOf(
    "configVersion" to r.configVersion,
    "sessionRestarted" to r.sessionRestarted,
    "fields" to r.fieldsList.map { f ->
      mapOf(
        "key" to f.key,
        "status" to when (f.status) {
          ConfigResult.FieldResult.Status.STATUS_APPLIED -> "applied"
          ConfigResult.FieldResult.Status.STATUS_CLAMPED -> "clamped"
          ConfigResult.FieldResult.Status.STATUS_REJECTED -> "rejected"
          else -> "unknown"
        },
        "effective" to value(f.effective),
        "reason" to f.reason,
      )
    },
  )
}
