# AGENTS.md — 在 iMuninn 仓库里工作的约定

## 项目一句话

iPhone 作为网络传感器（相机 / IMU / ARKit 位姿 / LiDAR 深度），Protobuf 协议，PC 用 Python 接。手机是服务端，PC 是客户端。设计文档：`docs/design/iMuninn-设计文档.md`；里程碑状态：`docs/design/ROADMAP.md`。

## 仓库地图

```
protocol/imuninn.proto     唯一真相源；改它要 bump protocol/VERSION 和三处 PROTOCOL_VERSION
mobile/App.tsx             手机 UI（只收 5 Hz 状态，不碰数据）
mobile/modules/muninn-core/ios/Core/   全部原生数据链路（纯 Swift，不依赖 Expo）
mobile/modules/muninn-core/ios/MuninnCoreModule.swift   Expo 薄适配层
mobile/plugins/withMuninn.ts           Info.plist / 权限 / Bonjour 注入（不要手改 mobile/ios/）
host/python/src/imuninn/   PC 客户端：client.py（asyncio）、session.py（同步 API）、cli.py
docs/{user,dev,agents,design}/
```

## 常用命令

```bash
tools/gen-proto.sh                                   # 改 .proto 后
cd host/python && .venv/bin/python -m pytest -q      # PC 端测试（假手机）
cd mobile && npx tsc --noEmit -p .                   # TS 类型检查
cd mobile && npx expo run:ios --device <UDID> --no-bundler   # 原生代码改动后装真机（先 pod install 若新增 Swift 文件）
cd mobile && npx expo start                          # 只改 TS 时热更新
host/python/.venv/bin/imuninn list                   # 发现手机
host/python/.venv/bin/imuninn watch --start          # 连上并打印样本
```

新增 Swift 文件后要在 `mobile/ios` 里 `pod install`，否则 Xcode 看不到。

## 不变量（改代码前确认不破坏）

1. 图像帧和逐样本 IMU **不进 JS**。
2. 原生核心（`Core/`）**不 import ExpoModulesCore**。
3. 每个 Sink 自己丢弃，不能阻塞 Source；视频只丢非关键帧并请求关键帧。
4. 配置改动一律经 `ConfigStore.apply` → `applyChanges` → `ConfigChanged` 广播；UI 和 PC 不走旁路。
5. 不持有 `ARFrame`。
6. 依赖里不能出现 GPL（x264 等）。PyAV 用 LGPL 轮子。
7. `mobile/ios/`、`mobile/android/`、`*_pb2.py`、`imuninn.pb.swift` 是生成物，不提交。

## 验证标准

- Python：`pytest` 全绿。
- iOS：真机能装、App 显示 listening、`imuninn watch --start` 能收到位姿 60 Hz / IMU 100 Hz / 视频 60 fps 且 drop=0。
- 改了协议：三端同一个 commit。

## 当前状态与下一步

见 `docs/design/ROADMAP.md`。M5（Android）搁置，没有测试机。
