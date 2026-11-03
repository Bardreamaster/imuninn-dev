// Shared constants and small helpers for the Android data path. Plain Kotlin, no Expo imports (§4.2).
package expo.modules.muninncore.core

import android.os.SystemClock

const val TAG = "imuninn"

/** Keep in sync with protocol/VERSION. */
const val PROTOCOL_VERSION = 3

/**
 * Device monotonic clock in nanoseconds (§6.5). Android sensors and (on most devices)
 * Camera2 timestamps use CLOCK_BOOTTIME, which is what elapsedRealtimeNanos() reads.
 */
fun deviceTimeNs(): Long = SystemClock.elapsedRealtimeNanos()

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
