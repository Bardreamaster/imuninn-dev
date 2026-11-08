# imuninn

Python client for [iMuninn](https://imuninn.projects.weijinqi.com): an iPhone app that turns the phone into a network sensor node — camera (H.264), IMU, ARKit 6-DoF pose with per-frame intrinsics, LiDAR depth — served over the LAN with a Protobuf protocol. This package discovers phones, connects, configures them, receives and decodes the streams, records MCAP and visualises in Rerun.

- Documentation: [中文](https://imuninn.projects.weijinqi.com/python/) · [English](https://imuninn.projects.weijinqi.com/en/python/)
- Source: <https://github.com/Bardreamaster/imuninn> (`host/python`)

## Install

```bash
pip install imuninn              # discovery, connection, config, pose / IMU / depth decoding, CLI
pip install "imuninn[all]"       # + video decoding, MCAP, Rerun, MCP server
```

| extra | adds | brings in |
| --- | --- | --- |
| `video` | H.264 decoding to NumPy (`imuninn.video.H264Decoder`) | PyAV |
| `mcap` | `imuninn record / convert / info`, MCAP replay | mcap, mcap-protobuf-support |
| `rerun` | `imuninn rerun` live viewer and MCAP playback | rerun-sdk, PyAV |
| `mcp` | `imuninn-mcp`, an MCP server so agents can drive the phone | mcp, Pillow |

The browser viewer (`imuninn web`) is part of the core package: a static page served from localhost that connects straight to the phone.

Python 3.10+. The phone needs the iMuninn app (iOS; Android camera-only) on the same network, or a USB cable (iPhone shares a link-local network over USB).

## Quick start

```python
import imuninn

for phone in imuninn.discover():            # Bonjour: _imuninn._tcp
    print(phone.name, phone.address)

with imuninn.connect() as dev:              # first phone found; or a name / IP / "ip:port"
    dev.set("imu.rate_hz", 100)             # validated by the phone: applied / clamped / rejected
    dev.start()                             # capture session on
    for pose in dev.iter("ar_pose"):        # also "imu", "rgb", "depth", "health"
        t = dev.to_pc_time(pose.header.device_time_ns)
        print(t, pose.position, pose.intrinsics.fx)
```

Everything is synchronous; the asyncio client (`imuninn.client.PhoneClient`) is there if you want to drive it yourself. Parameters are self-describing (`dev.capabilities`), can be grouped into YAML profiles (`dev.apply_profile("calibration")`), and a config lease keeps several PCs from fighting over one phone.

## Command line

```bash
imuninn list                                 # phones on the LAN
imuninn watch --start                        # print samples as text
imuninn rerun --start --depth                # Rerun viewer: pose, trajectory, video, depth, IMU, health
imuninn record -o run1.mcap                  # record every stream to MCAP
imuninn rerun --mcap run1.mcap               # play it back
imuninn profile apply dataset                # built-in YAML preset
imuninn web                                  # browser viewer at http://localhost:7430 (video, depth, pose, IMU)
imuninn-mcp                                  # MCP server (stdio) for agents
```

All commands take an optional phone target (`iPhone`, `10.0.0.5`, `10.0.0.5:7420`).

## Data

Pose: ARKit convention (right-handed, Y up, camera looks down −Z), with camera intrinsics in every sample. Video: H.264 Annex-B, sensor orientation plus `rotation_deg`. Depth: uint16 millimetres + confidence, LZ4. Timestamps: device monotonic time plus a measured offset to the PC clock. The wire format is `imuninn/proto/imuninn.proto` inside the package.

## License

MIT or Apache-2.0, at your option.
