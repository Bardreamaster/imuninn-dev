# 开发路线 M0–M5

设计文档 §10 里的里程碑图表没有随 Markdown 导出，下面是按文档正文推出的版本，验收标准待与原图核对。

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0** | Expo 空壳 + `muninn-core` 本地模块；monorepo 结构；`.proto` 草案；PC 网关骨架（mDNS + 控制通道握手）；双许可证 | `npx expo run:ios` 装到真机，界面显示原生模块返回的设备信息；`imuninn gateway` 能广播并打印收到的 Hello |
| **M1** ✅ 2026-11-03 | 控制通道（握手、能力描述、订阅、时钟同步）；ARKit 位姿 + CoreMotion IMU 走 UDP；远程配置基础版（流开关、帧率、曝光）；Python API 回调/迭代器 | 机器人程序能通过 Python 拿到手机实时位姿；配置改动在 PC 与手机 UI 同步 |
| **M2** ✅ 2026-11-03 | 视频：VideoToolbox H.264 编码一次、网络 + 本地录制分发；PC 端解码；Rerun 出口 | 30 fps 端到端延迟实测并记录；决定是否做 UDP 分片 |
| **M3** ✅ 2026-11-03 | LiDAR 深度（uint16 mm + 置信度，lz4/zstd）；MCAP 原样录制与回放 | 深度与 RGB、位姿按时间戳对齐；MCAP 回放驱动 PC 端测试 |
| **M4** ✅ 2026-11-03 | 配置预设 Profile、租约控制权、纯相机模式（换镜头）；C++ 接收库；bench 工具 | 标定 profile 一键锁定对焦曝光；C++ 实时控制程序直接链接 |
| **M5** 🚧 进行中 | Android 移植（ARCore、MediaCodec、SensorManager）；ROS 2 桥接（可选） | 非 AR 部分在模拟器上验证（2026-11-03 开始）；ARCore 位姿/深度等真机 |

## Web 查看器（2026-11-03）

- [x] `host/web/`：浏览器查看器（WebCodecs 视频、LZ4 深度、位姿轨迹、IMU、health），MCAP 拖入回放
- [x] `imuninn web`：PC 中继（手机 TCP/UDP → 浏览器 WebSocket）+ 静态托管；`--mcap` 回放模式
- [ ] 手机直出 WebSocket 数据帧（`TRANSPORT_WEBSOCKET`），省掉中继

## M0 状态（2026-11-03）

- [x] monorepo 结构、`.gitignore`、`LICENSE-MIT` / `LICENSE-APACHE`
- [x] `protocol/imuninn.proto` v1 草案 + `protocol/README.md`
- [x] `mobile/`：Expo SDK 58 空壳、`app.config.ts`、Config Plugin（相机/运动/本地网络/Bonjour/ARKit）
- [x] `mobile/modules/muninn-core/`：薄 Expo 适配层 + `ios/Core/`（Pipeline 骨架、DeviceInfo）
- [x] `host/python/`：`imuninn` 包、`imuninn gateway`（mDNS + Hello/Welcome）
- [x] 模拟器构建验证（iPhone 18 Pro 模拟器，见 `docs/design/m0-simulator.png`）
- [x] 真机构建验证（iPhone 17 Pro，AR + LiDAR = true）

## M1 状态（2026-11-03）

- [x] 控制通道：Bonjour 发现、WebSocket 握手、能力描述、订阅、NTP 式时钟同步、自动重连
- [x] ARKit 位姿（含每帧内参）+ CoreMotion IMU 走 UDP，真机实测 60 Hz / 100 Hz 零丢包
- [x] 远程配置：自描述参数、部分更新、钳位/拒绝、ConfigChanged 广播；手机 UI 控件由能力描述生成
- [x] Python：`imuninn.open()` / `wait_for_device()` / `set()` / `iter()` / `on()`；`imuninn watch`
- [x] 租约（单写者）：M4 已实现（隐式获取、409 拒绝、断线释放、手机一键接管）
- [x] 纯相机模式（M2 提前做了）

## M2 状态（2026-11-03）

- [x] VideoToolbox H.264 编码一次，分发到 TCP 网络 Sink 与本机 FileSink；拥塞时只丢非关键帧并请求新关键帧
- [x] 纯相机模式（提前自 M4）：AVCapture，镜头 广角/超广角/长焦/前置，分辨率随镜头
- [x] IMU `raw` 选项（原始加速度计 + 陀螺）
- [x] PC：TCP 视频通道、PyAV 解码、`imuninn rerun`（位姿 + 针孔相机 + 图像 + IMU 曲线）
- [x] 真机实测：AR 模式 1920x1440@60 视频 60 fps 零丢帧，位姿 60 Hz、IMU 100 Hz 同时
- [x] 本机录制文件 → MCAP 转换（`imuninn convert`）
- [ ] 视频走 UDP 分片 / RTP（待 M2 延迟实测后决定，当前 TCP 够用）

## 架构调整（2026-11-03）：手机是服务端

设计文档 §6.7（手机发现 PC）与 §6.8 示例（PC 连手机）矛盾，M0–M2 按前者实现。现改为**手机发布 Bonjour 服务并监听，PC 连手机**（协议 v2）：
- 语义上手机是传感器；USB 模式（usbmuxd/iproxy 转发到手机监听端口）只能这样做；多台 PC 可同时连接。
- 实测 USB 插着时 Bonjour 直接给出 USB 直连地址（169.254.x.x），往返 1.5 ms（Wi‑Fi 8 ms）。
- 文档 §7 的"PC 网关"变成可选中继（多接收端想省手机上行流量时用），尚未实现。

## 后续计划（2026-11-03 与用户确认）

1. M3 LiDAR 深度 + MCAP → M4 Profile / 租约 / C++ 库 / bench；M5 Android 搁置。
2. 开发完成后：界面优化。
3. Agent 文档：`docs/agents/AGENTS.md` + 一个 MCP server（discover / connect / set / start / snapshot）。
4. 文档站：Astro Starlight，内容源 `docs/user` + `docs/dev`，部署 Cloudflare Pages。
5. Release 包：`npx expo run:ios --device --configuration Release`，JS 打进 App，离线可用。

## M3 状态（2026-11-03）

- [x] LiDAR 深度：ARKit sceneDepth / smoothedSceneDepth → uint16 mm + uint8 置信度，Apple LZ4 分块压缩，缩放后的内参
- [x] PC：`imuninn.depth.decode`（含跨块 LZ4 字典），Rerun DepthImage
- [x] MCAP：`imuninn record / convert / info`、`rerun --mcap`、`mcap_io.replay`
- [x] 真机实测：深度 60 Hz（54 KB/帧），与 RGB 60 fps、位姿 60 Hz、IMU 100 Hz 同时跑零丢包；4 s 录制 1123 条消息回放一致（见 `docs/design/m3-depth.png`）

## M4 状态（2026-11-03）

- [x] 配置预设：YAML（内置 calibration / teleop / dataset / camera_wide），`imuninn profile apply|save|list`，`dev.apply_profile()`；手机本地预设（Documents/profiles）
- [x] 租约：隐式获取、`LeaseError`、`acquire/release`、断线释放、手机"接管"按钮广播 REVOKED；双客户端实测
- [x] C++ 客户端库 `host/cpp`（仅依赖 protobuf；WebSocket / UDP / TCP、时钟同步、set、回调），`imuninn_watch` 示例实测 60 Hz / 100 Hz 零丢包
- [x] `tools/bench/latency.py`：USB 直连实测 IMU 2.6 ms、位姿 39 ms、视频 49 ms、深度 44 ms（`docs/design/m4-bench-usb.json`）
- [ ] 视频 UDP / RTP：延迟主要在 ARKit 管线与编码，TCP 不是瓶颈，暂不做

## 长时测试（2026-11-03）

4 小时全流采集（USB 供电、静置）：热状态 75 min 后 fair、未到 serious；四路流全程 60 Hz / 100 Hz，视频丢帧 0.008%。详见 `docs/design/longrun-20261103/README.md`。待做：运动画面版、拔线 Wi‑Fi 版。

## M5 状态（2026-11-03）

决定：没有 Android 真机，先把非 AR 部分移植并在模拟器上验证，ARCore 留接口。详见 `docs/dev/05-Android.md`。

- [x] Kotlin 端：控制通道（WebSocket + NSD）、TCP/UDP/文件 Sink、ConfigStore/Profile/租约、SensorManager IMU、Camera2 + MediaCodec H.264、health、预览视图、运行时相机权限
- [x] `tools/gen-proto.sh` 生成 Java 类到 `android/src/main/java/generated/`
- [x] 模拟器 UDP 回环处理（`adb forward` 进来的对端是 127.0.0.1 → 发往 10.0.2.2）
- [x] 2026-11-05：本机装 JDK 17 + Android SDK + arm64 模拟器，Gradle 编译通过（只改了两处 Float/Double）
- [x] 2026-11-05 模拟器实测：IMU 100 Hz、视频 30 fps、health、多客户端、租约、配置校验、PC Profile、PC/手机端录制全部通过（见 `docs/dev/05-Android.md`、`docs/design/m5-emulator.png`）
- [x] 2026-11-05：`rgb.*` 相机控制参数（曝光/白平衡/对焦/变焦/手电/HDR/低光/防抖）移植到 Camera2，与 iOS 同一参数集；模拟器验证参数通路，HAL 不支持的走回退
- [ ] ARCore 位姿 + 深度（需真机）
- [ ] ROS 2 桥接（可选）
## Rerun 可视化补齐（2026-11-03）

对照设计文档 §7.2 把 `imuninn rerun` 做完整（`host/python/src/imuninn/rerun_bridge.py`）：

- [x] 位姿轨迹（`world/<dev>/trajectory`，按 50 ms / 1 cm 抽稀，上限 2 万点）
- [x] 视频默认客户端 PyAV 解码（`--video decode`）；`--video stream` 把 H.264 NAL 原样喂给 Viewer（`VideoStream`），但原生 Viewer 靠外部 ffmpeg 解码，1920×1440@60 实测每秒重启一次 ffmpeg、画面卡顿，所以不做默认
- [x] `--port` 起独立 Viewer，不往 9876 上已有的 Viewer 里灌数据
- [x] 深度：DepthImage（turbo 色图）+ 置信度图；`--points` 在 PC 端反投影成 Points3D，`--video decode` 时按 RGB 着色
- [x] 多设备：`imuninn rerun 手机A 手机B`，每台一棵 `world/<dev>` 子树，共享 `pc` 时间轴，各自 `device:<dev>` 时间轴
- [x] 默认布局（blueprint）：3D + RGB + 深度 + IMU/健康/跟踪曲线（带图例）+ 事件日志；`--no-blueprint` 关闭
- [x] 事件日志：跟踪状态、热状态、低电量模式、电池状态变化，Gap，配置变更
- [x] 时间轴：`pc`（实时用时钟同步偏移，回放用 MCAP log_time）、`device`；去掉跨流无序的 `seq`
- [x] 离线测试：合成 MCAP（含 PyAV 编的 H.264）→ `.rrd`，三种视频模式（`tests/test_rerun_bridge.py`）

## TODO（2026-11-07）

- 手机本机录制：按钮暂时隐藏（协议和 `dev.start_recording()` 仍可用）。待做：手机上的录制管理页（列表 / 大小 / 删除）、PC 端拉取与删除录制文件的协议接口（`ListRecordings` / `FetchRecording` / `DeleteRecording`，走 TCP 数据通道），`imuninn recordings pull` 命令。
