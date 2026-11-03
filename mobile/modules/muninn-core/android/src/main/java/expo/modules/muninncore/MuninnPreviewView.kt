// Camera preview as an Expo native view (§4.4): a TextureView the camera renders into.
package expo.modules.muninncore

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.view.TextureView
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.muninncore.core.SessionManager

class MuninnPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val texture = TextureView(context)

  init {
    addView(texture, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(st: SurfaceTexture, width: Int, height: Int) {
        SessionManager.shared?.setPreviewTexture(st)
        applyTransform(width, height)
      }
      override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, width: Int, height: Int) { applyTransform(width, height) }
      override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        SessionManager.shared?.setPreviewTexture(null)
        return true
      }
      override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
    }
  }

  /**
   * Aspect-fill. In portrait the camera delivers landscape buffers that the framework
   * rotates for display, so the visible aspect is height:width of the format.
   */
  private fun applyTransform(viewW: Int, viewH: Int) {
    val m = SessionManager.shared ?: return
    val bufW = m.camera.width.takeIf { it > 0 } ?: return
    val bufH = m.camera.height.takeIf { it > 0 } ?: return
    val rotated = m.camera.rotationDeg % 180 != 0
    val srcW = if (rotated) bufH else bufW
    val srcH = if (rotated) bufW else bufH
    if (viewW == 0 || viewH == 0) return
    val scale = maxOf(viewW.toFloat() / srcW, viewH.toFloat() / srcH)
    val sx = srcW * scale / viewW
    val sy = srcH * scale / viewH
    val matrix = Matrix()
    matrix.setScale(sx, sy, viewW / 2f, viewH / 2f)
    texture.setTransform(matrix)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed, l, t, r, b)
    texture.layout(0, 0, r - l, b - t)
    applyTransform(r - l, b - t)
  }
}
