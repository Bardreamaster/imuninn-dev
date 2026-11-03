// Thin Expo adapter (§4.2). Everything substantive lives in core/.
package expo.modules.muninncore

import android.Manifest
import android.content.pm.PackageManager
import android.view.WindowManager
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.muninncore.core.ConfigJSON
import expo.modules.muninncore.core.LocalDeviceInfo
import expo.modules.muninncore.core.PROTOCOL_VERSION
import expo.modules.muninncore.core.SessionManager

class MuninnCoreModule : Module() {
  private val manager: SessionManager
    get() = SessionManager.get(appContext.reactContext ?: throw IllegalStateException("no react context"))

  override fun definition() = ModuleDefinition {
    Name("MuninnCore")

    Constants("protocolVersion" to PROTOCOL_VERSION)

    Events("onStatus", "onConfig")

    OnCreate {
      val m = manager
      m.onStatus = { s ->
        sendEvent("onStatus", mapOf(
          "server" to s.server,
          "serviceName" to s.serviceName,
          "addresses" to s.addresses,
          "controlPort" to s.controlPort,
          "tcpPort" to s.tcpPort,
          "clients" to s.clients.map { c ->
            mapOf("id" to c.id, "name" to c.name, "host" to c.host, "subscribed" to c.subscribed,
              "udpDropped" to c.udpDropped.toInt(), "tcpDropped" to c.tcpDropped.toInt(), "writer" to c.writer)
          },
          "mode" to s.mode,
          "sessionRunning" to s.sessionRunning,
          "previewing" to s.previewing,
          "tracking" to s.tracking,
          "poseHz" to s.poseHz,
          "imuHz" to s.imuHz,
          "videoHz" to s.videoHz,
          "depthHz" to s.depthHz,
          "videoKbps" to s.videoKbps,
          "encoderDropped" to s.encoderDropped.toInt(),
          "recording" to s.recording,
          "recordingFile" to s.recordingFile,
          "recordingBytes" to s.recordingBytes.toInt(),
          "configVersion" to s.configVersion,
          "remoteControlled" to s.remoteControlled,
          "writer" to s.writer,
          "lastError" to s.lastError,
        ))
      }
      m.onConfigChanged = { cfg -> sendEvent("onConfig", mapOf("config" to ConfigJSON.config(cfg))) }
      keepScreenOn(true)
    }

    // The app exists to stream while in the foreground: never auto-lock (§11).
    OnActivityEntersForeground { keepScreenOn(true) }

    OnDestroy { keepScreenOn(false) }

    View(MuninnPreviewView::class) {}

    Function("getDeviceInfo") {
      LocalDeviceInfo.current(appContext.reactContext!!).toMap()
    }

    Function("startServer") { name: String? ->
      manager.startServer(name?.takeIf { it.isNotEmpty() })
    }
    Function("stopServer") { manager.stopServer() }

    Function("setPreview") { enabled: Boolean ->
      if (enabled) withCameraPermission { manager.setPreview(true) } else manager.setPreview(false)
    }
    Function("startSession") { withCameraPermission { manager.startSession() } }
    Function("stopSession") { manager.stopSession() }
    Function("startRecording") { manager.startRecording() }
    Function("stopRecording") { manager.stopRecording() }
    Function("listRecordings") {
      manager.file.recordings().map { mapOf("name" to it.first, "bytes" to it.second.toInt()) }
    }
    Function("cameraFormats") { lens: String -> manager.config.cameraFormats(lens) }
    Function("takeOver") { manager.takeOver() }

    Function("listProfiles") { manager.profiles.list() }
    Function("saveProfile") { name: String -> manager.profiles.save(manager.config.snapshot(), name) }
    Function("applyProfile") { name: String ->
      ConfigJSON.result(manager.setConfigLocally(manager.profiles.load(name)))
    }
    Function("deleteProfile") { name: String -> manager.profiles.delete(name) }

    Function("getCapabilities") {
      ConfigJSON.capabilities(manager.config.capabilities(manager.deviceInfoProto()))
    }
    Function("getConfig") { ConfigJSON.config(manager.config.snapshot()) }
    /** patch: { mode?: "ar"|"camera", streams?: { [id]: { enabled?: bool, params?: { [key]: value } } } } */
    Function("setConfig") { patch: Map<String, Any?> ->
      ConfigJSON.result(manager.setConfigLocally(ConfigJSON.patch(patch)))
    }
  }

  private fun keepScreenOn(on: Boolean) {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  /** CAMERA is a runtime permission on Android; iOS prompts by itself when the session starts. */
  private fun withCameraPermission(block: () -> Unit) {
    val ctx = appContext.reactContext
    if (ctx != null && ctx.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) { block(); return }
    val perms = appContext.permissions ?: run { block(); return }
    perms.askForPermissions(PermissionsResponseListener { _ -> block() }, Manifest.permission.CAMERA)
  }
}
