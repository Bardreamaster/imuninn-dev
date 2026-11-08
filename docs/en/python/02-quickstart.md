# Quick start

With the app open on the phone and `imuninn` installed (see [Install](01-install.md)), five lines get you poses:

```python
import imuninn

with imuninn.connect() as dev:          # first phone found; or "iPhone" / "10.0.0.5" / "10.0.0.5:7420"
    dev.start()                         # capture session on (or tap Start on the phone)
    for pose in dev.iter("ar_pose"):    # blocking iterator; same for "imu" / "rgb" / "depth" / "health"
        print(pose.position, pose.intrinsics.fx)
```

Everything is synchronous; no asyncio needed.

## Discover and connect

```python
for p in imuninn.discover():            # Bonjour, about 2 s
    print(p.name, p.address, p.protocol_version)

dev = imuninn.connect("iPhone")         # by name
dev = imuninn.connect("10.0.0.5:7420")  # by address (when the Wi‑Fi blocks mDNS)
dev.close()
```

`connect()` returns after the handshake, clock sync and subscribing to every stream. With a USB cable the phone also has a `169.254.x.x` link-local address with lower latency (≈1.5 ms round trip instead of ≈8 ms); `imuninn list` shows both.

## Change parameters

```python
r = dev.set("imu.rate_hz", 200)         # returns ConfigResult
for f in r.fields:
    print(f.key, f.status, f.reason)    # applied / clamped / rejected
dev.set("rgb.exposure_mode", "locked")
dev.set("depth.enabled", True)          # restarts the capture session, about 1 s
dev.apply_profile("calibration")        # built-in YAML preset, one round trip
```

Parameters are self-describing: `dev.capabilities` lists every parameter of every stream with type, range, choices and whether it applies immediately or restarts the session. Rules in [Concepts](03-concepts.md).

## Receive data

```python
# iterator, one stream
for imu in dev.iter("imu"):
    print(imu.header.device_time_ns, imu.accel, imu.gyro)

# iterator, every stream: (stream, sample) tuples
for stream, sample in dev.iter():
    ...

# callbacks: run on the client thread, keep them short
dev.on("rgb", lambda frame: q.put(frame))
dev.on("*", lambda stream, sample: ...)
dev.on("__event__", print)              # "connected" / "config" / "lease" / "disconnected"
```

`dev.stats` has per-stream counts, drops (from `seq` gaps) and rates; `dev.health` is the phone's latest thermal / battery report.

## Time

Every sample carries `header.device_time_ns`, the phone's monotonic clock. `dev.to_pc_time(ns)` converts to PC wall-clock seconds using the offset measured at connect (≈1 ms error over USB, ≈4 ms over Wi‑Fi).

## The same from the command line

```bash
imuninn watch --start                   # print samples as text
imuninn rerun --start --depth           # visualise
imuninn record -o run1.mcap             # record
```

All commands: [CLI reference](07-cli.md).
