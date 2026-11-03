// SensorManager IMU source (§5.2). Timestamps are SensorEvent.timestamp (CLOCK_BOOTTIME ns),
// the same base as deviceTimeNs().
//
// Two modes, mirroring iOS:
//  - calibrated (default): TYPE_ACCELEROMETER (gravity included, m/s²) + TYPE_GYROSCOPE
//    (bias-corrected rad/s) + TYPE_MAGNETIC_FIELD (µT).
//  - raw: *_UNCALIBRATED variants straight from the sensors.
// A sample is emitted per gyro event with the latest accelerometer reading.
package expo.modules.muninncore.core

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread
import io.imuninn.proto.Header
import io.imuninn.proto.ImuSample
import io.imuninn.proto.Vec3

class ImuSource(ctx: Context) {
  companion object { const val STREAM_ID = "imu" }

  private val manager = ctx.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val thread = HandlerThread("imuninn.imu").apply { start() }
  private val handler = Handler(thread.looper)
  private var seq = 0L
  var rateHz = 100
    private set
  var raw = false
    private set
  @Volatile var running = false
    private set
  var onSample: ((ImuSample) -> Unit)? = null

  private var accel = doubleArrayOf(0.0, 0.0, 0.0)
  private var haveAccel = false
  private var mag = doubleArrayOf(0.0, 0.0, 0.0)
  private var haveMag = false

  val available: Boolean
    get() = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null && manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null

  private val listener = object : SensorEventListener {
    override fun onSensorChanged(e: SensorEvent) {
      when (e.sensor.type) {
        Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_ACCELEROMETER_UNCALIBRATED -> {
          accel[0] = e.values[0].toDouble(); accel[1] = e.values[1].toDouble(); accel[2] = e.values[2].toDouble()
          haveAccel = true
        }
        Sensor.TYPE_MAGNETIC_FIELD -> {
          mag[0] = e.values[0].toDouble(); mag[1] = e.values[1].toDouble(); mag[2] = e.values[2].toDouble()
          haveMag = true
        }
        Sensor.TYPE_GYROSCOPE, Sensor.TYPE_GYROSCOPE_UNCALIBRATED -> {
          if (!haveAccel) return
          val b = ImuSample.newBuilder()
          b.header = Header.newBuilder().setStreamId(STREAM_ID).setSeq(seq++).setDeviceTimeNs(e.timestamp).build()
          b.accel = Vec3.newBuilder().setX(accel[0]).setY(accel[1]).setZ(accel[2]).build()
          b.gyro = Vec3.newBuilder().setX(e.values[0].toDouble()).setY(e.values[1].toDouble()).setZ(e.values[2].toDouble()).build()
          if (haveMag) b.mag = Vec3.newBuilder().setX(mag[0]).setY(mag[1]).setZ(mag[2]).build()
          onSample?.invoke(b.build())
        }
      }
    }
    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
  }

  fun start(rateHz: Int, raw: Boolean) {
    stop()
    this.rateHz = rateHz
    this.raw = raw
    haveAccel = false; haveMag = false
    val periodUs = (1_000_000 / rateHz).coerceAtLeast(1000)
    val accelType = if (raw) Sensor.TYPE_ACCELEROMETER_UNCALIBRATED else Sensor.TYPE_ACCELEROMETER
    val gyroType = if (raw) Sensor.TYPE_GYROSCOPE_UNCALIBRATED else Sensor.TYPE_GYROSCOPE
    val a = manager.getDefaultSensor(accelType) ?: manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
    val g = manager.getDefaultSensor(gyroType) ?: manager.getDefaultSensor(Sensor.TYPE_GYROSCOPE) ?: return
    running = true
    manager.registerListener(listener, a, periodUs, handler)
    manager.registerListener(listener, g, periodUs, handler)
    if (!raw) manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let { manager.registerListener(listener, it, periodUs, handler) }
  }

  fun setRate(hz: Int) {
    rateHz = hz
    if (running) start(hz, raw)
  }

  fun stop() {
    if (running) manager.unregisterListener(listener)
    running = false
  }
}
