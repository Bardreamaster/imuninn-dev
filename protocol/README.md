# iMuninn 协议

`imuninn.proto` 是手机端、PC 端、所有语言绑定的唯一真相源。改协议时三端在同一个 commit 中同步更新，并 bump `VERSION`。

设计依据：`docs/iMuninn-设计文档.md` §6。

## 版本

- `VERSION` 文件保存整数协议版本号，每条消息头 `Header.protocol_version` 携带。
- 规则：只增不改。删除字段只能 `reserved`，不得复用字段号。
- 语义变化（即便字段号不变）也要 bump。

## 通道

| 通道 | 传输 | 消息 | 丢包策略 |
| --- | --- | --- | --- |
| 控制 | WebSocket | `ControlMessage` | 可靠 |
| IMU / 位姿 | UDP，每包一条 `DataMessage` | `ImuSample`、`PoseSample` | 允许丢包 |
| 视频 | TCP（v1） | `VideoFrame`（H.264 Annex-B） | 发送端只保留最新一帧 |
| 深度 | TCP | `DepthFrame`（uint16 mm + lz4/zstd） | 不丢 |

TCP 流上的帧格式：`uint32 little-endian length` + `DataMessage` bytes。UDP 上每个数据报就是一条 `DataMessage`，不分片（超过 MTU 的消息走 TCP）。

## 连接流程

1. 手机通过 mDNS 发现 `_imuninn._tcp` 服务（PC 网关），或用户手输地址。
2. 手机打开控制 WebSocket，发 `Hello`；网关回 `Welcome`。
3. PC 端 `GetCapabilities` → `Capabilities`（含当前 `DeviceConfig`）。
4. `Subscribe` 订阅流；`SessionControl START` 开始采集。
5. 配置修改走 `SetConfig`（部分更新 + `base_config_version`）→ `ConfigResult` → 广播 `ConfigChanged`。

## 坐标系

位姿保持 ARKit / ARCore 原生约定：右手系、Y 向上、相机朝 -Z。PC SDK 提供到 OpenCV（右手、Y 向下、Z 向前）和 ROS（右手、X 向前、Z 向上）的转换。

图像按传感器原始方向发送，`rotation_deg` 说明显示时要转多少度。内参跟图像同方向。

## 代码生成

```bash
tools/gen-proto.sh
```

生成产物不入库（见根目录 `.gitignore`）。
