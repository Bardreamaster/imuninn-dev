// Device identity for Hello/Welcome and the UI header. Mirrors ios/Core/DeviceInfo.swift.
package expo.modules.muninncore.core

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.google.ar.core.ArCoreApk

data class LocalDeviceInfo(
  val deviceId: String,
  val deviceName: String,
  val model: String,          // hardware identifier, e.g. "panther"
  val marketingName: String,  // e.g. "Google Pixel 7"
  val platform: String,
  val osVersion: String,
  val protocolVersion: Int,
  val appVersion: String,
  val hasLidar: Boolean,
  val arSupported: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "deviceId" to deviceId,
    "deviceName" to deviceName,
    "model" to model,
    "marketingName" to marketingName,
    "platform" to platform,
    "osVersion" to osVersion,
    "protocolVersion" to protocolVersion,
    "appVersion" to appVersion,
    "hasLidar" to hasLidar,
    "arSupported" to arSupported,
  )

  companion object {
    /** True on the Android emulator (used for the UDP loopback workaround, see NetInfo). */
    val isEmulator: Boolean
      get() = Build.FINGERPRINT.contains("generic") || Build.FINGERPRINT.contains("emulator") ||
        Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for") ||
        Build.HARDWARE.contains("ranchu") || Build.HARDWARE.contains("goldfish") ||
        Build.PRODUCT.contains("sdk_gphone")

    fun current(ctx: Context): LocalDeviceInfo {
      val id = try {
        Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
      } catch (_: Exception) { null } ?: "unknown"
      val appVersion = try {
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0"
      } catch (_: Exception) { "0" }
      // Settings.Global "device_name" is what the user sees in Settings → About (API 25+).
      val userName = try { Settings.Global.getString(ctx.contentResolver, "device_name") } catch (_: Exception) { null }
      val marketing = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
      return LocalDeviceInfo(
        deviceId = id,
        deviceName = userName?.takeIf { it.isNotBlank() } ?: Build.MODEL,
        model = Build.DEVICE,
        marketingName = if (isEmulator) "Android Emulator" else marketing,
        platform = "android",
        osVersion = Build.VERSION.RELEASE ?: Build.VERSION.SDK_INT.toString(),
        protocolVersion = PROTOCOL_VERSION,
        appVersion = appVersion,
        hasLidar = false,                       // no ToF support in this version (§5.3)
        arSupported = ArSource.supported(ctx),
      )
    }
  }
}
