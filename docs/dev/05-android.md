# 05 · Android（M5）

Android 端是 iOS 端的移植（[设计文档](../design/design-doc.md) §5.2），代码在
`mobile/modules/muninn-core/android/`，结构与 `ios/Core/` 一一对应。本页记录实现到哪一步、
真机测试步骤、环境、构建和模拟器测试方法。

## 实现状态（2026-11-21）

功能与 iOS 对齐。相机模式、音频、界面在模拟器上验证过；**ARCore 的位姿 / 视频 / 深度还没有在真机上跑过**（模拟器不支持 ARCore），真机步骤见下一节。

| 部分 | Android 实现 | 验证 |
| --- | --- | --- |
| 控制通道：NSD（Bonjour）发布、WebSocket、Hello/Welcome、能力描述、配置、订阅、时钟同步、租约 | `ControlServer.kt` / `SessionManager.kt`（Java-WebSocket + NsdManager） | 模拟器 ✅（NSD 发现要真机） |
| 数据通道：TCP（视频/深度/音频）、UDP（位姿/IMU/health）、浏览器用的 WebSocket 数据通道（v5） | `DataServer.kt` / `TcpSink.kt` / `UdpSink.kt` / `WsSink.kt` | 模拟器 ✅ |
| 端口被占时换空闲端口（控制口经 NSD、数据口经 `Welcome.tcp_port` 告知客户端） | `ControlServer.listen` / `DataServer.start` | 模拟器 ✅（控制口） |
| 前后台：Activity 不可见时停采集并释放端口，回到前台重建监听和采集 | `SessionManager.enterBackground / enterForeground`（`onStop` / `onStart`，权限弹窗不算后台） | 模拟器 ✅ |
| IMU：SensorManager，校准 / raw 两种 | `ImuSource.kt` | 模拟器 ✅ |
| 相机模式视频：Camera2 → MediaCodec H.264（Surface 输入，零拷贝）→ Annex-B；镜头、格式、`rgb.*` 相机控制 | `CameraSource.kt` / `CameraControl.kt` / `VideoEncoder.kt` | 模拟器 ✅ |
| **AR 位姿 + 视频**：ARCore `Camera.getPose()`，相机纹理经 GL 画进编码器和预览 | `ArSource.kt` | ⏳ 真机 |
| **深度**：ARCore Depth API（uint16 mm，Apple LZ4 分帧，PC 端解码不变） | `ArSource.depth` / `DepthPacker.kt` | ⏳ 真机 |
| **音频**（v6）：AudioRecord，s16 / f32，采样率、分块、raw / voice 处理 | `AudioSource.kt` | 模拟器 ✅（50 块/s，时间戳与 IMU 同一时钟） |
| 会话参数 `session.black_screen`、黑屏模式（亮度、触摸唤醒） | `ConfigStore.kt` / `MuninnCoreModule.kt` | 模拟器 ✅ |
| 偏好设置（语言、外观、Bonjour 名称、当前预设）、安全区、系统语言 | `MuninnCoreModule.kt`（SharedPreferences、WindowInsets） | 模拟器 ✅ |
| 本地录制 `.imuninn`、Profile JSON、健康上报 | `FileSink.kt` / `ProfileStore.kt` / `SessionManager.publishHealth` | 模拟器 ✅ |
| 预览：完整画面等比缩放加黑边，跟随屏幕旋转，全屏 | `MuninnPreviewView.kt`（TextureView） | 模拟器 ✅（相机模式），AR 模式 ⏳ 真机 |
| 图标 | `src/ui/Icon.android.tsx`（与 SF Symbols 同名的线条图标，react-native-svg） | 模拟器 ✅ |

### ARCore 部分的做法（`ArSource.kt`）

- ARCore 独占相机，每帧把画面写进一张外部（OES）纹理。`ArSource` 自己有一条 GL 线程和 EGL 上下文，在上面跑 `session.update()`（`UpdateMode.BLOCKING`，每个相机帧返回一次），再把纹理画进编码器的输入 Surface 和预览 Surface，像素不离开 GPU。没有人订阅 `rgb` 时不往编码器画。
- 位姿取 `Camera.getPose()`：相对图像读出方向（传感器横向）的 +X 右、+Y 上、−Z 前，世界 Y 轴朝上，与 ARKit 的 `camera.transform` 约定相同。
- 视频帧是传感器原生横向画面，`rotation_deg` 取 ARCore 所用相机的 `SENSOR_ORIENTATION`。内参用 `Camera.getTextureIntrinsics()`（就是发出去的那张图的内参）。
- `ar_pose.video_format` 的选项来自 `getSupportedCameraConfigs`（后摄，30 / 60 fps），id 是 GPU 纹理尺寸 `WxH@fps`；ARCore 默认配置排第一。
- 深度：`depth.smoothed=true`（Android 上的默认值）取 `acquireDepthImage16Bits()`，是补全并时域滤波过的图，没有置信度；`false` 取 `acquireRawDepthImage16Bits()` + 置信度图（0–255 映射成协议的 0 / 1 / 2）。深度图覆盖 CPU 图像的视场，内参用 `getImageIntrinsics()` 按尺寸缩放。深度来自运动估计（有 ToF 的机型会用上），启动后要移动手机一两秒才有第一帧，量程和精度低于 LiDAR；`DeviceInfo.has_lidar` 保持 false。
- AR 模式下 `rgb.*` 相机控制只有对焦（`auto` → 自动，其余 → 固定）和手电生效，其余由 ARCore 管。
- 启动时探测一次（`ArSource.probe`）：ARCore 已安装才提供 AR 模式；手机支持但没装 / 版本太旧时弹安装提示，装完重开 App。

## 真机测试（Pixel 9a）

准备：手机开「开发者选项 → USB 调试」，USB 连上 Mac 后在手机上点允许。手机和 Mac 连同一个 Wi-Fi。

安装（Release 包，JS 已打进 APK，不需要 Metro）：

```bash
cd mobile && npx expo prebuild -p android
```

```bash
cd mobile/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```

```bash
adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
```

抓日志（另开一个终端，出问题时把输出发回来）：

```bash
adb logcat -s imuninn:V AndroidRuntime:E
```

逐项检查，PC 端命令都在 `host/python` 下用 `.venv/bin/imuninn`：

| # | 做什么 | 期望 |
| --- | --- | --- |
| 1 | 打开 App，允许相机权限 | 预览正向、完整不变形；会话模式默认 `ar`；日志有 `arcore ready: formats [...] depth true` |
| 2 | `imuninn list` | 发现手机（NSD），地址是手机的 Wi-Fi IP |
| 3 | `imuninn watch <IP> --start`，拿着手机走动 | `ar_pose` 约 30 Hz、tracking `normal`；`imu` 100 Hz；`rgb` 30 fps |
| 4 | `imuninn rerun <IP> --start` | 画面正向（`rotation_deg` 正确）；轨迹与手的运动方向一致：向前走轨迹沿相机朝向延伸，举高 Y 增大 |
| 5 | App 配置里打开 `depth`，移动手机 | 一两秒后「深度」有帧率；Rerun 里深度图与彩色画面对得上，近处暖色远处冷色不反 |
| 6 | 打开 `audio`，允许麦克风，对着手机说话 | 「音频」约 50 Hz；`imuninn rerun` 里音量曲线随声音变化（或 `imuninn record --audio` 后 `imuninn export-audio` 导出 WAV 听） |
| 7 | 把会话模式切到 `camera`，换镜头（`ultra_wide` / `front`）和格式 | 预览和 PC 画面跟着变；手动曝光 / 白平衡 / 对焦 / 变焦 / 手电有效果 |
| 8 | 横屏、反向横屏、全屏预览 | 预览始终正向 |
| 9 | 黑屏按钮，等 5 秒；点屏幕 | 屏幕全黑且最暗，PC 端数据不断；点一下恢复 |
| 10 | 按 Home 再回来 | PC 端断开后能重新连接，采集恢复 |
| 11 | 浏览器打开网页查看器，填手机 IP | 画面、位姿、IMU 正常（WebSocket 数据通道） |

第 4、5 项是这次真机测试的重点：位姿坐标系、画面方向、深度方向都是按 ARCore 文档写的，没有实测过。

## 模拟器实测

2026-11-21（Pixel 7 AVD，Android 16，`adb forward`）：视频 640x480@30、IMU 100–115 Hz、音频 16 kHz s16 20 ms 分块 50 块/s（时间戳与 IMU 相差 15–30 ms）、health；同样的流走 WebSocket 数据通道正常；PC 远程打开 `audio` 时手机弹麦克风授权且连接不断；`session.black_screen` 远程开关，5 秒后全黑，期间采集不中断；竖屏 / 两个横屏方向 / 全屏预览方向正确；Home 后返回监听重建；7420 被占时日志 `control port 7420 in use; using a free port` 并正常发布。

模拟器开了麦克风后宿主机音频会让无窗口的模拟器卡死，测音频时加 `-no-audio`（录到的是静音，但通路是通的）。

2026-11-05（同一 AVD）。截图 `docs/design/m5-emulator.png`。

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

## 相机控制参数在 Android 上的映射（`CameraControl.kt`）

参数名、取值、范围语义与 iOS 完全一致（[Python · 视频与相机参数](../python/04-video-camera.md)），范围从主摄的 `CameraCharacteristics` 探测。能力不足时**不报错**，退而求其次并在日志里提示一次：

| 参数 | Camera2 | 需要的能力 / 回退 |
| --- | --- | --- |
| `exposure_mode` auto / locked / manual | `CONTROL_AE_MODE` + `CONTROL_AE_LOCK`；manual = `AE_MODE_OFF` + `SENSOR_SENSITIVITY` + `SENSOR_EXPOSURE_TIME` | `MANUAL_SENSOR`；没有则按 locked 处理 |
| `exposure_bias` | `CONTROL_AE_EXPOSURE_COMPENSATION`（按 `AE_COMPENSATION_STEP` 取整） | 范围来自设备（模拟器 ±3 EV） |
| `white_balance_mode` manual | `AWB_MODE_OFF` + `COLOR_CORRECTION_GAINS`（色温→RGGB 增益，tint 调绿通道） | `MANUAL_POST_PROCESSING`；没有则选最接近色温的 AWB 预设（白炽/荧光/日光/阴天/阴影） |
| `focus_mode` locked | `AF_MODE_OFF` + 最近一次 `CaptureResult.LENS_FOCUS_DISTANCE` | 固定对焦机型保持自动 |
| `focus_mode` manual + `lens_position` | `AF_MODE_OFF` + `LENS_FOCUS_DISTANCE = (1 − pos) × 最近对焦屈光度`（0 近 … 1 远，同 iOS） | `LENS_INFO_MINIMUM_FOCUS_DISTANCE > 0` |
| `zoom` | API 30+ `CONTROL_ZOOM_RATIO`，否则 `SCALER_CROP_REGION` | 上限 `CONTROL_ZOOM_RATIO_RANGE`（≤10） |
| `torch` | `FLASH_MODE_TORCH` | `FLASH_INFO_AVAILABLE` |
| `hdr` | `CONTROL_SCENE_MODE_HDR` | 场景模式列表里有 HDR |
| `low_light_boost` | API 35 `AE_MODE_ON_LOW_LIGHT_BOOST_BRIGHTNESS_PRIORITY` | 列表里有该 AE 模式 |
| `stabilization` | `CONTROL_VIDEO_STABILIZATION_MODE`（cinematic = API 33 PREVIEW_STABILIZATION）+ OIS 开关 | off 同时关 OIS，保证内参 |

模拟器实测（2026-11-05）：14 个参数全部 applied / 正确 clamped（`zoom` 上限 1）/ 非法枚举 rejected，改动期间视频和 IMU 不断流；HAL 没有 `MANUAL_SENSOR`、`MANUAL_POST_PROCESSING`，所以手动曝光退化为锁定、手动白平衡退化为预设（日志各提示一次）。真机效果待验证。

## 与 iOS 的差异

- **时间基**：所有样本用 `SystemClock.elapsedRealtimeNanos()`（CLOCK_BOOTTIME）。IMU 的 `SensorEvent.timestamp`、音频的 `AudioTimestamp(TIMEBASE_BOOTTIME)` 就是这个时基。相机帧的时间戳有的机型是 CLOCK_MONOTONIC（不含休眠时间），`cameraTimeToDeviceNs` 按哪个时基离当前更近来判断并换算到 CLOCK_BOOTTIME。
- **内参**：Camera2 极少给 `LENS_INTRINSIC_CALIBRATION`；没有时用 焦距 / 传感器物理宽度 × 图像宽度 推 fx，主点取图像中心。精度够可视化，不够标定。
- **关键帧间隔**：MediaCodec 的 `KEY_I_FRAME_INTERVAL` 只能在配置时设，所以 `keyframe_interval` 由我们按帧计数主动 `REQUEST_SYNC_FRAME` 实现，可以运行中改。
- **图像方向**：`rotation_deg` 直接取 `SENSOR_ORIENTATION`（后摄通常 90，前摄 270），与 iOS 语义相同。
- **权限**：相机和麦克风是运行时权限，由 `SessionManager` 在要用到时请求（PC 远程开始采集或打开 `audio` 也会弹）；拒绝后不会反复弹，下次手动点开始再问。
- **预览与采集会话**：Camera2 的预览 Surface 是采集会话的输出之一，增删它（进出全屏、关预览）要重建会话，相机模式的视频会断一下再来一个关键帧；IMU 和音频不受影响。所以黑屏模式下 Android 不卸载预览，只盖一层黑。AR 模式换预览不影响采集。
- **后台**：以 Activity `onStop` / `onStart` 为准，与 iOS 一样后台不采集并释放端口。
- **黑屏亮度**：`setScreenBrightness` 写窗口的 `screenBrightness`，负值表示交还给系统；`uiInfo().brightness` 在跟随系统时返回 -1。
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

- ARCore 位姿、深度、AR 模式预览：Apple Silicon 上的 arm64 镜像不支持 ARCore；见「真机测试」。
- 真实的相机内参、时间戳源、热节流：模拟器的数值是假的。
- NSD 发现：要在真机 + 同一 Wi-Fi 下测 `imuninn list`。
