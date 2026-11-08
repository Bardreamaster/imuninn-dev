# Web 查看器

浏览器里看手机数据：视频、深度、位姿轨迹、IMU 曲线、热状态 / 电量。页面是纯静态文件，直接连手机（协议 v5），也能拖入 MCAP 文件离线回放。

## 在线页面

**<https://imuninn-webviewer.projects.weijinqi.com>**

- **Safari（macOS / iPadOS / iOS）可以直接用**：打开页面，地址栏填手机 App「服务」卡片里显示的地址（如 `10.0.0.5`），点「连接」。
- **Chrome / Edge 连不上手机**：出于安全策略，公网页面不能访问局域网地址，也拿不到视频解码器。用下面两种方式之一。
- 离线回放 MCAP 在任何浏览器里都能用。

## Chrome / Edge：本地起一个

```bash
pip install imuninn
imuninn web                 # 在 http://localhost:7430 托管同一页面并打开浏览器
```

从 `localhost` 打开时浏览器把页面当作可信来源：视频能解码，也允许连局域网里的手机。页面本身仍然直连手机，这台电脑只负责提供页面。

:::caution[Chrome / Edge 的另一种办法：改浏览器 flag]
打开 `chrome://flags/#unsafely-treat-insecure-origin-as-secure`，填入 `http://imuninn-webviewer.projects.weijinqi.com`，重启浏览器，然后用 **http://** 打开在线页面。这会让浏览器把该站点当作安全来源，连接手机时会弹一次「允许访问本地网络」的提示。这是开发者选项，只建议在自己的电脑上用。
:::

## 为什么会这样

- Chrome / Edge 的 Local Network Access 规则：公网来源的 http 页面禁止访问 `10.x` / `192.168.x` 等局域网地址；https 页面可以申请权限，但又被混合内容规则禁止连 `ws://`。
- WebCodecs（H.264 解码）只在安全上下文提供：`https://`、`http://localhost`。
- Safari 目前两条限制都没有；Firefox 能连但没有 WebCodecs，视频面板会空着。

## 直连手机是怎么工作的

浏览器开不了裸 TCP / UDP，协议 v5 给了手机一条专给浏览器的路：页面先像 Python 客户端一样连手机的控制 WebSocket（7420）握手，`Hello.data_transport = WEBSOCKET`；再对同一端口开第二条 WebSocket，首帧发 `"IMDATA01"` + 4 字节 `client_id`，之后所有流作为二进制 `DataMessage` 帧从这条连接收。数据格式和 Python / C++ 完全相同（页面用 protobufjs 运行时解析同一个 `imuninn.proto`）。

## 界面

- 顶栏的流开关控制这个浏览器收哪些流（不影响手机端）；「开始采集 / 停止」和「深度」开关直接发给手机。
- 深度色标按每帧 98 分位自动定量程（右上角显示上限）。
- 「打开 MCAP」或把 `.mcap` 拖到页面上：本地回放，支持播放 / 暂停、拖动进度、倍速。
- 面板右上角显示实测频率、计数和按 `seq` 检测的丢帧数。

真机实测（iPhone 17 Pro，Wi‑Fi）：1920×1440@60 H.264 在浏览器里解码显示 60 fps，位姿 60 Hz、IMU 100 Hz、LiDAR 深度 60 Hz 同时显示。

## 浏览器要求

- 视频解码用 WebCodecs（H.264 Annex‑B 直接喂 `VideoDecoder`）：Chrome / Edge 94+（需 localhost 或 https）、Safari 16.4+。
- 深度是 Apple 分块 LZ4，页面里用一个小的 JS 解码器解；MCAP 的 zstd 分块用 `fzstd`。
- 位姿只画俯视 X–Z 轨迹和朝向（ARKit 坐标，Y 向上），不做 3D。

## 自己构建

```bash
cd host/web && npm install && npm run build      # 生成 host/web/dist
imuninn web --static host/web/dist               # 或任何静态服务器，从 localhost 打开
```
