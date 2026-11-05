# 05 · Android（M5）

Android 端是 iOS 端的移植（`docs/design/iMuninn-设计文档.md` §5.2），代码在
`mobile/modules/muninn-core/android/`，结构与 `ios/Core/` 一一对应。本页记录环境、
构建、模拟器测试方法，以及当前实现到哪一步。

## 模拟器实测（2026-11-05）

Pixel 7 AVD（`system-images;android-36;google_apis;arm64-v8a`，Android 16）、虚拟场景相机，PC 经 `adb forward` 连 `127.0.0.1`。截图 `docs/design/m5-emulator.png`。

| 项目 | 结果 |
| --- | --- |
| 握手 | `platform=ANDROID`，流 `imu / ar_pose / rgb / health`，镜头 `wide, front`，格式 `640x480@30, 1280x720@30, 1280x960@30` |
| IMU | 100 Hz（`imu.rate_hz` 改 57 → 夹到 60，改回 100 生效；raw 模式可用） |
| 视频 | 640x480@30 → `c2.android.avc.encoder`，30 fps、4 Mbps，`imuninn rerun --video decode` PyAV 解码正常；切 `front` 镜头会重启会话并恢复 |
| health | 每 5 s 一条（thermal nominal、电池 100% 未充电、uptime） |
| 多客户端 | 两个 PC 同时各收 100 Hz / 30 fps；一个断开另一个不受影响 |
| 租约 | 第二个客户端 `SetConfig` → 409 `LeaseError`；`acquire` 被拒；持有者 release 后可获得；断开自动释放 |
| 配置校验 | 未知参数、`session.mode=ar`、非法 enum 都被拒并给出原因；`rgb.lens` 改动 `session_restarted=true` |
| PC Profile | `imuninn profile apply teleop / camera_wide` 生效（`depth` 流在 Android 不存在 → rejected，符合预期） |
| 录制 | PC `imuninn record` 9 s → MCAP 1031 条（imu 800、rgb 228、health 2）；手机端 `START_RECORDING` 生成 `files/recordings/*.imuninn`，`imuninn convert` 后 270 条 |
| 手机 UI | 预览、5 Hz 状态（IMU 99.3 Hz、30 fps、4.1 Mbps）、客户端列表、配置控件 |

注意：模拟器 `SENSOR_INFO_TIMESTAMP_SOURCE` 是 UNKNOWN，日志有告警；时钟同步 rtt 1–4 ms（adb 转发）。应用冷启动后 JS 约 20 s 才调用 `startServer`，这之前连不上。

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

Expo 58 还要 NDK 和 CMake（expo-modules-core 编 C++）：

```bash
sdkmanager --sdk_root="$ANDROID_HOME" "ndk;27.1.12297006" "cmake;3.22.1"
```

本机（LM007833，2026-11-05）实际装的是：Homebrew `openjdk@17`（`JAVA_HOME=/opt/homebrew/opt/openjdk@17`，没用 cask 免 sudo）、`platforms;android-37.0`、`build-tools;37.0.0`、`platform-tools`、`emulator`、AVD 名 `imuninn`。Gradle 9.4.1 wrapper 下载常超时，可手动 `curl` 到 `~/.gradle/wrapper/dists/gradle-9.4.1-bin/<hash>/` 解压并 `touch gradle-9.4.1-bin.zip.ok`。

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
