# 05 · Android（M5）

Android 端是 iOS 端的移植（`docs/design/iMuninn-设计文档.md` §5.2），代码在
`mobile/modules/muninn-core/android/`，结构与 `ios/Core/` 一一对应。本页记录环境、
构建、模拟器测试方法，以及当前实现到哪一步。

## 实现状态（2026-11-03）

| 部分 | Android 实现 | 模拟器能否验证 |
| --- | --- | --- |
| 控制通道：NSD（Bonjour）发布、WebSocket、Hello/Welcome、能力描述、配置、订阅、时钟同步、租约 | `ControlServer.kt` / `SessionManager.kt`（Java-WebSocket + NsdManager） | ✅（NSD 发现除外，见下） |
| 数据 TCP：client_id 握手、长度前缀帧、拥塞只留最新帧 | `DataServer.kt` / `TcpSink.kt` | ✅ |
| UDP：IMU、health | `UdpSink.kt` | ✅（有 10.0.2.2 回环处理） |
| IMU：SensorManager，校准 / raw 两种 | `ImuSource.kt` | ✅（模拟器虚拟传感器，可在 Extended Controls 里摆姿态） |
| 视频：Camera2 → MediaCodec H.264（Surface 输入，零拷贝）→ Annex-B | `CameraSource.kt` / `VideoEncoder.kt` | ✅（模拟器虚拟场景相机 + 软件编码器） |
| 相机模式：镜头、格式、曝光锁、对焦锁 | `CameraSource.kt` | ✅（模拟器只有一前一后两个镜头） |
| 本地录制 `.imuninn`、Profile JSON | `FileSink.kt` / `ProfileStore.kt` | ✅ |
| 健康上报：thermal / battery / 低电量 | `SessionManager.publishHealth` | ✅（数值是模拟器编的） |
| **AR 位姿（ARCore）** | ❌ 仅可用性检测（`ArSource.kt` 顶部注释写了要做的事） | ❌ Apple Silicon 上只有 arm64 镜像，ARCore 不支持 |
| **深度** | ❌ | ❌ |
| 预览 | `MuninnPreviewView.kt`（TextureView） | ✅ |

因此 Android 当前只有**相机模式**；`DeviceInfo.arSupported` 恒为 false，`session.mode` 设成 `ar` 会被拒绝。

## 与 iOS 的差异

- **时间基**：所有样本用 `SystemClock.elapsedRealtimeNanos()`（CLOCK_BOOTTIME）。IMU 的 `SensorEvent.timestamp` 就是这个时基；相机帧只有当 `SENSOR_INFO_TIMESTAMP_SOURCE == REALTIME` 时才一致，否则日志里会有一条警告，PC 端对齐视频与 IMU 时要自己估偏移（§5.2）。
- **内参**：Camera2 极少给 `LENS_INTRINSIC_CALIBRATION`；没有时用 焦距 / 传感器物理宽度 × 图像宽度 推 fx，主点取图像中心。精度够可视化，不够标定。
- **关键帧间隔**：MediaCodec 的 `KEY_I_FRAME_INTERVAL` 只能在配置时设，所以 `keyframe_interval` 由我们按帧计数主动 `REQUEST_SYNC_FRAME` 实现，可以运行中改。
- **图像方向**：`rotation_deg` 直接取 `SENSOR_ORIENTATION`（后摄通常 90，前摄 270），与 iOS 语义相同。
- **相机权限**：Android 是运行时权限，`setPreview(true)` / `startSession()` 在原生层先弹授权，JS 不用改。
- **mDNS**：真机上 NsdManager 发布 `_imuninn._tcp`；模拟器在 NAT 后面，PC 发现不了，只能用 `adb forward` + 直连地址。
- **模拟器 UDP 回环**：PC 经 `adb forward` 连进来时，手机看到的对端是 127.0.0.1，UDP 发过去出不了模拟器。`NetInfo.udpTarget` 在模拟器上把回环改成 `10.0.2.2`（宿主机），所以位姿/IMU/health 能到同一台 Mac 上的 PC 端。

## 环境（macOS）

一次性安装（约 4–5 GB 下载）：

```bash
brew install --cask temurin@17            # JDK 17（RN 0.88 / AGP 要求）
brew install --cask android-commandlinetools
```

把下面加进 `~/.zshrc`：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

装 SDK 组件和一个 arm64 模拟器镜像（Apple Silicon 只能跑 arm64）：

```bash
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-37" "build-tools;37.0.0" "emulator" "system-images;android-36;google_apis;arm64-v8a"
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
avdmanager create avd -n imuninn -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
```

（版本号以 `npx expo run:android` 实际要求为准；它会报出需要的 compileSdk / build-tools。）

## 构建与运行（模拟器）

```bash
emulator -avd imuninn -camera-back virtualscene -camera-front emulated &
cd mobile && npx expo run:android          # 自动 prebuild → gradle → 安装 → Metro
```

PC 端连接（模拟器没有 Bonjour，走端口转发）：

```bash
adb forward tcp:7420 tcp:7420
adb forward tcp:7422 tcp:7422
cd host/python && .venv/bin/imuninn watch 127.0.0.1 --start
```

能看到的：Welcome 里 `platform=ANDROID`、流列表 `imu / rgb / health`，`watch` 打印 IMU 100 Hz、视频 30 fps（虚拟场景），`imuninn rerun 127.0.0.1 --start` 能显示画面。在模拟器 Extended Controls → Virtual sensors 里转动手机，IMU 数值会变。

改 Kotlin 后重新 `npx expo run:android`；只改 TS 用 Metro 热更新即可。

## 模拟器测不了的

- ARCore 位姿、深度：没有 arm64 模拟器镜像支持；等真机。
- 真实的相机内参、时间戳源、热节流：模拟器的数值是假的。
- NSD 发现：要在真机 + 同一 Wi-Fi 下测 `imuninn list`。

## 接 ARCore 时要做的

见 `ArSource.kt` 顶部注释：ARCore `Session` + GL 纹理 + `update()` 循环出位姿与内参；RGB 用 `SharedCamera` 把编码器 Surface 加为第二个目标（零拷贝，与 `CameraSource` 一致）；深度 `acquireDepthImage16Bits()` 直接就是协议要的 uint16 mm。做完后把 `ArSource.supported()` 改为真正的可用性检测，`ConfigStore` 的 `ar_pose` / `depth` 流会自动出现。
