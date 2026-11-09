# Depth and MCAP

Pro models send LiDAR depth; the PC records every stream as-is to MCAP, for replay and conversion.

## Depth stream

AR mode only (ARKit `sceneDepth`), off by default:

```python
dev.set("depth.enabled", True)       # restarts the capture session (about 1 s)
for f in dev.iter("depth"):
    depth_mm, conf = imuninn.depth.decode(f)     # uint16 (H, W) millimetres, 0 = invalid; uint8 confidence 0/1/2
    metres = imuninn.depth.to_metres(depth_mm)   # float32 metres, NaN where invalid
```

| parameter | type | notes |
| --- | --- | --- |
| `depth.enabled` | bool | on / off (restarts the session) |
| `depth.smoothed` | bool | ARKit's temporally smoothed depth (restarts the session) |
| `depth.compression` | `lz4` / `none` | lossless LZ4 (Apple Compression block format, decoded on the PC automatically) |
| `depth.rate_divisor` | 1–6 | send one frame in N |

Semantics:

- Resolution 256×192 (fixed by ARKit); `intrinsics` are scaled to it. Orientation matches RGB (`rotation_deg` = 90), and each frame corresponds to the `ar_pose` / `rgb` frame with the same timestamp.
- Depth is the distance along the optical axis (ARKit's definition) in millimetres; confidence 0 low, 1 medium, 2 high.
- Measured on iPhone 17 Pro: 60 Hz, about 54 KB per frame after LZ4 (96 KB raw + 48 KB confidence).

## MCAP

```bash
imuninn record --start -o run1.mcap            # every subscribed stream, Ctrl-C to stop
imuninn record --start --depth --streams ar_pose,depth -o d.mcap
imuninn info run1.mcap                          # messages per topic
imuninn rerun --mcap run1.mcap                  # replay in Rerun
imuninn convert 20261103-153000.imuninn         # phone-side recording -> MCAP
```

The file holds the protocol messages themselves (the Protobuf schema is embedded, so any MCAP + Protobuf tool can read it):

| topic | message | notes |
| --- | --- | --- |
| `/device` `/capabilities` | DeviceInfo / Capabilities | one each at the start |
| `/config` | ConfigChanged | one at the start, then one per change; each sample's `header.config_version` points back to it |
| `/imu` `/ar_pose` `/rgb` `/depth` | ImuSample / PoseSample / VideoFrame / DepthFrame | `publish_time` = device clock, `log_time` = PC wall clock (device time + the offset measured at connect) |

Replay in Python:

```python
from imuninn.mcap_io import replay
for stream, sample in replay("run1.mcap", realtime=False):
    ...
```

Phone-side recordings (`.imuninn`) have no PC clock, so after conversion `log_time` = device clock.
