package expo.modules.muninncore

import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

const val PROTOCOL_VERSION = 2 // keep in sync with protocol/VERSION

// Thin Expo adapter; Android data path lands after iOS (§1 开发顺序).
class MuninnCoreModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MuninnCore")

    Constants("protocolVersion" to PROTOCOL_VERSION)

    Events("onStatus")

    Function("getDeviceInfo") {
      val ctx = appContext.reactContext
      val id = ctx?.let { Settings.Secure.getString(it.contentResolver, Settings.Secure.ANDROID_ID) } ?: "unknown"
      mapOf(
        "deviceId" to id,
        "deviceName" to (Build.MODEL ?: "android"),
        "model" to Build.DEVICE,
        "marketingName" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "platform" to "android",
        "osVersion" to Build.VERSION.RELEASE,
        "protocolVersion" to PROTOCOL_VERSION,
        "appVersion" to "0.0.1",
        "hasLidar" to false,
        "arSupported" to false, // ARCore availability check comes with the Android port
      )
    }
  }
}
