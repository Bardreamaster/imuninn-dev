# 06 · Web 查看器

浏览器里看手机数据：视频、深度、位姿轨迹、IMU 曲线、设备热状态 / 电量，不用装 Rerun。也能直接拖入 MCAP 文件回放，完全离线。

## 为什么要一个中继

浏览器开不了裸 TCP / UDP，也不能浏览 Bonjour；而手机的视频 / 深度走 TCP、位姿 / IMU 走 UDP。所以 PC 上跑一个很小的中继 `imuninn web`：它用现成的 `PhoneClient` 连手机，把 `DataMessage` 原样转发到本机的 WebSocket，并顺带托管查看器页面。页面本身是纯静态文件（`host/web/dist/`）。

页面必须以 **http** 打开（中继给的地址）。放到 https 站点上的页面会被浏览器拒绝连接局域网 `ws://`（混合内容），那种情况只能用 MCAP 回放。

## 用法

```bash
cd host/web && npm install && npm run build      # 一次，生成 host/web/dist
imuninn web                                      # 自动发现手机；或 imuninn web <名字或IP> --start
imuninn web --mcap run1.mcap                     # 不连手机，循环回放一个录制给浏览器
```

然后打开 <http://localhost:7430/>，点"连接"。同一局域网的其它电脑 / 平板用 `http://<这台电脑的IP>:7430/` 也能看（多个浏览器可同时连，各自订阅）。

- 顶栏的流开关控制这个浏览器收哪些流（不影响手机端）；"开始采集 / 停止"直接发给手机。
- "打开 MCAP" 或把 `.mcap` 拖到页面上：本地回放，支持播放 / 暂停、拖动进度、倍速。
- 面板右上角显示 PC 端实测频率、计数和按 `seq` 检测的丢帧数。

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

## 后续：手机直出 WebSocket

协议里已有 `TRANSPORT_WEBSOCKET`，下一步可以让手机在 `Hello` 里看到标志后把数据帧直接发到控制 WebSocket 上，这样浏览器不需要中继（页面仍需 http 托管，可由手机自己提供）。
