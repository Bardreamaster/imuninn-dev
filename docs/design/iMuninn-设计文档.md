# iMuninn 设计文档

Nov 2, 2026 · @Jinqi

## 1. 概述

iMuninn 把手机变成便携的多模态传感器节点：相机、IMU、ARKit/ARCore 位姿和 LiDAR 深度实时传到 PC，再通过 Python、C++ 和 Web 接口交给机器人程序、算法与数据采集流程。

**命名**：Muninn 是北欧神话中奥丁的乌鸦，每天飞遍世界、晚上回来报告所见。手机就是那只飞出去、再把所见带回来的乌鸦。“i” 前缀不代表只支持 iOS；包名、命令行和仓库名统一小写 `imuninn`。

**目标**

- 低延迟实时传输位姿、IMU、视频和深度，所有数据带统一时间戳
- 一套协议，PC 端可用 Python、C++、Web 多种方式接入
- 可录制、可回放，能直接作为研究数据集
- 一到两人可长期维护：UI 只写一次，原生代码只写数据链路
- 全部代码开源，且允许商用

**非目标**

- 不做云端或公网中转，只支持局域网和 USB
- 不在手机端做重型算法，位姿直接使用系统的 ARKit / ARCore
- 不支持 Expo Go，只用 development build

**开发顺序**：先 iOS（ARKit + LiDAR 数据质量稳定、机型少），协议和 PC 端跑通后再移植 Android。

## 2. 系统架构总览

iMuninn 分三层：手机原生核心负责采集和发送（手机是服务端），Protobuf 协议是唯一的数据通道，PC 客户端解码后交给各种出口。

&#91;embedded content: iMuninn 系统架构 · 手机、协议、PC 网关三层\]

手机端 JS 只收发控制命令和节流后的状态；数据从原生核心经协议直达 PC 客户端。Rerun、MCAP 和各语言接口都是客户端上可替换的出口，ROS 2 桥接按需加在同一层。多台 PC 可各自直接连手机；若要省手机上行带宽，再在 PC 上写一个接收并分发的中继客户端（暂不做）。

## 3. 仓库结构

协议、手机端、PC 端放在同一个 monorepo 里，改协议时三端在同一个 commit 中同步更新。

```
imuninn/
├── protocol/                 # .proto 定义 + 协议规范文档 + 版本号（唯一真相源）
├── mobile/                   # Expo App
│   ├── app/                  # 页面（TypeScript，iOS / Android 共享）
│   ├── modules/
│   │   └── muninn-core/      # 本地 Expo 原生模块
│   │       ├── ios/          # Swift：采集、编码、网络、AR 预览视图
│   │       ├── android/      # Kotlin：同上
│   │       └── src/          # TS 绑定与类型
│   ├── plugins/              # Config Plugin：Info.plist、权限、Bonjour
│   └── app.config.ts
├── host/
│   ├── python/               # pip 包 imuninn：接收、解码、回调 / 迭代器 API
│   ├── cpp/                  # C++ 接收库
│   └── bridges/              # Rerun、ROS 2 等可选出口
├── tools/bench/              # 延迟、丢包、带宽测试
└── docs/
```

| 目录 | 职责 | 备注 |
| --- | --- | --- |
| `protocol/` | 所有消息的 schema，生成 Swift / Kotlin / Python / C++ 代码 | 改动需同步 bump 协议版本 |
| `mobile/app/` | 全部界面与交互逻辑 | 不接触任何原始数据 |
| `mobile/modules/muninn-core/` | 全部原生数据链路 | 原生代码只写在这里 |
| `mobile/ios`、`mobile/android` | 由 `expo prebuild` 自动生成 | 加入 `.gitignore`，不手写代码 |
| `host/` | PC 端客户端与多语言接口 | 可视化只是其中一个出口 |

没有单独的“假手机”模拟器：直接使用开发用 iPhone 联调；需要可复现测试时回放录制的 MCAP 文件。

## 4. 移动端设计

移动端是一个 Expo App 加一个本地原生模块：TypeScript 写一次 UI，两端共享；全部数据链路在原生层，JS 只做界面和控制。

### 4.1 为什么是 Expo

团队只有一到两人，设置页、配对与连接流程、录制管理、状态面板都只需写一次。真正必须写两遍的只有原生核心，而这部分无论选什么框架都无法避免。本地模块用 `npx create-expo-module@latest --local` 创建，自动链接到 App。

### 4.2 原生核心：Source → Transform → Sink

```
ARSource ────▶ [H.264 编码器] ──┬──▶ NetworkSins（UDP / WebSocket）
CameraSource ─┘                 └──▶ FileSink（本地录制）
ImuSource ───────────────────────┬──▶ NetworkSink
（深度、位姿不经编码）            └──▶ PreviewSink（状态叠加层）
```

- **Source**：每个传感器一个，统一接口 `capabilities()`、`start(config)`、`stop()`，产出带时间戳的 Sample。
- **Transform**：编码器等处理节点，编码一次，结果分发给多个 Sink。
- **Sink**：只消费 Sample，各自独立队列。
- **两种模式**：AR 模式（有位姿，只能用主摄）与纯相机模式（相机全可控，无位姿），只是启用不同 Source 组合。

原生目录内再分两层：采集、编码、网络等核心代码写成普通 Swift / Kotlin，**不依赖 ExpoModulesCore**；只有一两个很薄的适配文件（Module 定义、View 定义）引用 Expo。以后若放弃 Expo，核心可直接搬进纯原生 App。

### 4.3 JS 与原生的边界

| 方向 | 内容 | 频率 |
| --- | --- | --- |
| JS → 原生 | 读写统一配置（与 PC 远程配置同一套接口，见 6.8）、启动 / 停止会话、连接 PC | 用户操作时 |
| 原生 → JS | 状态事件：帧率、码率、连接状态、追踪状态、丢包率 | 节流到 5–10 Hz |
| 原生视图 | AR 相机预览（iOS ARView、Android ARCore 渲染视图），作为 Expo 原生 View 嵌入页面 | 原生直接渲染 |

图像帧和逐个 IMU 样本**永远不发给 JS**。界面上的 IMU 曲线在原生层降采样到约 30 Hz 再发，或直接做成原生视图。

### 4.4 预览

相朻画面直接用系统预览视图渲染，不经过 Bus。PreviewSink 只负责状态叠加层（帧率、码率、连接、录制状态）。将来若要预览处理后的数据（如深度伪彩色），再写一个 Metal 渲染的 Sink，通过 `CVMetalTextureCache` 零拷贝取纹理。

### 4.5 注意

若配对流程用扫二维码，扫码使用 expo-camera 时必须先停掉 AR 会话，扫完再恢复。

## 5. 平台细节：ARKit 与 ARCore

AR 模式下镜头基本不能换，但对焦、曝光等参数可以部分控制；ARKit 数据更稳定，ARCore 相机控制更灵活。

### 5.1 iOS（ARKit）

- **相机来源**：ARSession 独占相机，AR 模式下所有图像都取自 `ARFrame`（`capturedImage`、`camera.transform`、`camera.intrinsics`，LiDAR 机型另有 `sceneDepth`）。不能再同时开 AVCaptureSession。
- **换镜头**：不支持。世界追踪只输出主摄（广角）画面，超广角在后台参与追踪但不对外暴露（[Apple 论坛](https://developer.apple.com/forums/thread/831657)）。前置摄像头只能用于人脸追踪。
- **分辨率与帧率**：从 `supportedVideoFormats` 中选一个设到 `videoFormat`。
- **对焦、曝光、白平衡**（iOS 16+，需有超广角的机型）：通过 `configurableCaptureDeviceForPrimaryCamera` 拿到 `AVCaptureDevice` 调节（[文档](https://developer.apple.com/documentation/arkit/configuration-objects)）。
- **变焦**：不支持，该设备的可用变焦范围被锁定在 1.0（[Apple 论坛](https://developer.apple.com/forums/thread/715240)）。
- **IMU**：ARKit 不提供原始 IMU，用 CoreMotion 读取；二者时间戳同一时基，可直接对齐。

### 5.2 Android（ARCore）

- **相机配置**：用 `CameraConfigFilter` 按帧率、深度传感器、朝向筛选（[文档](https://developers.google.com/ar/develop/java/camera-configs)）。
- **对焦模式**：固定对焦利于追踪（默认），自动对焦适合录像和近距离物体。
- **更底层控制**：`SharedCamera` 可发 Camera2 CaptureRequest 手动设曝光等，但厂商支持差异大。
- **CPU 图像**：默认分辨率常偏低，高分辨率取决于机型提供的 camera config。
- **IMU**：用 SensorManager 读取；帧时间戳与 SensorEvent 的时基不一定一致，需实测并估计偏移。
- **平台依赖**：需要 Google Play Services for AR，无 GMS 的机型不可用。

### 5.3 差异对照

| 维度 | ARKit (iOS) | ARCore (Android) |
| --- | --- | --- |
| 位姿质量 | 机型少、标定统一，稳定 | 依赖厂商标定，差异大 |
| 深度 | Pro 机型 LiDAR 实测深度 + 置信度（Float32 米） | 多数机型从运动推算（uint16 毫米） |
| 场景网格 | LiDAR 机型原生支持 | 无原生 mesh |
| 相机控制 | 仅主摄；iOS 16+ 可调对焦、曝光、白平衡 | camera config、对焦模式、SharedCamera |
| 地图保存 | `ARWorldMap` 本地保存与加载 | 无本地地图导出 |

### 5.4 由此得出的设计规则

- 采集与标定场景**锁定对焦和曝光**，避免内参漂移和亮度跳变。
- **每帧都随数据发送当前内参**，不只在握手时发一次。
- 协议统一深度格式为 uint16 毫米 + 可选置信度通道。
- 需要超广角、长焦或前摄画面时，切到纯相机模式（无位姿）。
- 图像方向：ARKit 的 `capturedImage` 是传感器原始横屏方向，不随手机旋转；协议中明确声明图像方向与坐标系约定，PC 端统一转换。

## 6. 通信协议

协议是项目的核心资产：Protobuf 定义所有消息，按数据类型分通道传输，可视化工具不参与这一层。

### 6.1 序列化：Protobuf

- 用 `proto3` 语法，代码自动生成到 Swift（swift-protobuf）、Kotlin、Python、C++，四端格式天然一致。
- 控制、握手、能力描述、IMU、位姿、内参：直接用 Protobuf 消息。
- 图像和深度：第一版作为 bytes 字段放进消息（一帧 H.264 仅几十 KB，拷贝可忽略）。将来传未压缩原始帧遇到瓶颈时，再改为“固定二进制头 + Protobuf 元数据 + 原始载荷”。
- 不选 FlatBuffers（繁琐）、Cap'n Proto（Swift/Kotlin 支持弱）、MessagePack（无 schema）。

### 6.2 通道划分

| 通道 | 传输 | 内容 | 丢包策略 |
| --- | --- | --- | --- |
| 控制 | WebSocket | 握手、能力描述、订阅、配置下发、内参、时钟同步 | 可靠传输 |
| IMU / 位姿 | UDP | 每包带 seq + 时间戳 | 允许丢包，延迟优先 |
| 视频 | 第一版 TCP / WebSocket 发 H.264 NAL | 硬件编码（VideoToolbox / MediaCodec） | 拥塞时丢旧帧 |
| 深度 | TCP / WebSocket | uint16 毫米，lz4 或 zstd 无损压缩，可选置信度 | 不用有损视频编码 |

视频将来需要更低延迟时，再做 UDP 分片重组或 RTP / WebRTC。

### 6.3 握手与能力描述

手机连接后先发一个设备描述：机型、系统版本、协议版本，以及可用流的列表（`imu`、`ar_pose`、`rgb`、`depth`…）和各自格式、分辨率、帧率、内参。PC 端按需订阅。新增传感器只是多一个流，旧的 PC 端代码不受影响。

### 6.4 统一消息头

每条数据消息带：`stream_id`、`seq`、设备单调时钟时间戳（纳秒）、协议版本号、配置版本号 config\_version（见 6.8）。

### 6.5 时钟同步

所有数据在原生层用同一设备时钟打时间戳（iOS 上 `ARFrame.timestamp` 与 CoreMotion 同一时基）。控制通道上做类 NTP 的 ping-pong，PC 端估计手机时钟到 PC 时钟的偏移，用于与机器人等其他数据对齐。

### 6.6 坐标系约定

ARKit / ARCore 均为右手系、Y 轴向上、相机朝 -Z（OpenGL 约定）。协议中位姿保持原生约定并在能力描述里声明；PC 端 SDK 提供到 OpenCV / ROS 约定的转换。

### 6.7 发现与连接

- **方向**：手机是服务端。手机发布 Bonjour 服务 `_imuninn._tcp` 并监听控制端口（WebSocket）与数据端口（TCP）；PC 发现后连手机，并在 `Hello` 里告知自己接收 UDP 的端口。（2026-11-03 修订：原稿为手机发现 PC，与 §6.8 示例矛盾，且 USB 转发只能连手机上监听的端口，故统一为手机当服务端。）
- 局域网：mDNS / Bonjour 自动发现手机，免手输 IP；也可手输手机屏幕上显示的地址。
- USB（更稳定、低延迟）：iOS 插线后 Bonjour 直接给出 USB 直连的 169.254.x.x 地址，实测往返 1.5 ms，无需 usbmuxd；Android 用 `adb reverse`。
- iOS 需在 Info.plist 配置 `NSLocalNetworkUsageDescription` 与 Bonjour 服务名（由 Config Plugin 注入）。

### 6.8 远程配置

手机上所有可调参数都是数据而不是代码：PC 端和手机 UI 通过同一套配置接口读写，手机负责校验与生效，并把实际生效的值回报给所有客户端。

**配置模型**（Protobuf 定义，与数据消息同一份 schema）

```
DeviceConfig
├── session      模式（AR / 纯相机）、config_version
├── streams[]    每个流一项
│   ├── enabled  开关
│   ├── params   镜头、分辨率与帧率、对焦、曝光、白平衡、IMU 采样率…
│   ├── encoder  编码格式、码率、关键帧间隔
│   └── delivery 传输方式（UDP / TCP）、丢帧策略、降采样或限速、优先级
└── network      目标地址、带宽上限
```

**参数自描述**：能力描述中每个参数都带类型、单位、取值范围或可选值、当前值，以及生效方式。PC 端工具和手机 UI 都按这份描述自动生成控件，新增参数不需要改两端界面。

| 参数 | 生效方式 | 说明 |
| --- | --- | --- |
| 流开关 | 即时 | 关闭的流不采集、不编码 |
| 曝光、ISO、对焦、白平衡 | 即时 | 通过 AVCaptureDevice 调节 |
| IMU 采样率 | 即时 | CoreMotion 更新间隔 |
| 编码码率 | 即时 | 编码器支持运行时调整 |
| 丢帧策略、限速、优先级 | 即时 | 只影响对应 Sink |
| 分辨率与帧率 | 重启 AR 会话 | 从 `supportedVideoFormats` 中选择，编码器随之重建 |
| 镜头选择 | 重建采集会话 | 仅纯相机模式可用 |
| AR ↔ 纯相机模式 | 重启会话 | 位姿流随模式开关 |

**交互流程**

1. 连接后，PC 读取能力描述与当前配置（`GetCapabilities` / `GetConfig`）。
2. PC 发送 `SetConfig`：只含要改的字段（部分更新），并附上它看到的 `config_version`。
3. 手机校验：超出范围的值被拒绝或钳位；模式不允许的组合（如 AR 模式下选超广角）被拒绝。
4. 生效：即时类参数直接应用；需要重启的参数打包后一次性重启，受影响的流发出中断标记。
5. 回复 `ConfigResult`：逐字段说明已应用、已钳位或被拒绝及原因，并给出新的 `config_version`。
6. 广播 `ConfigChanged` 给所有客户端（包括手机 UI），任何一方的修改都能同步看到。

**数据可追溯**：每条数据消息头都带 `config_version`；MCAP 录制把配置变更记为单独通道，回放时能查到每一帧采集时的完整配置。

**控制权**：同一时刻只有一个客户端可写（租约机制，断线自动释放），其余只读。手机 UI 可随时一键接管，并在界面上显示“正在被远程控制”。

**配置预设（Profile）**：命名的完整配置，例如“标定”（锁定对焦与曝光）、“遥操作低延迟”。以 YAML 文件保存，可从 PC 推送到手机，也可在手机上保存。

```python
dev = imuninn.connect("iphone-dev.local")
dev.set("rgb.exposure.mode", "locked")
dev.apply_profile("profiles/calibration.yaml")
```

## 7. PC 端客户端

PC 端是一个客户端库：连接手机、接收并解码数据，再通过多种出口对外提供；Rerun 只是其中一个可替换的可视化出口。（2026-11-03 修订：原稿为“PC 网关进程”，现在网关只是可选的中继，多个接收端需要省带宽时再做。）

### 7.1 对外接口

- **Python**（`pip install imuninn`）：回调与迭代器两种 API，给实验脚本、训练和数据处理使用；同时提供远程读写手机配置、加载配置预设的接口。
- **C++ 库**：给实时控制程序直接链接。
- **Web**：浏览器不能收 UDP，由 PC 上的中继客户端通过 WebSocket 转发（待做）。
- **ROS 2**（可选）：在 `host/bridges/` 中发布为 topic。

### 7.2 可视化：Rerun

客户端解码后调用 `rr.log(...)` 把图像、位姿、IMU 交给 Rerun Viewer；SDK 与 Viewer 之间的传输由 Rerun 自己负责。选择 Rerun 的原因是 SDK 和 Viewer 全部开源，采用 MIT 或 Apache-2.0 双许可（[rerun.io](https://rerun.io/llms.txt)），可随项目一起分发。Foxglove 的 SDK 虽为 MIT，但其可视化应用自 2.0 起闭源，不符合开源约束。

手机端**不**直接说 Rerun 或 Foxglove 的协议：那会把数据模型绑死在可视化工具上，且 Rerun 没有 Swift / Kotlin SDK。

`imuninn rerun`（2026-11-03 补齐）：每台手机一棵 `world/<dev>` 子树（位姿、轨迹、RGB 针孔 + 视频、深度针孔 + 深度图/置信度/点云），`plots/<dev>` 放 IMU、跟踪、健康曲线，`events/<dev>` 放跟踪/热状态/Gap/配置变更日志；多台手机共用 `pc` 时间轴。视频默认把 H.264 NAL 原样交给 Viewer 解码（PC 端零解码），深度交给 Viewer 自动反投影，PC 端只在需要 RGB 着色点云时解码。回放 MCAP 走同一条路径。

### 7.3 录制：MCAP 原始流

客户端把手机发来的 Protobuf 消息**原样**写进 MCAP 文件（MIT 许可，原生支持 Protobuf schema）。数据集格式就是自己的协议，不绑定任何查看器；需要可视化时回放给 Rerun，或转换成 `.rrd`。MCAP 回放同时承担可复现测试的职责。

## 8. 性能与并发原则

抽象层的函数调用开销可以忽略（纳秒到微秒，而 30 fps 每帧预算 33 ms）；真正的代价在拷贝、格式转换和重复编码，以下规则针对这些。

1. **传引用，不拷贝**：Sample 只携带 `CVPixelBuffer`（Android 为 `HardwareBuffer` / `Image`）的引用，由引用计数管理生命周期。
2. **Bus 不做格式转换**：保持原生格式（YCbCr 420），由需要的 Sink 自行处理。
3. **编码一次，多处分发**：网络和录制都需要 H.264 时，只经过一个编码 Transform。
4. **每个 Sink 独立队列**：慢 Sink 不能拖住 Source；视频类 Sink 采用“只保留最新一帧”的丢帧策略，网络卡顿时丢旧帧，不让队列堆积。
5. **不长时间持有 ARKit 的帧**：ARKit 内部缓冲池很小，`ARFrame` 被持有过久会停止输出新帧。宁可丢帧，不要围帧。
6. **UI 更新限速**：状态事件 5–10 Hz，曲线 30 Hz 足够，绝不逐样本触发重绘。
7. **数据不进 JS**：见 4.3。

## 9. 许可证与合规

项目代码采用 `MIT OR Apache-2.0` 双许可，依赖中不允许出现 GPL 组件。

**双许可**的含义是“二选一”：使用者任选其一遵守即可。Apache-2.0 带专利授权条款，商用更稳妥；MIT 简短且兼容 GPLv2。仓库根目录放 `LICENSE-MIT` 和 `LICENSE-APACHE` 两个文件。

| 依赖 | 许可证 | 结论 |
| --- | --- | --- |
| Protobuf | BSD-3 | 可用 |
| Rerun SDK / Viewer | MIT 或 Apache-2.0 | 可用 |
| MCAP | MIT | 可用 |
| Expo / React Native | MIT | 可用 |
| VideoToolbox / MediaCodec | 系统 API | 可用 |
| FFmpeg / PyAV（PC 端解码） | LGPL 构建可用；GPL 构建不可用 | 只用 LGPL 构建 |
| x264 / x265 | GPL | 禁止链接 |

**执行方式**：CI 中加入依赖许可证扫描，从第一天起把 GPL 挡在外面，比后期替换省事得多。

## 10. 开发路线

开发分六个里程碑，先 iOS 后 Android；M1 结束时已能给机器人提供手机位姿，之后每一步结束都是可用版本。

&#91;embedded content: 开发路线 · M0–M5，每一步含验收标准\]

M0 一开始就用 Expo 搭好空壳和本地模块，后续里程碑只往 muninn-core 里加 Source 和 Sink；远程配置的基础版（流开关、帧率、曝光）在 M1 随控制通道一起实现，之后每个新参数加入配置模型即可被 PC 和手机 UI 同时调节。

## 11. 开发环境与注意事项

开发使用专用的开发 iPhone，与个人设备隔离；构建一律走 development build。

- **构建方式**：`npx expo run:ios` 本地编译到真机，不依赖 EAS；不使用 Expo Go。
- **签名**：当前使用免费个人 Apple ID 签名，App 约 7 天后过期需重新安装；若重装频率影响开发，再升级为个人付费开发者账号。
- **LiDAR**：开发用 iPhone 为 Pro 机型，带 LiDAR，M3 深度功能按计划进行。
- **权限与工程配置**：相机、本地网络、Bonjour 等全部通过 Config Plugin 注入，不手改 prebuild 生成的工程。
- **调试**：问题可能出在 TS、Swift、Kotlin 任一层，先判断层级再定位。
- **Expo SDK 升级**：每年集中升级一两次，不追最新版；升级时重点回归原生模块 API。
- **后台限制**：App 进入后台后系统会停止相机，属于平台限制，UI 中需提示用户保持前台。

## 12. 待定事项

- [x] 配对方式：手机发布 Bonjour，PC 发现或手输地址（2026-11-03）
- [x] 第一版 `.proto`：见 `protocol/imuninn.proto`（v2，2026-11-03）
- [ ] 配置预设文件格式（YAML 或 JSON）及存放位置
- [ ] 视频是否需要提前做 UDP 分片（取决于 M2 实测延迟）
- [ ] 正式商标检索（WIPO Global Brand Database，第 9 类与第 42 类），确认 iMuninn 可用
- [ ] 是否需要 ROS 2 桥接，以及优先级

## 参考资料

- [ARKit Configuration Objects](https://developer.apple.com/documentation/arkit/configuration-objects)
- [ARConfiguration.VideoFormat](https://developer.apple.com/documentation/arkit/arconfiguration/videoformat-swift.class)
- [Apple 论坛：世界追踪中的超广角相机](https://developer.apple.com/forums/thread/831657)
- [Apple 论坛：RealityKit 变焦与焦距](https://developer.apple.com/forums/thread/715240)
- [ARCore：Configuring the camera](https://developers.google.com/ar/develop/java/camera-configs)
- [Expo Modules API：Get started](https://docs.expo.dev/modules/get-started.md)
- [Expo：Customizing（本地模块）](https://docs.expo.dev/workflow/customizing/)
- [swift-protobuf](https://swiftpackageregistry.com/apple/swift-protobuf)
- [Protobuf 2026-07-13 变更公告](https://protobuf.dev/news/2026-07-13)
- [Rerun 文档与许可证](https://rerun.io/llms.txt)
- [Foxglove 2.0 定价与开源变更](https://discourse.openrobotics.org/t/foxglove-2-0-integrated-ui-new-pricing-and-open-source-changes/36583)

## 修订记录

- 2026-11-03：改为手机当服务端（§2、§6.7、§7）；协议 v2；USB 直连实测可用；M5 Android 搁置。
- 2026-11-03（晚）：M5 重启：无真机，先移植非 AR 部分（控制通道、IMU、Camera2 + MediaCodec、health、配置/Profile/租约）在模拟器验证；ARCore 位姿/深度留接口。Android 只有相机模式。实现差异与测试方法见 `docs/dev/05-Android.md`。
