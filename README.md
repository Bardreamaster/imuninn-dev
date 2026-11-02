# iMuninn

把手机变成便携的多模态传感器节点：相机、IMU、ARKit/ARCore 位姿和 LiDAR 深度实时传到 PC，通过 Python / C++ / Web 接口交给机器人程序、算法与数据采集流程。

设计文档：[`docs/iMuninn-设计文档.md`](docs/iMuninn-设计文档.md)（原件：[Claude Doc](https://claude.ai/artifact/KZHg3YBu5CtgekPVBK6xBm)）。路线图：[`docs/ROADMAP.md`](docs/ROADMAP.md)。

## 仓库结构

```
protocol/   .proto 定义 + 协议说明 + VERSION（唯一真相源）
mobile/     Expo App；原生数据链路在 modules/muninn-core/
host/       PC 端：python/（网关 + API）、cpp/、bridges/
tools/      代码生成、延迟/带宽测试
docs/
```

## 开发环境

- macOS + Xcode（iOS 优先）。本机 `xcode-select` 指向 CommandLineTools 时，用 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` 前缀运行构建命令。
- Node ≥ 20，`protoc`（`brew install protobuf`），Swift 绑定需 `brew install swift-protobuf`。
- Python ≥ 3.10，推荐 `uv`。

## 快速开始

```bash
tools/gen-proto.sh                       # 生成各语言绑定
cd host/python && uv venv && uv pip install -e ".[dev]" && imuninn gateway
cd mobile && npm install && npx expo run:ios --device   # development build 到真机
```

不支持 Expo Go；只用 development build。

## 许可证

`MIT OR Apache-2.0` 双许可，见 `LICENSE-MIT` 与 `LICENSE-APACHE`。依赖中禁止 GPL 组件。
