# imuninn (Python)

PC 端网关与 Python API。见 `docs/iMuninn-设计文档.md` §7。

```bash
cd host/python
uv venv && source .venv/bin/activate
uv pip install -e ".[dev]"
../../tools/gen-proto.sh      # 生成 imuninn/proto/*_pb2.py
imuninn gateway               # 启动网关：mDNS 广播 + 控制通道 WebSocket
```

M0 状态：网关只做 mDNS 广播、接受控制连接、完成 Hello/Welcome 握手并打印设备信息。
