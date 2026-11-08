# Rerun 可视化

```bash
pip install "imuninn[rerun]"
imuninn rerun --start                    # 连第一台手机，启动 Rerun Viewer，开始采集
imuninn rerun iPhone --depth --points    # 开深度，PC 端反投影成点云
imuninn rerun 手机A 手机B                 # 多台手机同一个 Viewer
imuninn rerun --mcap run1.mcap           # 回放录制
imuninn rerun --save run1.rrd iPhone     # 不开窗口，直接写 .rrd
```

## Viewer 里的布局

每台手机一棵子树（`<dev>` 是设备名）：

| 实体 | 内容 |
| --- | --- |
| `world/<dev>` | 相机位姿（ARKit 相机坐标系） |
| `world/<dev>/trajectory` | 相机轨迹 |
| `world/<dev>/cam` + `/video` | 针孔相机 + 图像 |
| `world/<dev>/depth/image`、`/confidence` | 深度（米）与置信度 |
| `world/<dev>/points` | 深度反投影点云（`--points`，用 RGB 着色） |
| `plots/<dev>/imu/*`、`pose/tracking`、`health/*` | IMU 曲线、追踪状态、热状态 / 电量 / 帧率 |
| `events/<dev>` | 追踪 / 热状态 / 低电量变化、丢帧、配置变更 |

时间轴：`pc`（墙钟，多台手机共用）和 `device`（手机单调时钟）。

## 选项

| 选项 | 作用 |
| --- | --- |
| `--video decode`（默认） | 本机 PyAV 解码再送图像，稳定 60 fps |
| `--video stream` | 把 H.264 直接交给 Viewer 解码；原生 Viewer 要 PATH 上有 `ffmpeg`，1920×1440@60 会卡顿 |
| `--every N` | 每 N 帧解一帧，省 CPU |
| `--scale 0.5` | 解码后缩放再送 Viewer（默认 0.5，内参同步缩放） |
| `--buffer-ms 150` | 播放缓冲：按设备时间顺序延迟 N 毫秒释放，抚平 Wi‑Fi 突发到达 |
| `--points` / `--point-stride` / `--points-hz` | 点云、点云抽样步长、点云与置信度图的频率上限（默认 10 Hz） |
| `--no-trajectory` / `--no-blueprint` | 不画轨迹 / 不用预设布局 |
| `--port` | 用自己的 Viewer 端口（默认 9876） |
| `--seconds N` | 跑 N 秒后退出 |

全部选项见 [CLI 参考](07-cli.md#imuninn-rerun)。
