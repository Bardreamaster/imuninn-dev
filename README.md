# iMuninn

[中文](README.zh-CN.md)

Turn a phone into a portable multimodal sensor node: camera (H.264), IMU, ARKit / ARCore pose with per-frame intrinsics and LiDAR depth, streamed live to a PC over Wi‑Fi or USB with a Protobuf protocol, and handed to robot programs, algorithms and data-collection pipelines through Python, C++ or a browser.

- Documentation: <https://imuninn.projects.weijinqi.com> ([English](https://imuninn.projects.weijinqi.com/en/)); sources in [`docs/`](docs/README.md)
- Python package: `pip install imuninn` ([`host/python`](host/python/README.md))
- Web viewer: <https://imuninn-webviewer.projects.weijinqi.com> (Safari connects directly; in Chrome / Edge run `imuninn web`)

## How it works

The phone is the server. It advertises `_imuninn._tcp` over Bonjour and listens for a control WebSocket (port 7420); receivers connect to it, several at once if needed. Pose, IMU and health arrive over UDP, video and depth over TCP, or everything over a second WebSocket for browsers. Every parameter is self-describing and can be changed remotely; the phone validates each change and reports whether it was applied, clamped or rejected.

| Stream | Content | Typical rate |
| --- | --- | --- |
| `ar_pose` | ARKit pose + camera intrinsics + tracking state | 60 Hz |
| `imu` | acceleration + angular rate | 100–200 Hz |
| `rgb` | H.264 video, intrinsics on every frame | 30–60 fps |
| `depth` | LiDAR depth 256×192, millimetres + confidence, LZ4 | 60 Hz |
| `health` | thermal state, battery, phone-side rates | 0.2–5 Hz |

## Quick start

```python
import imuninn

with imuninn.connect() as dev:          # first phone found; or a name / IP / "ip:port"
    dev.start()
    for pose in dev.iter("ar_pose"):
        print(pose.position, pose.intrinsics.fx)
```

```bash
imuninn list                  # phones on the LAN
imuninn rerun --start         # live view in Rerun (pip install "imuninn[rerun]")
imuninn record -o run1.mcap   # record every stream to MCAP (pip install "imuninn[mcap]")
imuninn web                   # browser viewer at http://localhost:7430
```

## Repository layout

```
protocol/   imuninn.proto, protocol spec, VERSION (single source of truth)
mobile/     Expo app; the native data path lives in modules/muninn-core/
host/       PC side: python/ (PyPI package imuninn: client API, CLI, MCP server), cpp/, web/ (browser viewer)
tools/      code and docs generation, latency / bandwidth benchmarks
docs/       documentation sources; site/ is the Astro Starlight site
```

## Building from source

- iOS app: macOS with Xcode, Node ≥ 20. Development builds only (no Expo Go):

  ```bash
  cd mobile && npm install && npx expo run:ios --device
  ```

- Python package: Python ≥ 3.10, [uv](https://docs.astral.sh/uv/) recommended. The protobuf bindings are committed, so `protoc` is only needed after editing `protocol/imuninn.proto` (`tools/gen-proto.sh`).

  ```bash
  cd host/python && uv venv && uv pip install -e ".[all,dev]" && imuninn list
  ```

- C++ client: CMake + protobuf, see [`docs/cpp`](docs/cpp/01-cpp-client.md).

## License

Dual-licensed under `MIT OR Apache-2.0` (`LICENSE-MIT`, `LICENSE-APACHE`). GPL components are not allowed in dependencies.
