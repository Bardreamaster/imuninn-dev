# Install

```bash
pip install imuninn                # core: discovery, connection, config, pose / IMU / depth decoding, CLI
pip install "imuninn[all]"         # + video decoding, MCAP, Rerun, MCP server
```

Python 3.10 or newer. With [uv](https://docs.astral.sh/uv/): `uv pip install "imuninn[all]"`, or `uv tool install "imuninn[all]"` for the command line only.

## Extras

| extra | adds | brings in |
| --- | --- | --- |
| `video` | H.264 decoding to NumPy (`imuninn.video.H264Decoder`) | PyAV (LGPL FFmpeg build, no x264) |
| `mcap` | `imuninn record / convert / info`, MCAP replay | mcap, mcap-protobuf-support |
| `rerun` | `imuninn rerun` live viewer and MCAP playback | rerun-sdk, PyAV |
| `mcp` | `imuninn-mcp`, an MCP server so agents can drive the phone | mcp, Pillow |
| `all` | everything above | |

The core depends only on protobuf, websockets, zeroconf, numpy, lz4 and pyyaml. The browser viewer (`imuninn web`) is part of the core: static files served from localhost that connect straight to the phone.

## From source

```bash
git clone https://github.com/Bardreamaster/imuninn
cd imuninn/host/python
uv venv && source .venv/bin/activate
uv pip install -e ".[all,dev]"
```

The generated protobuf bindings are committed, so protoc is only needed after editing `protocol/imuninn.proto` (`tools/gen-proto.sh`).

## Check

```bash
imuninn --version
imuninn list                       # lists phones running the app
```

If discovery finds nothing, connect by address: `imuninn watch 10.0.0.5:7420`. The address is shown in the app's "Server" card.
