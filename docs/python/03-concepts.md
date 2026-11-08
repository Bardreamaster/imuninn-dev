# 概念：流、参数、预设、租约、时间

## 流

| 流 id | 消息 | 传输 | 说明 |
| --- | --- | --- | --- |
| `ar_pose` | `PoseSample` | UDP | ARKit 位姿 + 内参 + 追踪状态，只在 AR 模式 |
| `imu` | `ImuSample` | UDP | 加速度（m/s²）+ 角速度（rad/s），设备坐标系 |
| `rgb` | `VideoFrame` | TCP | H.264 Annex‑B，每帧带内参与 `rotation_deg` |
| `depth` | `DepthFrame` | TCP | LiDAR 深度 256×192，毫米 + 置信度，LZ4 |
| `health` | `DeviceHealth` | UDP | 热状态、电量、手机端帧率、编码丢帧 |

UDP 允许丢、先到先用；TCP 不丢但手机拥塞时会丢非关键帧并请求新关键帧。订阅用 `dev.subscribe([...])`，默认全订。

## 会话模式

| | AR 模式（默认） | 纯相机模式 |
| --- | --- | --- |
| 位姿 / 深度 | 有 | 无 |
| 镜头 | 只有主摄 | 广角 / 超广角 / 长焦 / 前置 |
| 分辨率 | `ar_pose.video_format` | `rgb.camera_format`（随镜头变） |
| 切换 | `dev.set("session.mode", "ar")` | `dev.set("session.mode", "camera")` |

## 参数 key 与校验

`dev.set(key, value)` 的 key 四种：

| key | 含义 |
| --- | --- |
| `session.mode` | `ar` / `camera`，重启会话 |
| `session.<参数>` | 会话级开关，如 `session.black_screen`（手机 5 秒无操作后熄屏，采集照常） |
| `<流>.enabled` | 开关一个流 |
| `<流>.<参数>` | 如 `imu.rate_hz`、`rgb.exposure_mode`、`depth.rate_divisor` |

手机校验每个字段并在 `ConfigResult.fields` 里逐条回答：`applied`、`clamped`（超范围被钳到边界，`effective` 是实际值）、`rejected`（未知 key、类型错、不在枚举里，`reason` 说原因）。标为「重启会话」的参数（模式、镜头、分辨率、深度开关、深度平滑）生效时采集会中断约 1 秒；其余即时。

所有参数、范围和当前值都在 `dev.capabilities` 里，手机界面和 PC 端都从它生成，所以权威列表是手机返回的，不是文档。常用参数见[视频与相机](04-video-camera.md)、[深度与 MCAP](05-depth-mcap.md)，完整消息定义见[协议消息参考](../protocol/messages.md)。

多个 PC 改的是同一份配置：任何一方改了，所有人收到 `ConfigChanged`（`dev.config` 自动更新，`__event__` 回调收到 `"config"`），手机界面显示「xxx 控制中」。

## 配置预设（Profile）

一个 YAML 就是一份部分配置，一次 `SetConfig` 下发：

```yaml
name: calibration
mode: ar                          # ar | camera，可省略
session: {black_screen: true}     # 会话级开关，可省略
streams:
  imu:     {enabled: true, rate_hz: 200, raw: true}
  ar_pose: {enabled: true}
  rgb:     {enabled: true, bitrate_kbps: 8000, exposure_mode: locked, white_balance_mode: locked, focus_mode: locked}
  depth:   {enabled: true}
```

```bash
imuninn profile list                      # 内置：calibration / teleop / dataset / camera_wide
imuninn profile apply calibration         # 或 YAML 路径
imuninn profile save -o now.yaml          # 把手机当前配置存成 YAML
```

```python
dev.apply_profile("calibration")
dev.save_profile("now.yaml")
```

| 内置预设 | 用途 |
| --- | --- |
| `calibration` | 锁对焦 / 曝光 / 白平衡，IMU raw 200 Hz，深度开，码率 8 Mbps |
| `teleop` | 低延迟：码率 2 Mbps、关键帧间隔 15，深度关 |
| `dataset` | 全部流打开，码率 12 Mbps，深度平滑 |
| `camera_wide` | 纯相机模式广角，无位姿 |

手机上也能存预设（配置卡片下的「配置预设」），存在手机本地，与 PC 的 YAML 互不影响。IMU raw 模式下陀螺最高约 100 Hz，`rate_hz: 200` 会被硬件限制。

## 控制权租约

同一时刻只有一个 PC 能改参数：

- 第一个调用 `set()` 的客户端自动拿到租约；其他客户端的 `set()` 抛 `imuninn.LeaseError`。
- `dev.acquire_lease()` / `dev.release_lease()` 显式申请 / 释放；`dev.lease_holder` 看持有者。断线自动释放。
- 手机上点「接管」收回控制权，原持有者收到 `REVOKED`（`__event__` 回调里是 `"lease"`）。手机本机的改动不受租约限制。

## 健康状态

手机每 `health.rate_hz`（默认 0.2 Hz，最高 5 Hz）发一条 `DeviceHealth`：热状态（nominal / fair / serious / critical）、电量与充电、低电量模式、各流实际帧率、编码器丢帧、运行时长。可订阅、可录进 MCAP（`/health`）。

```python
dev.set("health.rate_hz", 1.0)
for h in dev.iter("health"):
    print(h.thermal, h.battery_level, h.video_fps)
```

长时间推流时打开 `session.black_screen`，屏幕功耗近零、发热更少。

## 数据语义

- 位姿：ARKit 原生约定（右手系、Y 上、相机朝 −Z），世界原点是会话开始时的相机位置；`intrinsics` 对应 ARKit 图像分辨率。
- IMU：`accel` 是重力 + 用户加速度，`gyro` 是 CoreMotion 偏置校正后的角速度；`imu.raw = true` 时给原始传感器值，各自时间戳。
- 图像与深度按传感器原始方向发送，`rotation_deg = 90`（顺时针转 90° 得到竖屏正向），内参是传感器方向下的；坐标系细节见[开发者 · 相机坐标系参考](../dev/06-camera-coordinates.md)。
- 时间戳：手机单调时钟（纳秒），各流同一时基；`dev.to_pc_time()` 转 PC 墙钟。
