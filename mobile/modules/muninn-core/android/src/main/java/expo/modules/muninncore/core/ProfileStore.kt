// Configuration presets (§6.8 Profile): full DeviceConfig snapshots saved as
// protobuf-JSON under <filesDir>/profiles/<name>.json, same format as iOS.
package expo.modules.muninncore.core

import android.content.Context
import com.google.protobuf.util.JsonFormat
import io.imuninn.proto.DeviceConfig
import java.io.File

class ProfileStore(private val ctx: Context) {
  val directory: File get() = File(ctx.filesDir, "profiles").apply { mkdirs() }

  private fun file(name: String) = File(directory, "${name.replace('/', '_')}.json")

  fun list(): List<String> =
    (directory.listFiles() ?: emptyArray()).filter { it.extension == "json" }.map { it.nameWithoutExtension }.sorted()

  fun save(config: DeviceConfig, name: String) {
    val c = config.toBuilder().setConfigVersion(0).build()   // a profile is a patch, not a version
    val json = JsonFormat.printer().preservingProtoFieldNames().print(c)
    file(name).writeText(json)
  }

  fun load(name: String): DeviceConfig {
    val b = DeviceConfig.newBuilder()
    JsonFormat.parser().ignoringUnknownFields().merge(file(name).readText(), b)
    return b.build()
  }

  fun delete(name: String) { file(name).delete() }
}
