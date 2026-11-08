# 快速开始

手机开着 iMuninn，PC 装好 `imuninn`（见[安装](01-install.md)），五行代码拿到位姿：

```python
import imuninn

with imuninn.connect() as dev:          # 第一台找到的手机；或 "iPhone" / "10.0.0.5" / "10.0.0.5:7420"
    dev.start()                         # 开始采集（也可以在手机上点）
    for pose in dev.iter("ar_pose"):    # 阻塞迭代；"imu" / "rgb" / "depth" / "health" 同理
        print(pose.position, pose.intrinsics.fx)
```

全部是同步调用，不需要懂 asyncio。

## 发现与连接

```python
for p in imuninn.discover():            # Bonjour，约 2 秒
    print(p.name, p.address, p.protocol_version)

dev = imuninn.connect("iPhone")         # 名字
dev = imuninn.connect("10.0.0.5:7420")  # 地址（企业 Wi‑Fi 屏蔽 mDNS 时）
dev.close()
```

`connect()` 做完握手、时钟同步、订阅全部流后返回。插着 USB 时手机还有一个 `169.254.x.x` 的直连地址，延迟更低（往返约 1.5 ms 对 8 ms），`imuninn list` 会一起列出来。

## 改参数

```python
r = dev.set("imu.rate_hz", 200)         # 返回 ConfigResult
for f in r.fields:
    print(f.key, f.status, f.reason)    # applied / clamped / rejected
dev.set("rgb.exposure_mode", "locked")
dev.set("depth.enabled", True)          # 重启采集会话，约 1 s
dev.apply_profile("calibration")        # 内置 YAML 预设，一次下发
```

参数是自描述的：`dev.capabilities` 列出每个流的每个参数，带类型、范围、可选值和「即时 / 重启会话」。完整规则见[概念](03-concepts.md)。

## 收数据

```python
# 迭代器：一个流
for imu in dev.iter("imu"):
    print(imu.header.device_time_ns, imu.accel, imu.gyro)

# 迭代器：所有流，(stream, sample) 元组
for stream, sample in dev.iter():
    ...

# 回调：在客户端线程上执行，要快
dev.on("rgb", lambda frame: q.put(frame))
dev.on("*", lambda stream, sample: ...)
dev.on("__event__", print)              # "connected" / "config" / "lease" / "disconnected"
```

`dev.stats` 给每个流的计数、按 `seq` 算的丢包和速率；`dev.health` 是手机最近一次的热状态 / 电量。

## 时间

每条样本的 `header.device_time_ns` 是手机单调时钟。`dev.to_pc_time(ns)` 用握手时 NTP 式测得的偏移转成 PC 墙钟（秒）；USB 下误差约 1 ms，Wi‑Fi 下约 4 ms。

## 命令行等价

```bash
imuninn watch --start                   # 同样的事，打印成文本
imuninn rerun --start --depth           # 可视化
imuninn record -o run1.mcap             # 录制
```

全部命令见 [CLI 参考](07-cli.md)。
