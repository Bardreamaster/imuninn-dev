# iMuninn 协议

`imuninn.proto` 是手机端、PC 端、所有语言绑定的唯一真相源。改协议时三端在同一个 commit 中同步更新，并 bump `VERSION`。

消息字段参考（生成）：`docs/protocol/messages.md`。

## 版本

- `VERSION` 文件保存整数协议版本号，每条消息头 `Header.protocol_version` 携带。
- 规则：只增不改。删除字段只能 `reserved`，不得复用字段号。
- 语义变化（即便字段号不变）也要 bump。

## 通道

| 通道 | 传输 | 消息 | 丢包策略 |
| --- | --- | --- | --- |
| 控制 | WebSocket | `ControlMessage` | 可靠 |
| IMU / 位姿 | UDP（手机 → 每个客户端的端口），每包一条 `DataMessage` | `ImuSample`、`PoseSample` | 允许丢包 |
| 视频 | TCP（v1） | `VideoFrame`（H.264 Annex-B） | 发送端只保留最新一帧 |
| 深度 | TCP | `DepthFrame`（uint16 mm + lz4/zstd） | 不丢 |
| 全部数据（浏览器） | WebSocket（v5，`Hello.data_transport = WEBSOCKET`） | 同上，每帧一条 `DataMessage` | 同 TCP：视频积压丢非关键帧 |

TCP 流上的帧格式：`uint32 little-endian length` + `DataMessage` bytes。UDP 上每个数据报就是一条 `DataMessage`，不分片（超过 MTU 的消息走 TCP）。

## 连接流程（v2：手机是服务端）

1. 手机发布 Bonjour 服务 `_imuninn._tcp`（名字 = 设备名，TXT `proto=<版本>`），监听控制端口 7420（WebSocket）和数据端口 7422（TCP）。
2. PC 发现或手输地址后打开控制 WebSocket，发 `Hello`（客户端名、自己接收 UDP 的端口）；手机回 `Welcome`（设备信息、能力描述 + 当前配置、TCP 端口、`client_id`）。
3. PC 连手机的 TCP 数据端口，先写 4 字节 LE `client_id`，之后收视频 / 深度流。位姿 / IMU 由手机发到 PC 的 UDP 端口。
   浏览器没有裸 TCP / UDP：`Hello.data_transport = TRANSPORT_WEBSOCKET` 时，客户端改为对控制端口再开一条 WebSocket，第一帧发二进制 `"IMDATA01"` + 4 字节 LE `client_id`，之后所有订阅的流（含位姿 / IMU / health）都作为二进制 `DataMessage` 帧从这条连接收。
4. `Subscribe` 订阅流；`SessionControl START` 开始采集。多个 PC 可同时连接，各自订阅。
5. 配置修改走 `SetConfig`（部分更新 + `base_config_version`）→ `ConfigResult` → 广播 `ConfigChanged` 给所有客户端。

## 坐标系

位姿保持 ARKit / ARCore 原生约定：右手系、Y 向上、相机朝 -Z。PC SDK 提供到 OpenCV（右手、Y 向下、Z 向前）和 ROS（右手、X 向前、Z 向上）的转换。

图像按传感器原始方向发送，`rotation_deg` 说明显示时要转多少度。内参跟图像同方向。

## 代码生成

```bash
tools/gen-proto.sh
```

生成产物不入库（见根目录 `.gitignore`）。
