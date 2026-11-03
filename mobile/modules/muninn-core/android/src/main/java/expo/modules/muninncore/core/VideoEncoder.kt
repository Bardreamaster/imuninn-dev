// Hardware H.264 encoder (MediaCodec, Surface input). The camera renders straight into
// the encoder's input surface, so no pixel copy happens on the CPU (§8.1). Output is
// already Annex-B on Android; SPS/PPS (the codec-config buffer) are prepended to keyframes.
package expo.modules.muninncore.core

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.util.concurrent.atomic.AtomicLong

data class EncodedFrame(
  val data: ByteArray,     // Annex-B NAL units; SPS/PPS prepended on keyframes
  val keyframe: Boolean,
  val timeNs: Long,
  val width: Int,
  val height: Int,
)

class VideoEncoder {
  private var codec: MediaCodec? = null
  @Volatile var inputSurface: Surface? = null
    private set
  private val thread = HandlerThread("imuninn.encoder").apply { start() }
  private val handler = Handler(thread.looper)
  var width = 0
    private set
  var height = 0
    private set
  var bitrateBps = 4_000_000
    private set
  var keyframeInterval = 60
    private set
  private var sinceKeyframe = 0
  private var spsPps: ByteArray? = null
  private val encodedCount = AtomicLong()
  private val droppedCount = AtomicLong()
  val encoded: Long get() = encodedCount.get()
  val dropped: Long get() = droppedCount.get()
  var onFrame: ((EncodedFrame) -> Unit)? = null
  val running: Boolean get() = codec != null

  private val callback = object : MediaCodec.Callback() {
    override fun onInputBufferAvailable(c: MediaCodec, index: Int) { /* surface input */ }

    override fun onOutputBufferAvailable(c: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
      try {
        val buf = c.getOutputBuffer(index) ?: return
        buf.position(info.offset); buf.limit(info.offset + info.size)
        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
          spsPps = ByteArray(info.size).also { buf.get(it) }
        } else if (info.size > 0) {
          val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
          val header = if (key) spsPps else null
          val out = ByteArray((header?.size ?: 0) + info.size)
          var off = 0
          if (header != null) { System.arraycopy(header, 0, out, 0, header.size); off = header.size }
          buf.get(out, off, info.size)
          sinceKeyframe = if (key) 0 else sinceKeyframe + 1
          if (sinceKeyframe >= keyframeInterval) requestKeyframe()
          encodedCount.incrementAndGet()
          onFrame?.invoke(EncodedFrame(out, key, info.presentationTimeUs * 1000, width, height))
        }
      } catch (e: Exception) {
        Log.w(TAG, "encoder output failed: $e")
      } finally {
        try { c.releaseOutputBuffer(index, false) } catch (_: Exception) {}
      }
    }

    override fun onError(c: MediaCodec, e: MediaCodec.CodecException) {
      Log.w(TAG, "encoder error: ${e.diagnosticInfo}")
      droppedCount.incrementAndGet()
    }

    override fun onOutputFormatChanged(c: MediaCodec, format: MediaFormat) {
      Log.i(TAG, "encoder format: $format")
    }
  }

  /** Configure for the given size and return the surface the camera should render into. */
  @Synchronized fun start(width: Int, height: Int, fps: Int, bitrateBps: Int, keyframeInterval: Int): Surface? {
    stop()
    this.width = width; this.height = height
    this.bitrateBps = bitrateBps
    this.keyframeInterval = keyframeInterval.coerceAtLeast(1)
    sinceKeyframe = 0
    spsPps = null
    return try {
      val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
        setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        setInteger(MediaFormat.KEY_BIT_RATE, bitrateBps)
        setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        // Keyframes are requested explicitly every `keyframeInterval` frames (so the
        // interval can change at runtime); the codec's own interval is a long fallback.
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 10)
        setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR)
        setInteger(MediaFormat.KEY_LATENCY, 1)
        setInteger(MediaFormat.KEY_PRIORITY, 0)   // realtime
      }
      val c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
      c.setCallback(callback, handler)
      c.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      val surface = c.createInputSurface()
      c.start()
      codec = c
      inputSurface = surface
      Log.i(TAG, "encoder ${c.name} ${width}x${height}@$fps ${bitrateBps / 1000} kbps")
      surface
    } catch (e: Exception) {
      Log.w(TAG, "encoder start failed: $e")
      codec = null
      inputSurface = null
      null
    }
  }

  @Synchronized fun stop() {
    val c = codec ?: return
    codec = null
    try { c.stop() } catch (_: Exception) {}
    try { c.release() } catch (_: Exception) {}
    try { inputSurface?.release() } catch (_: Exception) {}
    inputSurface = null
  }

  fun requestKeyframe() {
    val c = codec ?: return
    try {
      c.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
      sinceKeyframe = 0
    } catch (_: Exception) {}
  }

  fun setBitrate(bps: Int) {
    bitrateBps = bps
    val c = codec ?: return
    try { c.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, bps) }) } catch (_: Exception) {}
  }

  fun setKeyframeInterval(frames: Int) {
    keyframeInterval = frames.coerceAtLeast(1)
  }
}
