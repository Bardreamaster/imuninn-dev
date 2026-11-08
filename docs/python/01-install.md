# 安装

```bash
pip install imuninn                # 核心：发现、连接、配置、位姿 / IMU / 深度解码、命令行
pip install "imuninn[all]"         # 加上视频解码、MCAP、Rerun、MCP server
```

Python 3.10 及以上。推荐用 [uv](https://docs.astral.sh/uv/)：`uv pip install "imuninn[all]"`，或者 `uv tool install "imuninn[all]"` 只装命令行。

## 可选依赖

| extra | 多出来的功能 | 引入的包 |
| --- | --- | --- |
| `video` | H.264 解码成 NumPy（`imuninn.video.H264Decoder`） | PyAV（LGPL 构建的 FFmpeg，不含 x264） |
| `mcap` | `imuninn record / convert / info`，MCAP 回放 | mcap、mcap-protobuf-support |
| `rerun` | `imuninn rerun` 实时可视化与 MCAP 回放 | rerun-sdk、PyAV |
| `mcp` | `imuninn-mcp`，让 agent 直接操作手机 | mcp、Pillow |
| `all` | 以上全部 | |

核心依赖只有 protobuf、websockets、zeroconf、numpy、lz4、pyyaml。

## 从源码安装

```bash
git clone https://github.com/Bardreamaster/imuninn
cd imuninn/host/python
uv venv && source .venv/bin/activate
uv pip install -e ".[all,dev]"
```

生成的 protobuf 绑定已经在仓库里，不需要 protoc；改了 `protocol/imuninn.proto` 才要跑 `tools/gen-proto.sh`（见 [开发者 · Python 包开发](../dev/08-python-dev.md)）。

## 验证

```bash
imuninn --version
imuninn list                       # 手机开着 App 时应列出来
```

找不到手机时按 IP 连：`imuninn watch 10.0.0.5:7420`。地址在手机 App 的「服务」卡片里。
