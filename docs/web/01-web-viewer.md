# Web 查看器

浏览器里看手机数据：视频、深度、位姿轨迹、IMU 曲线、热状态 / 电量，什么都不用装，平板也行。页面是纯静态文件，直接连手机（协议 v5），也能拖入 MCAP 文件离线回放。

## 打开

| 入口 | 用途 |
| --- | --- |
| `http://imuninn-webviewer.projects.weijinqi.com` | 公开托管的页面（注意是 **http**，见下） |
| 手机 App 自带（规划中） | 手机再开一个 http 端口托管同一页面，任何设备打开 `http://<手机IP>:7421/` |
| 自己构建 | `cd host/web && npm install && npm run build`，用任何 http 静态服务器托开 `dist/` |

地址栏填手机地址（`10.0.0.5` 或 `10.0.0.5:7420`，在手机 App 的「服务」卡片里），点「连接」。

**页面必须以 http 打开**：浏览器禁止 https 页面连局域网的 `ws://`（混合内容规则），所以公开页面只提供 http；如果浏览器自动跳到了 https，手动改回 http。离线回放 MCAP 不受此限制。

## 直连手机是怎么工作的

浏览器开不了裸 TCP / UDP，协议 v5 给了手机一条专给浏览器的路：页面先像 Python 客户端一样连手机的控制 WebSocket（7420）握手，`Hello.data_transport = WEBSOCKET`；再对同一端口开第二条 WebSocket，首帧发 `"IMDATA01"` + 4 字节 `client_id`，之后所有流作为二进制 `DataMessage` 帧从这条连接收。数据格式和 Python / C++ 完全相同（页面用 protobufjs 运行时解析同一个 `imuninn.proto`）。

## 界面

- 顶栏的流开关控制这个浏览器收哪些流（不影响手机端）；「开始采集 / 停止」、「AR 模式 / 相机模式」和「深度」开关直接发给手机。深度只有 AR 模式才有，相机模式下开关置灰。
- 「画面」：自动（按重力把图像转正，AR 模式用位姿、相机模式用 IMU）/ 竖屏 / 横屏左 / 横屏右 / 倒置。只改显示，发出去和录下来的数据仍是传感器原始方向。
- 位姿面板是 3D 视图：轨迹、当前相机视锥、1 m 地面网格、世界坐标轴（ARKit 世界系，Y 向上）；拖动旋转，滚轮缩放，双击回到自动视距。
- 深度色标按每帧 98 分位自动定量程（右上角显示上限）。
- 「打开 MCAP」或把 `.mcap` 拖到页面上：本地回放，支持播放 / 暂停、拖动进度、倍速。
- 面板右上角显示实测频率、计数和按 `seq` 检测的丢帧数。右上角「中 / EN」切换界面语言，记住选择。

真机实测（iPhone 17 Pro，Wi‑Fi，Chromium）：1920×1440@60 H.264 在浏览器里解码显示 60 fps，位姿 60 Hz、IMU 100 Hz、LiDAR 深度 60 Hz 同时显示；直连 WebSocket 20 s 内视频只丢 5 帧（经 TCP 且深度全开时丢得更多，见协议说明）。

## 浏览器要求

- 视频解码用 WebCodecs（H.264 Annex‑B 直接喂 `VideoDecoder`）：Chrome / Edge 94+、Safari 16.4+；Firefox 目前不完整，视频面板会空着，其它流正常。
- 深度是 Apple 分块 LZ4，页面里用一个小的 JS 解码器解；MCAP 的 zstd 分块用 `fzstd`。
- 3D 位姿视图用 Canvas 2D 自己投影，没有 WebGL 依赖。

## 和 Python 包的关系

Web 查看器不在 `imuninn` Python 包里（以前的 `imuninn web` 中继已删除）。要在 PC 上录制、做数据集或接程序，用 [Python 包](../python/02-quickstart.md)。
