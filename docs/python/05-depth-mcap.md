# 深度与 MCAP

Pro 机型发 LiDAR 深度；PC 端把所有流原样录成 MCAP，可回放、可转换。

## 深度流

只在 AR 模式下可用（ARKit 的 `sceneDepth`），默认关闭：

```python
dev.set("depth.enabled", True)       # 重启采集会话（约 1 s）
for f in dev.iter("depth"):
    depth_mm, conf = imuninn.depth.decode(f)     # uint16 (H, W) 毫米，0 = 无效；uint8 置信度 0/1/2
    metres = imuninn.depth.to_metres(depth_mm)   # float32 米，无效处为 NaN
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `depth.enabled` | bool | 开关（重启会话） |
| `depth.smoothed` | bool | 用 ARKit 时域平滑后的深度（重启会话） |
| `depth.compression` | `lz4` / `none` | LZ4 无损（Apple Compression 分块格式，PC 端自动解） |
| `depth.rate_divisor` | 1–6 | 每 N 帧发一帧 |

数据语义：
- 分辨率 256×192（ARKit 固定），`intrinsics` 已按比例缩放到这个分辨率；方向与 RGB 相同（`rotation_deg` = 90），和同一时间戳的 `ar_pose` / `rgb` 帧对应。
- 深度是沿光轴的距离（ARKit 定义），单位毫米；置信度 0 低、1 中、2 高。
- 实测 iPhone 17 Pro：60 Hz，LZ4 后约 54 KB/帧（原始 96 KB + 48 KB 置信度）。

## MCAP

```bash
imuninn record --start -o run1.mcap            # 录所有订阅的流，Ctrl-C 停
imuninn record --start --depth --streams ar_pose,depth -o d.mcap
imuninn info run1.mcap                          # 每个 topic 的消息数
imuninn rerun --mcap run1.mcap                  # 回放到 Rerun
imuninn convert 20261103-153000.imuninn         # 手机本机录制 → MCAP
```

文件内容就是协议消息本身（protobuf schema 写在文件里，任何支持 MCAP + Protobuf 的工具都能读）：

| topic | 消息 | 备注 |
| --- | --- | --- |
| `/device` `/capabilities` | DeviceInfo / Capabilities | 文件头各一条 |
| `/config` | ConfigChanged | 开始时一条，之后每次参数变化一条；每条数据的 `header.config_version` 可对回去 |
| `/imu` `/ar_pose` `/rgb` `/depth` | ImuSample / PoseSample / VideoFrame / DepthFrame | `publish_time` = 设备时钟，`log_time` = PC 墙钟（设备时间 + 握手时的偏移） |

Python 里回放：

```python
from imuninn.mcap_io import replay
for stream, sample in replay("run1.mcap", realtime=False):
    ...
```

手机本机录制（`.imuninn`）没有 PC 时钟，转换后 `log_time` = 设备时钟。
