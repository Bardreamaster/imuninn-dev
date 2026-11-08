# C++ 客户端

无依赖（只需 protobuf）的接收库，给实时控制程序直接链接。收到的消息和 Python 完全相同；配置 key、预设、租约规则见 [Python · 概念](../python/03-concepts.md)。

## 构建与运行（`host/cpp`）

```bash
tools/gen-proto.sh                        # 生成 host/cpp/gen/（需要 protoc）
cd host/cpp && cmake -S . -B build -DCMAKE_PREFIX_PATH=/opt/homebrew && cmake --build build
./build/imuninn_watch 10.0.0.23 5         # 连接、设参数、收 5 秒、打印速率
```

```cpp
#include "imuninn/client.hpp"
imuninn::Client client("10.0.0.23");
client.on_pose([](const imuninn::pb::PoseSample& p) { /* 60 Hz */ });
client.connect();                          // Hello/Welcome、TCP 数据流、时钟同步、订阅全部
client.set("imu.rate_hz", int64_t(100));
client.start();
```

回调在接收线程上执行，要快。`client.set("session.black_screen", true)` 等会话级开关和 Python 用同样的 key。没有 Bonjour 发现，地址从 `imuninn list` 或手机屏幕上拿。

## 性能测试（`tools/bench/latency.py`）

```bash
host/python/.venv/bin/python tools/bench/latency.py --seconds 10 --depth --json bench.json
```

输出每个流的速率、丢包、带宽和"手机采集 → Python 拿到"的单向延迟分布（含时钟偏移误差 ≈ RTT/2）。

实测 iPhone 17 Pro，USB 直连，静止场景：

| 流 | 速率 | 丢包 | 延迟中位数 | p99 |
| --- | --- | --- | --- | --- |
| imu | 100 Hz | 0 | 2.6 ms | 8 ms |
| ar_pose | 60 Hz | 0 | 39 ms | 43 ms |
| rgb (1920×1440 H.264) | 60 fps | 0 | 49 ms | 56 ms |
| depth (256×192 LZ4) | 60 Hz | 0 | 44 ms | 52 ms |

控制通道往返 1.05 ms。位姿的 ~39 ms 主要是 ARKit 自身的处理管线（帧时间戳是曝光时刻，位姿在两帧之后才给出），不是网络；视频比位姿多的 ~10 ms 是硬件编码。
