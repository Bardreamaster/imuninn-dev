# iMuninn

[English](README.md)

把手机变成便携的多模态传感器节点：相机（H.264）、IMU、ARKit / ARCore 位姿（每帧带内参）和 LiDAR 深度，通过 Wi‑Fi 或 USB 以 Protobuf 协议实时传到 PC，经 Python / C++ / 浏览器交给机器人程序、算法与数据采集流程。

- iOS App：[App Store](https://apps.apple.com/app/id6832343388)
- 文档站：<https://imuninn.projects.weijinqi.com>（源文件在 [`docs/`](docs/README.md)）
- Python 包：`pip install imuninn`（[`host/python`](host/python/README.md)）
- Web 查看器：<https://imuninn-webviewer.projects.weijinqi.com>（Safari 可直连；Chrome / Edge 请运行 `imuninn web`）

## 工作方式

手机是服务端：发布 Bonjour 服务 `_imuninn._tcp`，监听控制 WebSocket（7420 端口），接收端去连它，可以多个同时连。位姿、IMU、健康状态走 UDP，视频和深度走 TCP；浏览器则全部走第二条 WebSocket。所有参数自描述、可远程修改，手机逐项校验并回报应用 / 钳位 / 拒绝。

| 流 | 内容 | 典型速率 |
| --- | --- | --- |
| `ar_pose` | ARKit 位姿 + 相机内参 + 追踪状态 | 60 Hz |
| `imu` | 加速度 + 角速度 | 100–200 Hz |
| `rgb` | H.264 视频，每帧带内参 | 30–60 fps |
| `depth` | LiDAR 深度 256×192，毫米 + 置信度，LZ4 | 60 Hz |
| `health` | 热状态、电量、手机端实际帧率 | 0.2–5 Hz |

## 快速开始

```python
import imuninn

with imuninn.connect() as dev:          # 第一台找到的手机；或名字 / IP / "ip:端口"
    dev.start()
    for pose in dev.iter("ar_pose"):
        print(pose.position, pose.intrinsics.fx)
```

```bash
imuninn list                  # 列出局域网里的手机
imuninn rerun --start         # Rerun 实时可视化（pip install "imuninn[rerun]"）
imuninn record -o run1.mcap   # 所有流录成 MCAP（pip install "imuninn[mcap]"）
imuninn web                   # 浏览器查看器 http://localhost:7430
```

## 仓库结构

```
protocol/   imuninn.proto、协议说明、VERSION（唯一真相源）
mobile/     Expo App；原生数据链路在 modules/muninn-core/
host/       PC 端：python/（PyPI 包 imuninn：客户端 API、CLI、MCP server）、cpp/、web/（浏览器查看器）
tools/      代码与文档生成、延迟 / 带宽测试
docs/       文档站内容源；site/ 是 Astro Starlight 站点
```

## 从源码构建

- iOS App：macOS + Xcode，Node ≥ 20。只用 development build，不支持 Expo Go：

  ```bash
  cd mobile && npm install && npx expo run:ios --device
  ```

- Python 包：Python ≥ 3.10，推荐 [uv](https://docs.astral.sh/uv/)。protobuf 绑定已提交在仓库里，只有改了 `protocol/imuninn.proto` 才需要 `protoc`（`tools/gen-proto.sh`）。

  ```bash
  cd host/python && uv venv && uv pip install -e ".[all,dev]" && imuninn list
  ```

- C++ 客户端：CMake + protobuf，见 [`docs/cpp`](docs/cpp/01-cpp-client.md)。

## 许可证

`MIT OR Apache-2.0` 双许可（`LICENSE-MIT`、`LICENSE-APACHE`）。依赖中禁止 GPL 组件。
