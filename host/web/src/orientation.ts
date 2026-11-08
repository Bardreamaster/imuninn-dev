// Display orientation of the camera image. Data stays as captured (sensor-native landscape,
// rotation_deg says how to make it upright in portrait); only the on-screen rotation changes.
// "auto" follows gravity: from the AR pose (camera frame) or, in camera mode, the IMU.

export type OrientMode = "auto" | "portrait" | "landscape-left" | "landscape-right" | "upside-down";

/** Extra clockwise rotation (degrees) relative to the portrait-upright presentation. */
const FIXED: Record<Exclude<OrientMode, "auto">, number> = {
  portrait: 0, "landscape-left": 270, "landscape-right": 90, "upside-down": 180,
};

export class OrientationTracker {
  mode: OrientMode = "auto";
  private auto = 0;            // extra rotation decided from gravity, snapped to 0/90/180/270
  private lastSource = 0;      // performance.now() of the last gravity sample

  /** Gravity in the ARKit camera frame: g = R(q)^T * (0,-1,0). Camera x is right in the
   *  sensor's landscape frame, so gravity along +x means the phone is held portrait. */
  fromPose(q: { x: number; y: number; z: number; w: number }): void {
    // second column of R(q), negated
    const gx = -(2 * (q.x * q.y - q.w * q.z));
    const gy = -(1 - 2 * (q.x * q.x + q.z * q.z));
    const gz = -(2 * (q.y * q.z + q.w * q.x));
    this.update(gx, gy, gz);
  }

  /** Gravity from the IMU accelerometer (iOS device frame: x right, y up in portrait).
   *  Sensor frame = device frame rotated: x_cam = -y_dev, y_cam = x_dev. */
  fromAccel(ax: number, ay: number, az: number): void {
    // iOS reports the accelerometer along gravity (face-up on a desk: z ≈ -9.8), so the
    // unit vector is the gravity direction in the device frame; map it into the sensor frame.
    const n = Math.hypot(ax, ay, az) || 1;
    this.update(-ay / n, ax / n, az / n);
  }

  private update(gx: number, gy: number, gz: number): void {
    const planar = Math.hypot(gx, gy);
    if (planar < 0.45) return;                   // lying flat: keep the last orientation
    // 0 = upright portrait (gravity along +x of the sensor frame), measured clockwise.
    let deg = (Math.atan2(gy, gx) * 180) / Math.PI;   // +x -> 0, +y -> 90, -x -> 180, -y -> -90
    deg = ((deg % 360) + 360) % 360;
    const snapped = Math.round(deg / 90) * 90 % 360;
    // hysteresis: switch only when clearly inside the new quadrant (within ±35° of its centre)
    const diff = Math.abs(((deg - snapped + 540) % 360) - 180);
    if (diff <= 35 && snapped !== this.auto) this.auto = snapped;
    this.lastSource = performance.now();
    void gz;
  }

  /** Clockwise rotation to apply on top of the frame's rotation_deg. */
  extra(): number { return this.mode === "auto" ? this.auto : FIXED[this.mode]; }

  hasGravity(): boolean { return performance.now() - this.lastSource < 2000; }
}
