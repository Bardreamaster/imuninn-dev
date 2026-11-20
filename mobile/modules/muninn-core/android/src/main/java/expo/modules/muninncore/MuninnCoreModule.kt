// Thin Expo adapter (§4.2). Everything substantive lives in core/.
package expo.modules.muninncore

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.MotionEvent
import android.view.Surface
import android.view.Window
import android.view.WindowInsets
import android.view.WindowManager
import com.google.ar.core.ArCoreApk
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.muninncore.core.ConfigJSON
import expo.modules.muninncore.core.LocalDeviceInfo
import expo.modules.muninncore.core.PROTOCOL_VERSION
import expo.modules.muninncore.core.SessionManager
import java.util.Locale

class MuninnCoreModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no react context")
  private val manager: SessionManager
    get() = SessionManager.get(context)
  private val prefs by lazy { context.getSharedPreferences("imuninn", Context.MODE_PRIVATE) }
  private var lifecycle: Application.ActivityLifecycleCallbacks? = null
  private var arInstallAsked = false
  private var lastActivityMs = 0L

  override fun definition() = ModuleDefinition {
    Name("MuninnCore")

    Constants("protocolVersion" to PROTOCOL_VERSION)

    Events("onStatus", "onConfig", "onUserActivity")

    OnCreate {
      val m = manager
      m.onStatus = { s ->
        sendEvent("onStatus", mapOf(
          "server" to s.server,
          "serverError" to s.serverError,
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
          "audioHz" to s.audioHz,
          "videoKbps" to s.videoKbps,
          "encoderDropped" to s.encoderDropped.toInt(),
          "frameWidth" to s.frameWidth,
          "frameHeight" to s.frameHeight,
          "recording" to s.recording,
          "recordingFile" to s.recordingFile,
          "recordingBytes" to s.recordingBytes.toDouble(),
          "configVersion" to s.configVersion,
          "remoteControlled" to s.remoteControlled,
          "blackScreen" to s.blackScreen,
          "writer" to s.writer,
          "lastError" to s.lastError,
        ))
      }
      m.onConfigChanged = { cfg -> sendEvent("onConfig", mapOf("config" to ConfigJSON.config(cfg))) }
      m.onModeChanged = { MuninnPreviewView.relayoutAll() }
      m.requestPermission = { permission, done -> askPermission(permission, done) }
      keepScreenOn(true)
      watchActivity()
    }

    // The app exists to stream while in the foreground: never auto-lock (§11).
    OnActivityEntersForeground {
      keepScreenOn(true)
      watchActivity()
      offerArInstall()
    }

    OnDestroy {
      keepScreenOn(false)
      lifecycle?.let { (context.applicationContext as? Application)?.unregisterActivityLifecycleCallbacks(it) }
      lifecycle = null
    }

    View(MuninnPreviewView::class) {}

    Function("getDeviceInfo") {
      manager   // the AR probe runs when the manager is created
      LocalDeviceInfo.current(context).toMap()
    }

    Function("startServer") { name: String? ->
      manager.startServer(name?.takeIf { it.isNotEmpty() })
    }
    Function("stopServer") { manager.stopServer() }

    // The camera / microphone permissions are requested by the session manager when a
    // source needs them, so a session started from a PC gets the same prompt.
    Function("setPreview") { enabled: Boolean -> manager.setPreview(enabled) }
    Function("startSession") { manager.startSession() }
    Function("stopSession") { manager.stopSession() }
    Function("startRecording") { manager.startRecording() }
    Function("stopRecording") { manager.stopRecording() }
    Function("listRecordings") {
      manager.file.recordings().map { mapOf("name" to it.first, "bytes" to it.second.toDouble()) }
    }
    // Small persistent preferences (SharedPreferences): UI language etc.
    Function("getPreference") { key: String -> prefs.getString(key, null) }
    Function("setPreference") { key: String, value: String -> prefs.edit().putString(key, value).apply() }
    // Screen brightness (0..1) for the black-screen mode; a negative value hands it back to the system.
    Function("setScreenBrightness") { value: Double ->
      val activity = appContext.currentActivity
      activity?.runOnUiThread {
        val lp = activity.window.attributes
        lp.screenBrightness = if (value < 0) WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE else value.coerceIn(0.0, 1.0).toFloat()
        activity.window.attributes = lp
      }
    }
    // System language, screen brightness, window insets (dp) and which edge the camera cutout is on.
    Function("uiInfo") { uiInfo() }
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
    /** patch: { mode?, session?: { [key]: value }, streams?: { [id]: { enabled?: bool, params?: { [key]: value } } } } */
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

  /** Runtime permission prompt; answers false when there is no activity to show it on. */
  private fun askPermission(permission: String, done: (Boolean) -> Unit) {
    val perms = appContext.permissions
    if (perms == null || appContext.currentActivity == null) { done(false); return }
    try {
      perms.askForPermissions(PermissionsResponseListener { result ->
        done(result[permission]?.status == PermissionsStatus.GRANTED)
      }, permission)
    } catch (e: Exception) {
      done(context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED)
    }
  }

  /**
   * Hooks that need the activity: stop / start (the equivalent of iOS background /
   * foreground; a permission dialog only pauses the activity and must not drop the PCs)
   * and a touch watcher for the black-screen idle timer.
   */
  private fun watchActivity() {
    val activity = appContext.currentActivity ?: return
    activity.runOnUiThread { watchTouches(activity.window) }
    if (lifecycle != null) return
    val app = activity.application
    val cb = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityStarted(a: Activity) { if (a === appContext.currentActivity) manager.enterForeground() }
      override fun onActivityStopped(a: Activity) { if (a === appContext.currentActivity) manager.enterBackground() }
      override fun onActivityCreated(a: Activity, b: Bundle?) {}
      override fun onActivityResumed(a: Activity) {}
      override fun onActivityPaused(a: Activity) {}
      override fun onActivitySaveInstanceState(a: Activity, b: Bundle) {}
      override fun onActivityDestroyed(a: Activity) {}
    }
    app.registerActivityLifecycleCallbacks(cb)
    lifecycle = cb
  }

  /** Every touch in the activity's window reports "the user did something", at most twice a second. */
  private fun watchTouches(window: Window) {
    val current = window.callback ?: return
    if (current is TouchWatcher) return
    window.callback = TouchWatcher(current) {
      val now = SystemClock.uptimeMillis()
      if (now - lastActivityMs >= 500) {
        lastActivityMs = now
        sendEvent("onUserActivity", emptyMap<String, Any?>())
      }
    }
  }

  private class TouchWatcher(private val inner: Window.Callback, private val hit: () -> Unit) : Window.Callback by inner {
    override fun dispatchTouchEvent(event: MotionEvent?): Boolean {
      hit()
      return inner.dispatchTouchEvent(event)
    }
  }

  /** ARCore-capable phone without (a current) Google Play Services for AR: offer the install once. */
  private fun offerArInstall() {
    if (arInstallAsked || !manager.ar.installNeeded) return
    val activity = appContext.currentActivity ?: return
    arInstallAsked = true
    activity.runOnUiThread {
      try { ArCoreApk.getInstance().requestInstall(activity, true) } catch (_: Throwable) {}
    }
  }

  private fun uiInfo(): Map<String, Any?> {
    val out = HashMap<String, Any?>()
    var top = 0.0; var left = 0.0; var bottom = 0.0; var right = 0.0
    var notch = "top"
    var brightness = -1.0
    val activity = appContext.currentActivity
    if (activity != null) {
      try {
        val density = activity.resources.displayMetrics.density.toDouble()
        val insets = activity.window.decorView.rootWindowInsets
        if (insets != null) {
          if (android.os.Build.VERSION.SDK_INT >= 30) {
            val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            top = i.top / density; left = i.left / density; bottom = i.bottom / density; right = i.right / density
          } else {
            @Suppress("DEPRECATION")
            run {
              top = insets.systemWindowInsetTop / density; left = insets.systemWindowInsetLeft / density
              bottom = insets.systemWindowInsetBottom / density; right = insets.systemWindowInsetRight / density
            }
          }
        }
        @Suppress("DEPRECATION")
        val rotation = if (android.os.Build.VERSION.SDK_INT >= 30) activity.display?.rotation else activity.windowManager.defaultDisplay.rotation
        notch = when (rotation) {
          Surface.ROTATION_90 -> "left"     // phone turned left: the top edge (cutout) is on the left
          Surface.ROTATION_270 -> "right"
          Surface.ROTATION_180 -> "bottom"
          else -> "top"
        }
        val override = activity.window.attributes.screenBrightness
        brightness = if (override >= 0f) override.toDouble() else -1.0
      } catch (_: Exception) {}
    }
    out["top"] = top; out["left"] = left; out["bottom"] = bottom; out["right"] = right
    out["notch"] = notch
    out["brightness"] = brightness
    out["language"] = Locale.getDefault().toLanguageTag()
    return out
  }
}
