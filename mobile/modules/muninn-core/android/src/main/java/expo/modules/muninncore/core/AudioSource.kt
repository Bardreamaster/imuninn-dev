// Microphone source, stream "audio" (protocol v6). AudioRecord read loop on its own thread,
// cut into fixed-length chunks. Port of ios/Core/AudioSource.swift.
//
// Runs independently of the camera / AR session, so it works in both modes. Timestamps:
// AudioRecord.getTimestamp(TIMEBASE_BOOTTIME) ties a frame position to CLOCK_BOOTTIME, the
// same base as deviceTimeNs() and the IMU, so audio is on the device clock with every other
// stream. The time of a chunk is the capture time of its first frame.
package expo.modules.muninncore.core

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.util.Log
import com.google.protobuf.ByteString
import io.imuninn.proto.AudioChunk
import io.imuninn.proto.AudioEncoding
import io.imuninn.proto.Header
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class AudioSettings(
  val sampleRate: Int = 48000,
  val float32: Boolean = false,          // false = PCM s16le
  val chunkMs: Int = 20,
  val voiceProcessing: Boolean = false,  // true = system AGC / noise suppression / echo cancel
)

class AudioSource(private val ctx: Context) {
  companion object {
    const val STREAM_ID = "audio"
    val SAMPLE_RATES = listOf("8000", "16000", "22050", "24000", "32000", "44100", "48000")

    fun available(ctx: Context): Boolean = ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)
  }

  private val lock = Any()
  private var thread: Thread? = null
  @Volatile private var wantRunning = false
  @Volatile private var generation = 0
  private var seq = 0L          // keeps counting across restarts

  @Volatile var running = false
    private set
  /** Called on the audio thread with a finished chunk. */
  var onChunk: ((AudioChunk) -> Unit)? = null
  /** Permission denied / recorder failure, for Status.lastError. */
  var onError: ((String) -> Unit)? = null
  /** Asks the user for a runtime permission (set by the Expo module, which owns the activity). */
  var requestPermission: ((String, (Boolean) -> Unit) -> Unit)? = null

  private val granted: Boolean
    get() = ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  fun start(s: AudioSettings) {
    stop()
    wantRunning = true
    if (granted) { startThread(s); return }
    val ask = requestPermission
    if (ask == null) { onError?.invoke("microphone permission missing"); return }
    ask(Manifest.permission.RECORD_AUDIO) { ok ->
      if (!wantRunning) return@ask
      if (ok) startThread(s) else onError?.invoke("microphone permission denied (Settings > Apps > iMuninn > Permissions)")
    }
  }

  fun stop() {
    wantRunning = false
    val t = synchronized(lock) { generation++; thread.also { thread = null } }
    if (t != null && t !== Thread.currentThread()) try { t.join(500) } catch (_: InterruptedException) {}
    running = false
  }

  private fun startThread(s: AudioSettings) = synchronized(lock) {
    if (!wantRunning || thread != null) return@synchronized
    val gen = ++generation
    thread = Thread({ record(s, gen) }, "imuninn.audio").apply { isDaemon = true; priority = Thread.MAX_PRIORITY; start() }
  }

  @SuppressLint("MissingPermission")
  private fun record(s: AudioSettings, gen: Int) {
    val encoding = if (s.float32) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT
    val bytesPerFrame = if (s.float32) 4 else 2
    val chunkFrames = (s.sampleRate * s.chunkMs / 1000).coerceAtLeast(1)
    val minBuf = AudioRecord.getMinBufferSize(s.sampleRate, AudioFormat.CHANNEL_IN_MONO, encoding)
    if (minBuf <= 0) { onError?.invoke("audio: ${s.sampleRate} Hz ${if (s.float32) "f32" else "s16"} not supported"); return }
    // raw: no AGC / noise suppression. UNPROCESSED where the device offers it, else
    // VOICE_RECOGNITION (the least processed source every device has).
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    val source = when {
      s.voiceProcessing -> MediaRecorder.AudioSource.VOICE_COMMUNICATION
      am?.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true" -> MediaRecorder.AudioSource.UNPROCESSED
      else -> MediaRecorder.AudioSource.VOICE_RECOGNITION
    }
    val rec = try {
      AudioRecord(source, s.sampleRate, AudioFormat.CHANNEL_IN_MONO, encoding, maxOf(minBuf, chunkFrames * bytesPerFrame * 4))
    } catch (e: Exception) {
      onError?.invoke("audio recorder: ${e.message ?: e}"); return
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release(); onError?.invoke("audio recorder could not be initialised"); return
    }
    try {
      rec.startRecording()
      if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) { onError?.invoke("microphone is in use by another app"); return }
      running = true
      Log.i(TAG, "audio ${s.sampleRate} Hz ${if (s.float32) "f32" else "s16"} chunk ${s.chunkMs} ms source $source")
      val shorts = if (s.float32) null else ShortArray(chunkFrames)
      val floats = if (s.float32) FloatArray(chunkFrames) else null
      val bytes = ByteBuffer.allocate(chunkFrames * bytesPerFrame).order(ByteOrder.LITTLE_ENDIAN)
      val ts = AudioTimestamp()
      var framesRead = 0L
      val chunkNs = chunkFrames * 1_000_000_000L / s.sampleRate
      while (generation == gen) {
        var got = 0
        while (got < chunkFrames && generation == gen) {
          val n = if (shorts != null) rec.read(shorts, got, chunkFrames - got, AudioRecord.READ_BLOCKING)
          else rec.read(floats!!, got, chunkFrames - got, AudioRecord.READ_BLOCKING)
          if (n < 0) { onError?.invoke("audio read failed ($n)"); return }
          got += n
        }
        if (got < chunkFrames) break
        // Capture time of the chunk's first frame.
        val first = framesRead
        framesRead += chunkFrames
        val t = if (rec.getTimestamp(ts, AudioTimestamp.TIMEBASE_BOOTTIME) == AudioRecord.SUCCESS && ts.nanoTime > 0) {
          ts.nanoTime + (first - ts.framePosition) * 1_000_000_000L / s.sampleRate
        } else {
          deviceTimeNs() - chunkNs
        }
        bytes.clear()
        if (shorts != null) bytes.asShortBuffer().put(shorts) else bytes.asFloatBuffer().put(floats!!)
        val c = AudioChunk.newBuilder()
          .setHeader(Header.newBuilder().setStreamId(STREAM_ID).setSeq(seq++).setDeviceTimeNs(t))
          .setEncoding(if (s.float32) AudioEncoding.AUDIO_ENCODING_PCM_F32LE else AudioEncoding.AUDIO_ENCODING_PCM_S16LE)
          .setSampleRate(s.sampleRate)
          .setChannels(1)
          .setFrameCount(chunkFrames)
          .setData(ByteString.copyFrom(bytes.array()))
          .build()
        onChunk?.invoke(c)
      }
    } catch (e: Exception) {
      Log.w(TAG, "audio failed: $e")
      onError?.invoke("audio: ${e.message ?: e}")
    } finally {
      running = false
      try { rec.stop() } catch (_: Exception) {}
      rec.release()
    }
  }
}
