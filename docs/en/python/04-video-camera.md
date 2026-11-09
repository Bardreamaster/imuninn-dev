# Video and camera parameters

H.264 video is streamed live to the PC; camera mode lets you switch lenses and control exposure, white balance, focus and every other camera setting.

## Two modes

| | AR mode (default) | Camera mode |
| --- | --- | --- |
| Pose | yes (ARKit) | no |
| Lens | main camera only (wide) | wide / ultra-wide / telephoto / front |
| Resolution | `ar_pose.video_format` (formats ARKit offers) | `rgb.camera_format` (depends on the lens) |
| Switch | `dev.set("session.mode", "ar")` | `dev.set("session.mode", "camera")` |

Changing the mode, lens or resolution restarts the capture session (about 1 s gap). Exposure lock, bitrate and keyframe interval apply immediately.

## Video parameters

| key | type | notes |
| --- | --- | --- |
| `imu.raw` | bool | true = raw accelerometer + gyroscope (uncalibrated, own timestamps); false = CoreMotion fused values |
| `rgb.enabled` | bool | video stream on / off |
| `rgb.lens` | `wide` / `ultra_wide` / `telephoto` / `front` | camera mode only |
| `rgb.camera_format` | `WxH@fps` | camera mode only; the choices depend on the lens, see the capabilities |
| `rgb.bitrate_kbps` | 500–20000 | H.264 bitrate |
| `rgb.keyframe_interval` | 1–300 frames | keyframe interval |

## Camera controls (`rgb.*`, all immediate)

| key | values | notes |
| --- | --- | --- |
| `exposure_mode` | `auto` / `locked` / `manual` | manual uses the next two |
| `iso` | device range (iPhone 17 Pro about 25–3000) | manual ISO |
| `exposure_ms` | device range | manual shutter, milliseconds |
| `exposure_bias` | about −8 … +8 EV | exposure compensation, also in auto / locked |
| `white_balance_mode` | `auto` / `locked` / `manual` | **lock it for calibration**, otherwise the colour temperature drifts |
| `wb_temperature_k` | 2000–10000 K | manual white-balance temperature |
| `wb_tint` | −150 … 150 | manual white-balance tint |
| `focus_mode` | `auto` / `locked` / `manual` | locked keeps the current focus; in AR mode anything but auto turns ARKit autofocus off |
| `lens_position` | 0 (near) … 1 (far) | manual lens position |
| `zoom` | 1 … device maximum (≤ 10) | camera mode only; ARKit fixes 1.0 in AR mode |
| `torch` | bool | torch, camera mode only |
| `hdr` | bool | video HDR, camera mode only and when the format supports it |
| `low_light_boost` | bool | low-light boost, camera mode only |
| `stabilization` | `off` / `standard` / `cinematic` | camera mode only; **keep it off for exact intrinsics** (stabilisation crops and warps the image) |

Ranges come from the device (`min` / `max` in the capabilities); out-of-range values are clamped. On Android the same parameters map to Camera2: manual exposure, manual white balance and manual focus need `MANUAL_SENSOR`, `MANUAL_POST_PROCESSING` and a focusable lens respectively, and fall back to locked / preset / auto when missing. In AR mode the controls act on the camera device ARKit is using (iOS 16+). AVFoundation does not report distortion coefficients; in manual modes the intrinsics still come from the system.

## Video data

- `VideoFrame.data` is H.264 Annex‑B NAL units, with SPS / PPS before every keyframe, ready for any decoder.
- `rotation_deg`: images are sent in sensor orientation. Every iPhone lens, front included, reports 90 (rotate clockwise by 90° for upright portrait). Intrinsics are in sensor orientation.
- Every frame carries `intrinsics` (from AVCapture's intrinsic matrix in camera mode, from ARKit in AR mode).
- Transport: TCP, `uint32 LE length + DataMessage`. Under congestion the phone drops non-key frames and requests a new keyframe; the PC decoder skips every P-frame until the next keyframe.

Decoding on the PC:

```python
from imuninn.video import H264Decoder      # pip install 'imuninn[video]'
dec = H264Decoder()
for frame in dev.iter("rgb"):
    for img in dec.decode(frame):           # numpy (H, W, 3) RGB, already rotated upright
        ...
```

## Rerun

`imuninn rerun --start` draws video, pose, depth and IMU together, see [Rerun](06-rerun.md).

## Recording on the phone

From the PC, `dev.start_recording()` / `dev.stop_recording()` (the phone UI has no button for it). Files go to `Documents/recordings/<time>.imuninn` on the phone (copy them out with Finder → iPhone → Files → iMuninn). The format is the `IMUNINN1` magic followed by `uint32 LE length + DataMessage` records, the same as the TCP stream; `imuninn convert x.imuninn` turns one into MCAP. Recording on the PC with `imuninn record` is usually simpler.

## Measured (iPhone 17 Pro ↔ MacBook, Wi‑Fi)

- AR mode 1920x1440@60: video 59 fps with no drops at 4 Mbps; pose 60 Hz and IMU 100 Hz at the same time
- Camera mode 1920x1080@30: 25–30 fps; switching between the three rear lenses takes about 2 s each, fx ≈ 790 / 1280 / 5650 (ultra-wide / wide / telephoto)
- PC decoding (PyAV, LGPL build) keeps up with 60 fps
