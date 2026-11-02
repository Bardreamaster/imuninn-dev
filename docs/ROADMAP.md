# 开发路线 M0–M5

设计文档 §10 里的里程碑图表没有随 Markdown 导出，下面是按文档正文推出的版本，验收标准待与原图核对。

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| **M0** | Expo 空壳 + `muninn-core` 本地模块；monorepo 结构；`.proto` 草案；PC 网关骨架（mDNS + 控制通道握手）；双许可证 | `npx expo run:ios` 装到真机，界面显示原生模块返回的设备信息；`imuninn gateway` 能广播并打印收到的 Hello |
| **M1** | 控制通道（握手、能力描述、订阅、时钟同步）；ARKit 位姿 + CoreMotion IMU 走 UDP；远程配置基础版（流开关、帧率、曝光）；Python API 回调/迭代器 | 机器人程序能通过 Python 拿到手机实时位姿；配置改动在 PC 与手机 UI 同步 |
| **M2** | 视频：VideoToolbox H.264 编码一次、网络 + 本地录制分发；PC 端解码；Rerun 出口 | 30 fps 端到端延迟实测并记录；决定是否做 UDP 分片 |
| **M3** | LiDAR 深度（uint16 mm + 置信度，lz4/zstd）；MCAP 原样录制与回放 | 深度与 RGB、位姿按时间戳对齐；MCAP 回放驱动 PC 端测试 |
| **M4** | 配置预设 Profile、租约控制权、纯相机模式（换镜头）；C++ 接收库；bench 工具 | 标定 profile 一键锁定对焦曝光；C++ 实时控制程序直接链接 |
| **M5** | Android 移植（ARCore、MediaCodec、SensorManager）；ROS 2 桥接（可选） | Android 机型跑通 M1–M3 功能 |

## M0 状态（2026-11-03）

- [x] monorepo 结构、`.gitignore`、`LICENSE-MIT` / `LICENSE-APACHE`
- [x] `protocol/imuninn.proto` v1 草案 + `protocol/README.md`
- [x] `mobile/`：Expo SDK 58 空壳、`app.config.ts`、Config Plugin（相机/运动/本地网络/Bonjour/ARKit）
- [x] `mobile/modules/muninn-core/`：薄 Expo 适配层 + `ios/Core/`（Pipeline 骨架、DeviceInfo）
- [x] `host/python/`：`imuninn` 包、`imuninn gateway`（mDNS + Hello/Welcome）
- [x] 模拟器构建验证（iPhone 18 Pro 模拟器，见 `docs/m0-simulator.png`）
- [ ] 真机构建验证（需先 `sudo xcode-select -s /Applications/Xcode.app`）
