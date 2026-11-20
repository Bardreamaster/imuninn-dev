// Camera preview as an Expo native view (§4.4): a TextureView that the camera (camera
// mode) or the AR renderer (AR mode) draws into. The whole frame is shown (aspect fit) and
// follows the display rotation, like the iOS view; the JS side sizes the box around it.
package expo.modules.muninncore

import android.content.Context
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.display.DisplayManager
import android.view.Surface
import android.view.TextureView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.muninncore.core.SessionManager
import java.lang.ref.WeakReference
import java.util.concurrent.CopyOnWriteArrayList

class MuninnPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    private val views = CopyOnWriteArrayList<WeakReference<MuninnPreviewView>>()

    /** The video format or mode changed: every live preview lays its picture out again. */
    fun relayoutAll() {
      for (ref in views) {
        val v = ref.get()
        if (v == null) views.remove(ref) else v.post { v.applyTransform(v.width, v.height) }
      }
    }
  }

  private val texture = TextureView(context)

  init {
    setBackgroundColor(Color.BLACK)
    addView(texture, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    views.add(WeakReference(this))
    texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        SessionManager.shared?.setPreviewTexture(st)
        applyTransform(width, height)
      }
      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) { applyTransform(width, height) }
      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        // Only if it is still ours: the full-screen view may already have taken over.
        SessionManager.shared?.clearPreviewTexture(st)
        return true
      }
      override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
    }
  }

  /**
   * Aspect-fit the picture, upright for the current display rotation.
   *
   * A TextureView stretches its buffer over the whole view. Camera2 buffers arrive rotated
   * for the phone's natural orientation (portrait), so they only need turning back by the
   * display rotation; the AR renderer's buffer is the raw sensor image, so it needs the
   * sensor orientation as well. After the rotation the stretched picture is scaled to the
   * largest size with the right aspect that fits the view.
   */
  private fun applyTransform(viewW: Int, viewH: Int) {
    if (viewW == 0 || viewH == 0) return
    val g = SessionManager.shared?.previewGeometry() ?: return
    val display = when (this.display?.rotation ?: Surface.ROTATION_0) {
      Surface.ROTATION_90 -> 90
      Surface.ROTATION_180 -> 180
      Surface.ROTATION_270 -> 270
      else -> 0
    }
    val rotate = ((if (g.prerotated) 0 else g.sensorOrientation) - display + 360) % 360
    // Aspect of the upright picture.
    val sensorTurned = (g.sensorOrientation - display + 360) % 180 != 0
    val picW = if (sensorTurned) g.height else g.width
    val picH = if (sensorTurned) g.width else g.height
    val scale = minOf(viewW.toFloat() / picW, viewH.toFloat() / picH)
    val fitW = picW * scale
    val fitH = picH * scale
    val cx = viewW / 2f
    val cy = viewH / 2f
    val m = Matrix()
    if (rotate % 180 == 0) {
      m.setScale(fitW / viewW, fitH / viewH, cx, cy)
    } else {
      // After a quarter turn the stretched picture is viewH wide and viewW tall on screen.
      m.setScale(fitH / viewW, fitW / viewH, cx, cy)
    }
    m.postRotate(rotate.toFloat(), cx, cy)
    texture.setTransform(m)
  }

  // A half turn (landscape to reverse landscape) changes the rotation but not the view's
  // size, so no layout pass happens: listen for the display itself.
  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayChanged(displayId: Int) { post { applyTransform(width, height) } }
    override fun onDisplayAdded(displayId: Int) {}
    override fun onDisplayRemoved(displayId: Int) {}
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.registerDisplayListener(displayListener, handler)
  }

  override fun onDetachedFromWindow() {
    (context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.unregisterDisplayListener(displayListener)
    super.onDetachedFromWindow()
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    texture.layout(0, 0, r - l, b - t)
    applyTransform(r - l, b - t)
  }
}
