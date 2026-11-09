# What iMuninn is

iMuninn turns an iPhone into a sensor node on your network: camera (H.264), IMU, ARKit 6-DoF pose with per-frame intrinsics and LiDAR depth, sent over the LAN (Wi‑Fi or USB) with a Protobuf protocol. The phone is the server; receivers connect to it, several at once if you like.

## Three ways to receive

| Way | Good for | Start here |
| --- | --- | --- |
| **Python package** `imuninn` | Scripts, datasets, robot stacks, Rerun visualisation, MCAP recording, an MCP server for agents | [Install](../python/01-install.md) → [Quick start](../python/02-quickstart.md) |
| **Web viewer** | A quick look at the picture and the plots: Safari opens the online page; Chrome uses `imuninn web` locally | [Web viewer](../web/01-web-viewer.md) |
| **C++ library** | Real-time control programs that link it directly | [C++ client](../cpp/01-cpp-client.md) |

All three receive the same messages (`imuninn.proto`); only the transport differs: Python / C++ use TCP + UDP, browsers use WebSocket.

## What you get

| Stream | Content | Typical rate |
| --- | --- | --- |
| `ar_pose` | ARKit pose (right-handed, Y up, camera looks down −Z) + camera intrinsics + tracking state | 60 Hz |
| `imu` | Acceleration + angular rate (CoreMotion fused, or raw sensors) | 100–200 Hz |
| `rgb` | H.264 video, intrinsics and `rotation_deg` on every frame | 30–60 fps |
| `depth` | LiDAR depth 256×192, millimetres + confidence, LZ4 | 60 Hz (Pro models) |
| `health` | Thermal state, battery, phone-side frame rates, encoder drops | 0.2–5 Hz |

Every parameter (rates, resolution, lens, exposure / white balance / focus, bitrate, black-screen mode…) can be changed remotely; the phone validates and reports applied / clamped / rejected.

## Measured latency (iPhone 17 Pro, USB)

| Stream | Median one-way latency |
| --- | --- |
| imu | 2.6 ms |
| ar_pose | 39 ms (mostly ARKit's own pipeline) |
| rgb 1920×1440@60 | 49 ms |
| depth | 44 ms |

Over Wi‑Fi the control round trip is about 8 ms; a 3-hour Wi‑Fi run dropped 0.04% of video frames with the phone's thermal state staying nominal (on charger).

## Next

1. [Install the app and connect](02-install-and-connect.md)
2. Pick a receiver and start
