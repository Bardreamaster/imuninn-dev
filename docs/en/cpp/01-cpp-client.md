# C++ client

A dependency-free receiver library (protobuf only) that real-time control programs link directly. It receives exactly the same messages as Python; configuration keys, profiles and the lease rules are described in [Python · Concepts](../python/03-concepts.md).

## Build and run (`host/cpp`)

```bash
tools/gen-proto.sh                        # generates host/cpp/gen/ (needs protoc)
cd host/cpp && cmake -S . -B build -DCMAKE_PREFIX_PATH=/opt/homebrew && cmake --build build
./build/imuninn_watch 10.0.0.23 5         # connect, set parameters, receive for 5 s, print rates
```

```cpp
#include "imuninn/client.hpp"
imuninn::Client client("10.0.0.23");
client.on_pose([](const imuninn::pb::PoseSample& p) { /* 60 Hz */ });
client.connect();                          // Hello / Welcome, TCP data stream, clock sync, subscribe to all
client.set("imu.rate_hz", int64_t(100));
client.start();
```

Callbacks run on the receive thread, so keep them short. Session-level switches such as `client.set("session.black_screen", true)` use the same keys as Python. There is no Bonjour discovery; get the address from `imuninn list` or the phone's screen.

## Latency benchmark (`tools/bench/latency.py`)

```bash
host/python/.venv/bin/python tools/bench/latency.py --seconds 10 --depth --json bench.json
```

Prints per-stream rate, drops, bandwidth and the one-way latency distribution from phone capture to Python (including clock-offset error ≈ RTT/2).

Measured on iPhone 17 Pro over USB, static scene:

| stream | rate | drops | median latency | p99 |
| --- | --- | --- | --- | --- |
| imu | 100 Hz | 0 | 2.6 ms | 8 ms |
| ar_pose | 60 Hz | 0 | 39 ms | 43 ms |
| rgb (1920×1440 H.264) | 60 fps | 0 | 49 ms | 56 ms |
| depth (256×192 LZ4) | 60 Hz | 0 | 44 ms | 52 ms |

The control round trip is 1.05 ms. Most of the ~39 ms for pose is ARKit's own pipeline (frame timestamps are exposure times and the pose arrives two frames later), not the network; video's extra ~10 ms over pose is hardware encoding.
