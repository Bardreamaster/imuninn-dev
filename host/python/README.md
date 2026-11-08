# imuninn (Python)

PC 端客户端库与命令行工具。见 `docs/design/iMuninn-设计文档.md` §7。

```bash
cd host/python
uv venv && source .venv/bin/activate
uv pip install -e ".[dev,rerun,video,mcap]"
../../tools/gen-proto.sh                 # 生成 imuninn/proto/*_pb2.py

imuninn list                             # Bonjour 发现手机
imuninn watch 手机名或IP --start          # 文本打印样本
imuninn rerun 手机名或IP --start --depth  # Rerun 可视化（位姿、轨迹、视频、深度/点云、IMU、健康）
imuninn rerun 手机A 手机B                 # 多台手机同一个 Viewer
imuninn rerun --mcap run1.mcap           # 回放录制
imuninn record 手机名或IP -o run1.mcap    # 录 MCAP
imuninn profile apply dataset 手机名或IP  # 应用配置预设
```

`imuninn rerun` 的实体布局与选项见 `src/imuninn/rerun_bridge.py` 文件头。视频默认由客户端 PyAV 解码；`--video stream` 把 H.264 直接交给
Viewer 解码（原生 Viewer 需要 PATH 上有 `ffmpeg`，1920×1440@60 时会卡顿），
`--points` 另外在 PC 端把深度反投影成点云（配合 `--video decode` 按 RGB 着色）。
