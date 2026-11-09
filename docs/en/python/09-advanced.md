# Advanced: asyncio, WebSocket transport, MCP

## The asyncio client

The `Device` returned by `imuninn.connect()` runs an asyncio client on a background thread. To drive the event loop yourself (for example alongside other asyncio code), use `PhoneClient` directly:

```python
import asyncio
from imuninn.client import PhoneClient
from imuninn.discovery import resolve

async def main():
    host, port = resolve("")                     # or ("10.0.0.5", 7420)
    client = PhoneClient(host, port)
    client.add_data_listener(lambda msg: print(msg.WhichOneof("body")))
    await client.connect()                       # Hello / Welcome, data channel, clock sync, subscribe to all
    await client.set("imu.rate_hz", 100)
    await client.start()
    await asyncio.sleep(5)
    await client.close()

asyncio.run(main())
```

Listeners receive the raw `DataMessage` (`msg.imu` / `msg.pose` / `msg.video` / `msg.depth` / `msg.health`). `client.request()` sends any control message and waits for the reply. Details: [API reference](08-api.md).

## Data over WebSocket

```python
dev = imuninn.connect(data_transport="websocket")
```

Every stream then travels on a second WebSocket to the control port (protocol v5, the browser path): a single port and no UDP, at the cost of a little more pose / IMU latency under congestion. Useful on networks that let only one port through.

## Browser viewer

`imuninn web` serves the browser viewer at `http://localhost:7430` (the page connects straight to the phone; Python does not relay anything). Why it has to be opened from localhost: [Web viewer](../web/01-web-viewer.md).

## Let an agent drive the phone (MCP)

After `pip install "imuninn[mcp]"`, `imuninn-mcp` is a stdio MCP server that wraps the client API as tools (discover, connect, set parameters, grab a frame, record MCAP). Setting it up in Claude Code and other clients: [Agents · MCP](../agents/MCP.md).

## Write your own client

The protocol is plain Protobuf over WebSocket + TCP / UDP, nothing proprietary: [protocol specification](../../protocol/README.md), [message reference](../protocol/messages.md). The package ships `imuninn/proto/imuninn.proto`, from which you can generate bindings for any language.
