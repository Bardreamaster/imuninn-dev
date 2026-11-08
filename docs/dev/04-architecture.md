# 04 · 架构与代码地图

## 三层

```
手机（服务端）                                   PC（客户端）
┌──────────────────────────────────────┐        ┌──────────────────────────┐
│ Source → Transform → Sink             │  UDP   │ PhoneClient (asyncio)     │
│  ArSource ─┬─ pose ──────────► UdpSink├───────►│  ├ UDP socket (pose/imu)  │
│  ImuSource ┘                          │  TCP   │  ├ TCP (video/depth)      │
│  CameraSource ─ image ─► VideoEncoder ├───────►│  └ WebSocket (control)    │
│  ArSource ─────┘  (H.264)  └► TcpSink │  WS    │ Device (sync facade)      │
│                            └► FileSink│◄──────►│  iter / on / set / start  │
│ ControlServer + DataServer (Bonjour)  │        │ H264Decoder, rerun_bridge │
│ ConfigStore (自描述参数)               │        └──────────────────────────┘
│ SessionManager（把以上串起来）         │
└──────────────────────────────────────┘
      ▲ 薄适配层：MuninnCoreModule.swift（Expo）
      ▲ UI：App.tsx（只收 5 Hz 状态事件，不碰数据）
```

协议（`protocol/imuninn.proto`）是唯一真相源，三端生成代码。

## 手机端文件（`mobile/modules/muninn-core/ios/`）

| 文件 | 职责 | 依赖 Expo？ |
| --- | --- | --- |
| `Core/SessionManager.swift` | 单例；启动服务、处理控制消息、按配置启停 Source、把样本发给每个客户端的 Sink、5 Hz 状态 | 否 |
| `Core/ControlServer.swift` | NWListener + WebSocket + Bonjour 发布；每个 PC 一个 `Client`（订阅集合、UdpSink、TcpSink、WsSink）；首帧为 `IMDATA01`+client_id 的连接是浏览器的数据通道 | 否 |
| `Core/WsSink.swift` | 协议 v5：把该客户端的全部流作为二进制帧发到第二条 WebSocket（浏览器用），背压同 TcpSink | 否 |
| `Core/DataServer.swift` | TCP 监听；读 4 字节 client_id 后把连接交给对应 Client 的 TcpSink | 否 |
| `Core/ArSource.swift` | ARSession；每帧出位姿 + 内参，并把 `capturedImage` 交给编码器 | 否 |
| `Core/CameraSource.swift` | AVCaptureSession；镜头 / 格式选择；每帧带 intrinsic matrix | 否 |
| `Core/ImuSource.swift` | CoreMotion；校准（deviceMotion）或 raw 两种 | 否 |
| `Core/VideoEncoder.swift` | VideoToolbox H.264；AVCC → Annex‑B；积压时丢帧 | 否 |
| `Core/UdpSink.swift` / `TcpSink.swift` / `FileSink.swift` | 三种出口；TcpSink 拥塞只保留最新帧并请求关键帧 | 否 |
| `Core/ConfigStore.swift` | 参数定义（类型、范围、生效方式）、当前配置、校验部分更新 | 否 |
| `Core/Pipeline.swift` | Sample / Source / Sink 协议、时间戳换算 | 否 |
| `Core/DeviceInfo.swift` / `NetInfo.swift` | 机型、协议版本、本机 IP | 否 |
| `MuninnCoreModule.swift` | Expo Module 定义：函数、事件、JSON ↔ protobuf | 是 |
| `MuninnPreviewView.swift` | ARSCNView / AVCaptureVideoPreviewLayer 预览 | 是 |
| `Generated/imuninn.pb.swift` | `tools/gen-proto.sh` 生成，不入库 | — |

JS 侧（`src/`）只有类型和 `requireNativeModule`；界面在 `mobile/App.tsx`。

## 手机端文件（Android，`mobile/modules/muninn-core/android/src/main/java/expo/modules/muninncore/`）

与 iOS 逐文件对应，职责相同；差异见 [Android](05-android.md)。

| 文件 | 对应 iOS | 实现 |
| --- | --- | --- |
| `core/SessionManager.kt` | `SessionManager.swift` | 单线程 executor 代替 DispatchQueue |
| `core/ControlServer.kt` | `ControlServer.swift` | Java-WebSocket 服务端 + NsdManager 发布 |
| `core/DataServer.kt` / `TcpSink.kt` / `UdpSink.kt` / `FileSink.kt` | 同名 | java.net 阻塞 socket + 单线程写队列 |
| `core/CameraSource.kt` | `CameraSource.swift` | Camera2；输出直接进预览 / 编码器 Surface |
| `core/VideoEncoder.kt` | `VideoEncoder.swift` | MediaCodec AVC，Surface 输入，输出已是 Annex-B |
| `core/ImuSource.kt` | `ImuSource.swift` | SensorManager |
| `core/ArSource.kt` | `ArSource.swift` | **未实现**，只有 ARCore 可用性检测 |
| `core/ConfigStore.kt` / `ProfileStore.kt` / `ConfigJSON.kt` | 同名 / `MuninnCoreModule.swift` 里的 `ConfigJSON` | 参数集与 iOS 完全一致 |
| `core/DeviceInfo.kt` / `NetInfo.kt` / `Protocol.kt` | `DeviceInfo.swift` / `NetInfo.swift` / `Pipeline.swift` | |
| `MuninnCoreModule.kt` | `MuninnCoreModule.swift` | 另外负责运行时相机权限、常亮 |
| `MuninnPreviewView.kt` | `MuninnPreviewView.swift` | TextureView |
| `src/main/java/generated/` | `ios/Generated/` | `tools/gen-proto.sh` 生成的 Java 类，不入库 |

## PC 端文件（`host/python/src/imuninn/`）

| 文件 | 职责 |
| --- | --- |
| `client.py` | `PhoneClient`：asyncio，控制 WebSocket、UDP 收、TCP 收、时钟同步、`set()` |
| `session.py` | `Device`：把 `PhoneClient` 跑在后台线程，给同步 API（`iter`、`on`、`set`…）；`connect()` |
| `discovery.py` | Bonjour 浏览、`resolve()`（名字 / host / host:port → 地址） |
| `video.py` | `H264Decoder`（PyAV） |
| `rerun_bridge.py` | 把样本 log 进 Rerun |
| `cli.py` | `imuninn list / watch / rerun / record / convert / info / profile` |
| `proto/` | 生成的 protobuf 绑定 + `imuninn.proto` 副本（提交在仓库里，`tools/gen-proto.sh` 更新） |

## Web 查看器（`host/web/`）

Vite + TypeScript 静态页面，无框架。`src/proto.ts` 在运行时用 protobufjs 解析 `protocol/imuninn.proto`（不生成代码）；`video.ts` 用 WebCodecs 解 H.264；`lz4.ts` / `depth.ts` 解 Apple 分块 LZ4 深度；`mcap.ts` 用 `@mcap/core` 在浏览器里读 MCAP；`phone.ts` 直连手机（协议 v5 握手 + 第二条数据 WebSocket）。`npm run build` 产物 `dist/` 不入库，部署到 GitHub Pages（仅 http）；以后也内置进手机 App 由手机托管。

## 关键约定

- **数据不进 JS**：图像和逐样本 IMU 只在原生层流动；JS 只拿 5 Hz 状态。
- **每个 Sink 独立丢弃**：慢的客户端只影响自己。视频类在 TcpSink 里丢非关键帧，UDP 在 `send` 失败时计数。
- **配置改动统一走 `ConfigStore.apply`**：无论来自 PC（`SetConfig`）还是手机 UI（`setConfigLocally`），之后 `applyChanges` 决定即时生效还是重启 Source，再广播 `ConfigChanged`。
- **时间戳**：所有样本用设备单调时钟（`CACurrentMediaTime` 时基，纳秒）；PC 用握手时的 NTP 式估计换算。
- **不要长期持有 `ARFrame`**：`ArSource` 只在回调里取字段和 `capturedImage` 引用，立即交给编码器。

## 加一个新传感器 / 新参数

1. `protocol/imuninn.proto`：新增消息或字段；bump `VERSION` 和三处 `PROTOCOL_VERSION`；`tools/gen-proto.sh`。
2. `Core/`：写一个 Source（实现 `start/stop`，通过回调出样本）。
3. `ConfigStore.swift`：`addStream(...)` 加流和参数定义（UI 和 PC 端自动出现控件）。
4. `SessionManager.swift`：在 `restartSources` 里按配置启动，在 `applyChanges` 里处理即时参数，写一个 `publishXxx` 发给订阅者。
5. PC：`client.py` 的 `_on_data` 已按 `DataMessage.body` 分发，一般只需在 `cli.py` / `rerun_bridge.py` 里加显示。
