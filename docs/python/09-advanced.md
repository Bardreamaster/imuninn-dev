# 高级：asyncio、WebSocket 传输、MCP

## asyncio 客户端

`imuninn.connect()` 返回的 `Device` 在后台线程里跑一个 asyncio 客户端。要自己控制事件循环（比如和别的 asyncio 代码合在一起），直接用 `PhoneClient`：

```python
import asyncio
from imuninn.client import PhoneClient
from imuninn.discovery import resolve

async def main():
    host, port = resolve("")                     # 或 ("10.0.0.5", 7420)
    client = PhoneClient(host, port)
    client.add_data_listener(lambda msg: print(msg.WhichOneof("body")))
    await client.connect()                       # Hello/Welcome、数据通道、时钟同步、订阅全部
    await client.set("imu.rate_hz", 100)
    await client.start()
    await asyncio.sleep(5)
    await client.close()

asyncio.run(main())
```

回调收到的是原始 `DataMessage`（`msg.imu` / `msg.pose` / `msg.video` / `msg.depth` / `msg.health`）。`client.request()` 可以发任意控制消息并等回复。API 细节见 [API 参考](08-api.md)。

## 数据走 WebSocket

```python
dev = imuninn.connect(data_transport="websocket")
```

所有流改走第二条到控制端口的 WebSocket（协议 v5，浏览器用的路径）：只需一个端口、不用 UDP，代价是拥塞时位姿 / IMU 多一点延迟。穿越只放行一个端口的网络时有用。

## 浏览器查看器

`imuninn web` 在 `http://localhost:7430` 托管浏览器查看器（页面直连手机，不经过 Python 中继）。为什么必须从 localhost 打开见 [Web 查看器](../web/01-web-viewer.md)。

## 让 agent 操作手机（MCP）

`pip install "imuninn[mcp]"` 后 `imuninn-mcp` 是一个 stdio MCP server，把客户端 API 包成工具（发现、连接、改参数、拿一帧图、录 MCAP）。接入 Claude Code 等见 [Agent · MCP](../agents/MCP.md)。

## 自己写客户端

协议是纯 Protobuf + WebSocket + TCP/UDP，没有私有部分：[协议规范](../../protocol/README.md)、[消息参考](../protocol/messages.md)。包里附了 `imuninn/proto/imuninn.proto`，可用它生成任何语言的绑定。
