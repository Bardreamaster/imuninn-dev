# 06 · Web 查看器

浏览器里看手机数据：视频、深度、位姿轨迹、IMU 曲线、设备热状态 / 电量，不用装 Rerun。页面是纯静态文件（`host/web/dist/`），**直接填手机 IP 就能连**（协议 v5），也能拖入 MCAP 文件离线回放。

## 直连手机（推荐）

浏览器开不了裸 TCP / UDP，所以协议 v5 给了手机一条专给浏览器的路：页面先像 Python 客户端一样连手机的控制 WebSocket（7420）握手，`Hello.data_transport = WEBSOCKET`；再对同一端口开第二条 WebSocket，首帧发 `"IMDATA01"` + 4 字节 `client_id`，之后视频 / 深度 / 位姿 / IMU / health 全部作为二进制 `DataMessage` 帧从这条连接收。数据协议和 Python / C++ 完全相同（页面在运行时用 protobufjs 解析同一个 `imuninn.proto`），只是传输层换成了浏览器能用的 WebSocket；Python / C++ 走的 TCP / UDP 不受影响。

```bash
cd host/web && npm install && npm run build      # 一次，生成 host/web/dist
cd host/web && npm run preview                   # 或任何 http 静态服务器，或 imuninn web --mcap 顺带托管
```

打开页面，地址栏填 `10.0.0.5`（或 `10.0.0.5:7420`），点"连接"。页面必须以 **http** 打开：https 页面会被浏览器拒绝连接局域网 `ws://`（混合内容）。

## 经 PC 中继（旧包 / 回放）

`imuninn web` 是一个很小的中继：用 `PhoneClient` 连手机，把 `DataMessage` 原样转发到本机 WebSocket，并托管页面。老于 v5 的手机包、或者想让一群浏览器共享一条到手机的连接时用它；`--mcap` 模式不连手机，循环回放录制。

```bash
imuninn web                                      # 自动发现手机；或 imuninn web <名字或IP> --start
imuninn web --mcap run1.mcap                     # 不连手机，循环回放一个录制给浏览器
```

然后打开 <http://localhost:7430/>，地址栏填 `ws://localhost:7430/ws`，点"连接"。同一局域网的其它电脑 / 平板用 `http://<这台电脑的IP>:7430/` 也能看。

- 顶栏的流开关控制这个浏览器收哪些流（不影响手机端）；"开始采集 / 停止"和"深度"开关（`depth.enabled`，会重启 AR 会话）直接发给手机。
- 深度色标按每帧的 98 分位自动定量程（右上角显示当前上限），近景不会一片蓝。
- "打开 MCAP" 或把 `.mcap` 拖到页面上：本地回放，支持播放 / 暂停、拖动进度、倍速。
- 面板右上角显示 PC 端实测频率、计数和按 `seq` 检测的丢帧数。

真机实测（2026-11-05，iPhone 17 Pro，Wi‑Fi，Chromium）：1920×1440@60 H.264 在浏览器里解码显示 60 fps，位姿 60 Hz、IMU 100 Hz、LiDAR 深度 60 Hz 同时显示；中继进程约 4% CPU。

## 浏览器要求

- 视频解码用 WebCodecs（H.264 Annex‑B 直接喂 `VideoDecoder`）：Chrome / Edge 94+、Safari 16.4+；Firefox 目前不完整，视频面板会空着，其它流正常。
- 深度是 Apple 分块 LZ4，页面里用一个小的 JS 解码器解；MCAP 的 zstd 分块用 `fzstd`。
- 位姿只画俯视 X–Z 轨迹和朝向（ARKit 坐标，Y 向上），不做 3D。

## 中继协议（给想自己写前端的人）

`ws://host:7430/ws`：

| 方向 | 帧 | 内容 |
| --- | --- | --- |
| 中继 → 浏览器 | 二进制 | `DataMessage` protobuf，和手机发的字节一样 |
| 中继 → 浏览器 | 文本 JSON | `{"type":"welcome","mode":"live"/"replay","device":{...},"streams":[...],"subscribed":[...]}`，之后有 `status` / `error` |
| 浏览器 → 中继 | 文本 JSON | `{"type":"subscribe","streams":[...],"unsubscribe":false}`、`{"type":"start"}`、`{"type":"stop"}`、`{"type":"set","key":"rgb.fps","value":30}` |

慢的浏览器只影响自己：每个连接一个有界队列，满了就丢。

## 后续

- 手机自己托管这几个静态文件（再开一个极小的 HTTP 端口），就不需要 PC 上任何东西。
- 显示端按重力方向自动把图像转正（数据不变）。
