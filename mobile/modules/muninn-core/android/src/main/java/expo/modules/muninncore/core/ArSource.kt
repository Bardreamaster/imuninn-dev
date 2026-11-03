// ARCore world-tracking source (§5.2). NOT IMPLEMENTED YET: only availability detection.
//
// What the real implementation needs (to be done on a physical ARCore phone — the
// emulator on Apple Silicon cannot run ARCore at all):
//  - Session(context) + Config(updateMode LATEST_CAMERA_IMAGE, focusMode per config)
//  - an EGL context + camera texture so session.update() can run on a GL thread;
//    per Frame: camera.pose (position + quaternion, same convention as ARKit),
//    camera.imageIntrinsics, camera.trackingState, frame.timestamp (CLOCK_BOOTTIME ns)
//  - RGB for the encoder: either frame.acquireCameraImage() (YUV_420_888 → encoder
//    input buffer, CPU copy) or SharedCamera to add the encoder surface as a second
//    camera target (zero-copy, like CameraSource)
//  - depth: frame.acquireDepthImage16Bits() (uint16 mm, already the protocol format)
package expo.modules.muninncore.core

import android.content.Context
import android.util.Log
import com.google.ar.core.ArCoreApk

object ArSource {
  /** ARCore availability as reported by Google Play Services for AR (may be "checking" on first call). */
  fun arcoreStatus(ctx: Context): String = try {
    ArCoreApk.getInstance().checkAvailability(ctx).toString()
  } catch (e: Throwable) {
    "unavailable: ${e.javaClass.simpleName}"
  }

  /** Whether AR mode can be offered. False until the pose/depth path above exists. */
  fun supported(ctx: Context): Boolean {
    Log.i(TAG, "arcore availability: ${arcoreStatus(ctx)} (AR mode not implemented on Android yet)")
    return false
  }
}
