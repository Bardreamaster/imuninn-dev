# Concepts: streams, parameters, profiles, lease, time

## Streams

| id | message | transport | notes |
| --- | --- | --- | --- |
| `ar_pose` | `PoseSample` | UDP | ARKit pose + intrinsics + tracking state; AR mode only |
| `imu` | `ImuSample` | UDP | acceleration (m/s²) + angular rate (rad/s), device frame |
| `rgb` | `VideoFrame` | TCP | H.264 Annex‑B, intrinsics and `rotation_deg` per frame |
| `depth` | `DepthFrame` | TCP | LiDAR depth 256×192, millimetres + confidence, LZ4 |
| `health` | `DeviceHealth` | UDP | thermal state, battery, phone-side rates, encoder drops |

UDP may drop and is latency-first; TCP never drops, but under congestion the phone skips non-key frames and requests a new keyframe. `dev.subscribe([...])` chooses streams; all are subscribed by default.

## Session mode

| | AR mode (default) | Camera mode |
| --- | --- | --- |
| Pose / depth | yes | no |
| Lens | main camera only | wide / ultra-wide / telephoto / front |
| Resolution | `ar_pose.video_format` | `rgb.camera_format` (depends on lens) |
| Switch | `dev.set("session.mode", "ar")` | `dev.set("session.mode", "camera")` |

## Parameter keys and validation

`dev.set(key, value)` takes four kinds of key:

| key | meaning |
| --- | --- |
| `session.mode` | `ar` / `camera`, restarts the session |
| `session.<param>` | session-level switches, e.g. `session.black_screen` (phone screen goes dark after 5 s idle, capture continues) |
| `<stream>.enabled` | stream on / off |
| `<stream>.<param>` | e.g. `imu.rate_hz`, `rgb.exposure_mode`, `depth.rate_divisor` |

The phone validates every field and answers in `ConfigResult.fields`: `applied`, `clamped` (out of range, `effective` holds the value used) or `rejected` (unknown key, wrong type, not a valid choice; `reason` says why). Parameters marked "restart" (mode, lens, resolution, depth on/off, depth smoothing) interrupt capture for about a second; everything else applies immediately.

`dev.capabilities` is the authoritative list of parameters, ranges and current values; both the phone UI and the PC generate from it. Common parameters: [Video and camera](04-video-camera.md), [Depth and MCAP](05-depth-mcap.md); full message definitions: [Protocol messages](../protocol/messages.md).

Several PCs edit one configuration: when anyone changes it everyone receives `ConfigChanged` (`dev.config` updates, the `__event__` callback gets `"config"`), and the phone shows who is in control.

## Profiles

A YAML file is a partial configuration sent as one `SetConfig`:

```yaml
name: calibration
mode: ar                          # ar | camera, optional
session: {black_screen: true}     # session-level switches, optional
streams:
  imu:     {enabled: true, rate_hz: 200, raw: true}
  ar_pose: {enabled: true}
  rgb:     {enabled: true, bitrate_kbps: 8000, exposure_mode: locked, white_balance_mode: locked, focus_mode: locked}
  depth:   {enabled: true}
```

```bash
imuninn profile list                      # built in: calibration / teleop / dataset / camera_wide
imuninn profile apply calibration         # or a YAML path
imuninn profile save -o now.yaml          # save the phone's current config
```

```python
dev.apply_profile("calibration")
dev.save_profile("now.yaml")
```

| built-in | purpose |
| --- | --- |
| `calibration` | locked focus / exposure / white balance, raw IMU 200 Hz, depth on, 8 Mbps |
| `teleop` | low latency: 2 Mbps, keyframe every 15 frames, depth off |
| `dataset` | every stream on, 12 Mbps, smoothed depth |
| `camera_wide` | camera mode, wide lens, no pose |

Profiles saved on the phone itself (Config → Profiles) stay on the phone and are independent of the YAML files. In raw IMU mode the gyroscope tops out at about 100 Hz, so `rate_hz: 200` is limited by hardware.

## Configuration lease

Only one PC may change parameters at a time:

- The first client to call `set()` gets the lease; `set()` from others raises `imuninn.LeaseError`.
- `dev.acquire_lease()` / `dev.release_lease()` manage it explicitly; `dev.lease_holder` shows who has it. Disconnecting releases it.
- Tapping "take over" on the phone revokes it; the previous holder sees a `REVOKED` lease event (`"lease"` on the `__event__` callback). Changes made on the phone itself ignore the lease.

## Health

Every `health.rate_hz` seconds (default 0.2 Hz, up to 5 Hz) the phone sends a `DeviceHealth`: thermal state (nominal / fair / serious / critical), battery and charging, low-power mode, actual per-stream rates, encoder drops, uptime. It is a normal stream: subscribe to it, record it to MCAP (`/health`).

```python
dev.set("health.rate_hz", 1.0)
for h in dev.iter("health"):
    print(h.thermal, h.battery_level, h.video_fps)
```

For long pushes turn on `session.black_screen`: near-zero display power, less heat.

## Data semantics

- Pose: native ARKit convention (right-handed, Y up, camera looks down −Z); the world origin is the camera pose when the session started; `intrinsics` match the ARKit image resolution.
- IMU: `accel` is gravity + user acceleration, `gyro` is CoreMotion's bias-corrected angular rate; with `imu.raw = true` you get the raw sensors with their own timestamps.
- Images and depth are sent in sensor orientation with `rotation_deg = 90` (rotate clockwise by 90° for upright portrait); intrinsics are in sensor orientation. Details: [Camera coordinate systems](../../dev/06-camera-coordinates.md) (Chinese, with Apple references).
- Timestamps: the phone's monotonic clock in nanoseconds, one time base for every stream; `dev.to_pc_time()` converts to the PC clock.
