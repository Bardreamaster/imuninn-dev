# Rerun

```bash
pip install "imuninn[rerun]"
imuninn rerun --start                    # first phone found, spawn the Rerun Viewer, start capture
imuninn rerun iPhone --depth --points    # depth on, back-projected into a point cloud on the PC
imuninn rerun phoneA phoneB              # several phones in one viewer
imuninn rerun --mcap run1.mcap           # replay a recording
imuninn rerun --save run1.rrd iPhone     # write a .rrd instead of opening a window
```

## Layout in the viewer

One subtree per phone (`<dev>` is the device name):

| entity | content |
| --- | --- |
| `world/<dev>` | camera pose (ARKit camera frame) |
| `world/<dev>/trajectory` | camera path |
| `world/<dev>/cam` + `/video` | pinhole camera + image |
| `world/<dev>/depth/image`, `/confidence` | depth (metres) and confidence |
| `world/<dev>/points` | depth back-projected to points (`--points`, coloured from RGB) |
| `plots/<dev>/imu/*`, `pose/tracking`, `health/*` | IMU plots, tracking state, thermal / battery / rates |
| `events/<dev>` | tracking / thermal / low-power changes, drops, config changes |

Timelines: `pc` (wall clock, shared by all phones) and `device` (the phone's monotonic clock).

## Options

| option | effect |
| --- | --- |
| `--video decode` (default) | decode with PyAV on this machine and send images; steady 60 fps |
| `--video stream` | hand H.264 to the viewer; the native viewer needs `ffmpeg` on PATH and stutters at 1920×1440@60 |
| `--every N` | decode one frame in N to save CPU |
| `--scale 0.5` | downscale decoded frames for the viewer (default 0.5; intrinsics scaled to match) |
| `--buffer-ms 150` | playout buffer: release samples in device-time order N ms late, smoothing bursty Wi‑Fi delivery |
| `--points` / `--point-stride` / `--points-hz` | point cloud, its subsampling stride, and the rate cap for points and the confidence image (default 10 Hz) |
| `--no-trajectory` / `--no-blueprint` | no trajectory / keep the viewer's own layout |
| `--port` | use your own viewer port (default 9876) |
| `--seconds N` | stop after N seconds |

Every option: [CLI reference](07-cli.md#imuninn-rerun).
