// Shared constants and small helpers for the Android data path. Plain Kotlin, no Expo imports (§4.2).
package expo.modules.muninncore.core

import android.os.SystemClock

const val TAG = "imuninn"

/** Keep in sync with protocol/VERSION. */
const val PROTOCOL_VERSION = 6

/**
 * Device monotonic clock in nanoseconds (§6.5). Android sensors and (on most devices)
 * Camera2 timestamps use CLOCK_BOOTTIME, which is what elapsedRealtimeNanos() reads.
 */
fun deviceTimeNs(): Long = SystemClock.elapsedRealtimeNanos()

/**
 * A camera timestamp on the device clock. Camera HALs stamp frames with either
 * CLOCK_BOOTTIME (what deviceTimeNs() reads) or CLOCK_MONOTONIC (System.nanoTime(), which
 * stops while the phone is in deep sleep). The two differ by the time spent asleep, so the
 * base that puts `ts` closest to "now" is the one it was taken with.
 */
fun cameraTimeToDeviceNs(ts: Long): Long {
  val boot = SystemClock.elapsedRealtimeNanos()
  val mono = System.nanoTime()
  return if (kotlin.math.abs(boot - ts) <= kotlin.math.abs(mono - ts)) ts else ts + (boot - mono)
}

/** Samples per second, measured over windows of at least one second. */
class RateCounter {
  private var count = 0
  private var t0 = System.nanoTime()
  @Volatile private var last = 0.0

  @Synchronized fun tick() { count += 1 }
  fun peek(): Double = last

  @Synchronized fun rate(): Double {
    val now = System.nanoTime()
    val dt = (now - t0) / 1e9
    if (dt >= 1.0) {
      last = count / dt
      count = 0
      t0 = now
    }
    return last
  }
}

/** Kilobits per second, same windowing as RateCounter. */
class ByteRate {
  private var bytes = 0L
  private var t0 = System.nanoTime()
  @Volatile private var last = 0.0

  @Synchronized fun add(n: Int) { bytes += n }
  fun peek(): Double = last

  @Synchronized fun kbps(): Double {
    val now = System.nanoTime()
    val dt = (now - t0) / 1e9
    if (dt >= 1.0) {
      last = bytes * 8.0 / 1000.0 / dt
      bytes = 0
      t0 = now
    }
    return last
  }
}
