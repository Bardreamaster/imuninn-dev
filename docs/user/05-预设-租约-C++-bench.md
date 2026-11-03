# 05 · 配置预设、控制权租约、C++ 客户端、性能测试

## 配置预设（Profile）

一个 YAML 文件就是一份完整或部分的配置，一次 `SetConfig` 下发：

```yaml
name: calibration
mode: ar                     # ar | camera，可省略
streams:
  imu:     {enabled: true, rate_hz: 200, raw: true}
  ar_pose: {enabled: true, exposure_locked: true, focus_locked: true}
  rgb:     {enabled: true, bitrate_kbps: 8000}
  depth:   {enabled: true}
```

```bash
imuninn profile list                      # 内置：calibration / teleop / dataset / camera_wide
imuninn profile apply calibration         # 推送到第一台手机；也可给 YAML 路径
imuninn profile save -o now.yaml          # 把手机当前配置存成 YAML
```

```python
dev.apply_profile("calibration")          # 或路径
dev.save_profile("now.yaml")
```

手机上也能存：配置卡片下面的"配置预设"，输入名字"保存当前"，点一下应用，长按删除。手机本地预设存在 `Documents/profiles/*.json`，和 PC 的 YAML 互不影响。

内置预设：

| 名称 | 用途 |
| --- | --- |
| `calibration` | 锁对焦 / 曝光，IMU raw 200 Hz，深度开，码率 8 Mbps |
| `teleop` | 低延迟：码率 2 Mbps、关键帧间隔 15，深度关 |
| `dataset` | 全部流打开，码率 12 Mbps，深度平滑 |
| `camera_wide` | 纯相机模式广角，无位姿 |

注：IMU raw 模式下 CoreMotion 陀螺最高约 100 Hz，`rate_hz: 200` 会被硬件限制。

## 健康状态流（`health`）

手机每 `health.rate_hz`（默认 0.2 Hz，可到 5 Hz）发一条 `DeviceHealth`：热状态（nominal / fair / serious / critical）、电量与充电状态、低电量模式、手机端各流实际帧率、编码器丢帧、运行时长。和其他流一样可订阅、可录进 MCAP（`/health`），Rerun 里在 `plots/health/*`。长时测试脚本 `tools/bench/longrun.py` 就是靠它画温度 / 帧率曲线。

```python
dev.set("health.rate_hz", 1.0)
for h in dev.iter("health"):
    print(h.thermal, h.battery_level, h.video_fps)
```

## 控制权租约

同一时刻只有一个 PC 能改参数，其余只读：

- 第一个调用 `set()` 的客户端自动拿到租约；其他客户端 `set()` 会抛 `imuninn.LeaseError`（"config lease held by pc-A"）。
- `dev.acquire_lease()` / `dev.release_lease()` 显式申请 / 释放；`dev.lease_holder` 看当前持有者。断线自动释放。
- 手机界面顶部显示"xxx 控制中 · 点此接管"，点一下手机收回控制权，原持有者收到 `REVOKED`（Python 里 `dev.on("__event__", ...)` 能收到 `"lease"` 事件）。
- 手机本机的改动不受租约限制。

## C++ 客户端（`host/cpp`）

无依赖（只需 protobuf）的接收库，给实时控制程序直接链接：

```bash
tools/gen-proto.sh                        # 生成 host/cpp/gen/
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

回调在接收线程上执行，要快。没有 Bonjour 发现，地址从 `imuninn list` 或手机屏幕上拿。

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
