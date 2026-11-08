# Python 包开发

```bash
cd host/python
uv venv && source .venv/bin/activate
uv pip install -e ".[all,dev,docs]"   # docs = griffe，给 tools/gen-docs.py 用（Python 3.11+）
python -m pytest -q
```

## 目录

| 文件 | 作用 |
| --- | --- |
| `src/imuninn/client.py` | asyncio 协议客户端（控制 WebSocket、TCP / UDP 或 WebSocket 数据通道、租约、时钟同步） |
| `src/imuninn/session.py` | 同步门面 `connect()` / `Device`，后台线程跑事件循环 |
| `src/imuninn/discovery.py` | Bonjour 发现与 target 解析 |
| `src/imuninn/depth.py`、`video.py` | 深度 LZ4 解码、H.264 解码（PyAV） |
| `src/imuninn/mcap_io.py` | MCAP 录制 / 转换 / 回放 |
| `src/imuninn/rerun_bridge.py` | Rerun 可视化（实体布局见文件头） |
| `src/imuninn/profiles.py` + `profiles/*.yaml` | 配置预设 |
| `src/imuninn/mcp_server.py` | MCP server |
| `src/imuninn/cli.py` | 命令行 |
| `src/imuninn/proto/` | 生成的 protobuf 绑定 + `imuninn.proto` 副本（提交在仓库里） |

## 改了协议

```bash
tools/gen-proto.sh        # 重新生成三端绑定并复制 .proto 到包里
tools/gen-docs.py         # 重新生成 CLI / API / 协议消息参考
```

同时 bump `protocol/VERSION`、`imuninn/__init__.py` 的 `PROTOCOL_VERSION`、`DeviceInfo.swift` 和 `Protocol.kt` 的常量；CI 的 `generated-code` 任务会检查生成文件和 `.proto` 一致。

## 约定

- docstring、注释、日志全部英文，Google 风格；公开 API（`imuninn.*`、`Device`、`PhoneClient`、`depth` / `video` / `mcap_io` / `profiles` 的公开函数）必须有 docstring，[API 参考](../python/08-api.md)从它们生成。
- 重的依赖走 extras，核心保持 protobuf / websockets / zeroconf / numpy / lz4 / pyyaml。
- 新命令加到 `cli.py` 后跑 `tools/gen-docs.py` 更新 [CLI 参考](../python/07-cli.md)。

## Rerun 开发备注

视频默认由本机 PyAV 解码再送 Viewer（`--video decode`）；`--video stream` 把 H.264 交给原生 Viewer 的外置 ffmpeg，1920×1440@60 下约每秒重启一次导致卡顿，所以不是默认。`--buffer-ms` 是按设备时间排序的播放缓冲，用来抚平 Wi‑Fi 突发；`--points` 在 PC 端反投影深度成点云并用 RGB 着色，受 `--points-hz` 限频。
