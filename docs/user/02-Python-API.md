# 02 · Python API：位姿 + IMU 实时流

M1 之后手机能把 ARKit 位姿和 CoreMotion IMU 实时发到 PC，PC 可以远程改手机参数。

## 跑起来（手机是服务端，PC 去连）

1. 手机：打开 iMuninn，App 自动发布 Bonjour 服务并监听；"服务"卡片里显示自己的地址（Wi‑Fi `en0`，插 USB 时还有一个 169.254.x.x 的 USB 直连地址）。
2. PC：`cd host/python && source .venv/bin/activate`
   - `imuninn list` 列出局域网 / USB 上的手机
   - `imuninn watch --start` 连第一台找到的手机并开始采集；也可 `imuninn watch iPhone` / `imuninn watch 10.0.0.5:7420`
3. 也可在手机上点"开始采集"。多台 PC 可同时连接。

USB 插着时 PC 会优先走 Wi‑Fi 地址，USB 直连地址排在后面；想强制走 USB 就把 169.254 地址传给 `connect()`。USB 直连往返约 1.5 ms，Wi‑Fi 约 8 ms。Debug 包还要连 Metro（见 dev/02）。

## Python API

```python
import imuninn

print(imuninn.discover())              # [Phone(name='iPhone', host='10.0.0.5', port=7420, ...)]

with imuninn.connect("iPhone") as dev: # 名字 / host / host:port / "" = 第一台找到的
    dev.set("imu.rate_hz", 50)         # 远程改参数；返回 ConfigResult
    dev.set("rgb.exposure_mode", "locked")
    dev.set("ar_pose.enabled", False)
    dev.start()                        # = SessionControl START

    for pose in dev.iter("ar_pose"):   # 迭代器；dev.iter() 不带参数则给 (stream, sample)
        t_pc = dev.to_pc_time(pose.header.device_time_ns)   # 对齐到 PC 时钟（秒）
        print(t_pc, pose.position, pose.orientation, pose.intrinsics.fx)

    dev.on("imu", lambda imu: ...)     # 回调方式（在客户端线程上执行，要快）
    print(dev.stats)                   # 每个流的计数、丢包、速率
```

参数 key 的规则：`session.mode`、`session.<参数>`、`<流>.enabled`、`<流>.<参数>`。可用参数看 `dev.capabilities`（每个带类型、范围、生效方式），当前有：

| key | 类型 | 生效 |
| --- | --- | --- |
| `imu.rate_hz` | int 10–200，步长 10 | 即时 |
| `ar_pose.video_format` | enum，如 `1920x1440@60` | 重启会话 |
| `rgb.exposure_mode` 等相机控制 | 见 03 | 即时 |
| `session.mode` | `ar` / `camera` | 重启会话 |
| `session.black_screen` | bool | 即时。手机 5 秒无操作后熄屏（纯黑 + 最低亮度），采集照常；点屏幕临时唤醒。和手机上的「黑屏模式」按钮是同一个开关，长时间推流省电、少发热 |

超出范围的值会被钳位（status = clamped），非法值被拒绝（rejected + reason）。

## 数据语义

- 位姿：ARKit 原生约定（右手系、Y 上、相机朝 -Z），世界原点是会话开始时相机位置。
- 内参随每帧位姿发送（`PoseSample.intrinsics`），分辨率是 ARKit 图像分辨率。
- IMU：`accel` 是重力 + 用户加速度（m/s²，设备坐标系），`gyro` 是 CoreMotion 偏置校正后的角速度（rad/s）。
- 时间戳：设备单调时钟（开机起算，纳秒），与 ARKit 帧同一时基。`s.to_pc_time()` 用握手时的 NTP 式估计转到 PC 墙钟。

## 实测（iPhone 17 Pro ↔ MacBook，Wi‑Fi）

- IMU 100 Hz、位姿 60 Hz，1000+ 样本零丢包
- 控制通道往返 7–10 ms
- 改 IMU 采样率即时生效；关/开位姿流即时生效
