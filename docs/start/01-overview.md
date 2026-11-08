# iMuninn 是什么

iMuninn 把 iPhone 变成网络上的一个传感器节点：相机（H.264）、IMU、ARKit 六自由度位姿（每帧带内参）、LiDAR 深度，通过局域网（Wi‑Fi 或 USB）以 Protobuf 协议发出来。手机是服务端，接收端去连它；多个接收端可以同时连同一台手机。

## 三种接收方式

| 方式 | 适合 | 从哪开始 |
| --- | --- | --- |
| **Python 包** `imuninn` | 写脚本、采数据集、接机器人栈、Rerun 可视化、录 MCAP、给 agent 用的 MCP | [安装](../python/01-install.md) → [快速开始](../python/02-quickstart.md) |
| **Web 查看器** | 随手看一眼画面和曲线，不装任何东西，平板也行 | [Web 查看器](../web/01-web-viewer.md) |
| **C++ 库** | 实时控制程序直接链接 | [C++ 客户端](../cpp/01-cpp-client.md) |

三者收到的是同一套消息（`imuninn.proto`），只是传输层不同：Python / C++ 走 TCP + UDP，浏览器走 WebSocket。

## 能拿到什么

| 流 | 内容 | 典型速率 |
| --- | --- | --- |
| `ar_pose` | ARKit 位姿（右手系、Y 上、相机朝 −Z）+ 相机内参 + 追踪状态 | 60 Hz |
| `imu` | 加速度 + 角速度（CoreMotion 融合值，或原始传感器） | 100–200 Hz |
| `rgb` | H.264 视频，每帧带内参和 `rotation_deg` | 30–60 fps |
| `depth` | LiDAR 深度 256×192，毫米 + 置信度，LZ4 | 60 Hz（Pro 机型） |
| `health` | 热状态、电量、手机端实际帧率、编码丢帧 | 0.2–5 Hz |

所有参数（采样率、分辨率、镜头、曝光 / 白平衡 / 对焦、码率、黑屏模式……）都能从接收端远程改，手机校验后告诉你应用了、钳位了还是拒绝了。

## 实测延迟（iPhone 17 Pro，USB 直连）

| 流 | 单向延迟中位数 |
| --- | --- |
| imu | 2.6 ms |
| ar_pose | 39 ms（主要是 ARKit 自身管线） |
| rgb 1920×1440@60 | 49 ms |
| depth | 44 ms |

Wi‑Fi 下控制往返约 8 ms；3 小时 Wi‑Fi 连续推流视频丢帧 0.04%，手机热状态保持 nominal（充电中）。

## 下一步

1. [装 App、连上手机](02-install-and-connect.md)
2. 选一种接收方式开始
