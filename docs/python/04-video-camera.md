# 视频与相机参数

H.264 视频实时发到 PC；纯相机模式可以换镜头、调曝光 / 白平衡 / 对焦等全部相机参数。

## 两种模式

| | AR 模式（默认） | 纯相机模式 |
| --- | --- | --- |
| 位姿 | 有（ARKit） | 无 |
| 镜头 | 只有主摄（广角） | 广角 / 超广角 / 长焦 / 前置 |
| 分辨率 | `ar_pose.video_format`（ARKit 提供的格式） | `rgb.camera_format`（随镜头变化） |
| 切换 | `dev.set("session.mode", "ar")` | `dev.set("session.mode", "camera")` |

切模式、换镜头、换分辨率都会重启采集会话（约 1 s 中断）。曝光锁、码率、关键帧间隔即时生效。

## 视频参数

| key | 类型 | 说明 |
| --- | --- | --- |
| `imu.raw` | bool | true = 原始加速度计 + 陀螺（未标定，各自时间戳）；false = CoreMotion 融合后的值 |
| `rgb.enabled` | bool | 视频流开关 |
| `rgb.lens` | `wide` / `ultra_wide` / `telephoto` / `front` | 仅相机模式有效 |
| `rgb.camera_format` | `WxH@fps` | 仅相机模式；可选值随镜头变，`MuninnCore.cameraFormats(lens)` / 能力描述里查 |
| `rgb.bitrate_kbps` | 500–20000 | H.264 码率 |
| `rgb.keyframe_interval` | 1–300 帧 | 关键帧间隔 |

## 相机控制参数（`rgb.*`，都即时生效）

| key | 取值 | 说明 |
| --- | --- | --- |
| `exposure_mode` | `auto` / `locked` / `manual` | manual 时用下面两项 |
| `iso` | 设备范围（iPhone 17 Pro 约 25–3000） | 手动 ISO |
| `exposure_ms` | 设备范围 | 手动快门，毫秒 |
| `exposure_bias` | 约 -8 … +8 EV | 曝光补偿，auto / locked 下也有效 |
| `white_balance_mode` | `auto` / `locked` / `manual` | **标定请锁定**，否则色温会漂 |
| `wb_temperature_k` | 2000–10000 K | 手动白平衡色温 |
| `wb_tint` | -150 … 150 | 手动白平衡色调 |
| `focus_mode` | `auto` / `locked` / `manual` | locked 固定当前对焦；AR 模式下 auto 以外会关掉 ARKit 自动对焦 |
| `lens_position` | 0（近）… 1（远） | 手动镜头位置 |
| `zoom` | 1 … 设备最大（≤10） | 仅纯相机模式；AR 模式 ARKit 锁定 1.0 |
| `torch` | bool | 手电筒，仅纯相机模式 |
| `hdr` | bool | 视频 HDR，仅纯相机模式且格式支持 |
| `low_light_boost` | bool | 低光增强，仅纯相机模式 |
| `stabilization` | `off` / `standard` / `cinematic` | 仅纯相机模式；**off 才能保证内参准确**（防抖会裁剪 / 变换画面） |

范围来自设备（能力描述里 `min` / `max`），超出会被钳位。 Android 上同一套参数映射到 Camera2（手动曝光 / 白平衡 / 手动对焦分别需要 `MANUAL_SENSOR`、`MANUAL_POST_PROCESSING`、可变焦镜头，缺失时自动退化为锁定 / 预设 / 自动，见[开发者 · Android](../dev/05-android.md)）。AR 模式下这些作用在 ARKit 正在用的相机设备上（iOS 16+），AVFoundation 不提供畸变系数，手动模式下的内参依旧由系统给出。

## 视频数据

- `VideoFrame.data` 是 Annex‑B 的 H.264 NAL，关键帧前带 SPS/PPS，可直接喂给任何解码器。
- `rotation_deg`：图像按传感器原始方向发送。所有 iPhone 镜头（含前置）都是 90（顺时针转 90° 得到竖屏正向）。内参是传感器方向下的。
- 每帧都带内参 `intrinsics`（相机模式由 AVCapture 的 intrinsic matrix 给，AR 模式由 ARKit 给）。
- 传输：TCP，`uint32 LE 长度 + DataMessage`。手机端拥塞时丢非关键帧并请求新的关键帧，PC 端解码器丢到下一个关键帧前的所有 P 帧。

PC 端解码：

```python
from imuninn.video import H264Decoder      # pip install 'imuninn[video]'
dec = H264Decoder()
for frame in dev.iter("rgb"):
    for img in dec.decode(frame):           # numpy (H, W, 3) RGB，已按 rotation_deg 转正
        ...
```

## Rerun 可视化

`imuninn rerun --start` 把视频、位姿、深度、IMU 一起画出来，见 [Rerun](06-rerun.md)。

## 本机录制

PC 端 `dev.start_recording()` / `dev.stop_recording()`（手机界面上没有对应按钮）。文件在手机 `Documents/recordings/<时间>.imuninn`（Finder → iPhone → 文件 → iMuninn 可以拷出来），格式是 `IMUNINN1` 魔数 + 连续的 `uint32 LE 长度 + DataMessage`，和 TCP 流一样；`imuninn convert x.imuninn` 转成 MCAP。通常直接在 PC 上 `imuninn record` 更方便。

## 实测（iPhone 17 Pro ↔ MacBook，Wi‑Fi）

- AR 模式 1920x1440@60：视频 59 fps，4 Mbps 码率下零丢帧；位姿 60 Hz、IMU 100 Hz 同时跑
- 相机模式 1920x1080@30：25–30 fps；三个后置镜头切换各约 2 s，fx 分别 ≈ 790 / 1280 / 5650（超广角 / 广角 / 长焦）
- PC 解码（PyAV，LGPL 构建）跟得上 60 fps
