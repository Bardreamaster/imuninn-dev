# 03 · 常见问题

### App 打开就报错 / 红屏 "Could not connect to development server"

Debug 包需要 Mac 上的 Metro。在 `mobile/` 下 `npx expo start`，再重开 App。手机和 Mac 要在同一 Wi‑Fi，或插线。不想依赖 Metro 就打 Release 包（见 02）。

### `xcodebuild requires Xcode, but active developer directory is CommandLineTools`

```bash
sudo xcode-select -s /Applications/Xcode.app
```

### `No profiles for 'com.weijinqi.projects.imuninn' were found` / `No Account for Team`

描述文件没生成。命令行 `xcodebuild` 读不到 Xcode 里登录的 Apple ID，首次必须在 Xcode 图形界面 ⌘R 一次（见 01）。之后命令行即可用。

### `No code signing certificates are available`

Xcode 没登录 Apple ID，或登录了但还没在 Signing & Capabilities 里选过 Team。见 01 的"真机调试"。

### Xcode 提示工程文件 "disappeared"

`expo prebuild` 重新生成了 `mobile/ios/`，旧窗口失效。关掉窗口重新 `open mobile/ios/iMuninn.xcworkspace`。

### 手机上 App 打不开，提示"不受信任的开发者"

设置 → 通用 → VPN与设备管理 → 点你的 Apple ID → 信任。

### 7 天后 App 打不开

免费账号签名过期。重新 `npx expo run:ios --device` 装一次。

### `pod install` 报 UTF-8 / encoding

症状：`Unicode Normalization not appropriate for ASCII-8BIT (Encoding::CompatibilityError)`，Homebrew 的 Ruby 4 + CocoaPods 1.17 在 `LANG` 为空时必现；`npx expo run:ios` 内部也会跑 `pod install`，所以表现为整个构建失败。只影响终端环境，不影响项目和产物。

`export LANG=en_US.UTF-8`（写进 `~/.zprofile` 或 `~/.zshrc`），或者单次 `LANG=en_US.UTF-8 npx expo run:ios …`。

### 界面上型号显示 "iPhone18,1" 之类

那是苹果硬件标识符，比市场名大一代（`iPhone18,1` = iPhone 17 Pro）。界面另有一行 model 显示市场名；未知机型会回退显示标识符，去 `DeviceInfo.swift` 的表里加一条即可。

### 模拟器上 AR / LiDAR 显示 false

正常，模拟器没有 ARKit。要看真实值必须上真机。

### App 切到后台再回来，状态胶囊显示网络错误 / 连不上

iOS 挂起 App 时会收回监听 socket 并让硬件编码器会话失效。2026-11-05 起 App 回到前台时会无条件重建控制 / 数据监听、重建编码器并恢复采集，实测后台 60 s 后回前台 2 s 内可重新连接，四路流全速。PC 端客户端需要重新 `connect()`（挂起期间的连接已断）。不支持后台采集：切走就停，回来再开。

### `imuninn list` 找不到手机

手机 App 要在前台且“服务”卡片显示 listening；PC 和手机同一 Wi‑Fi，或用 USB 线直连（会出现 169.254 地址）。企业 Wi‑Fi 常屏蔽 mDNS，此时手输手机屏幕上显示的地址：`imuninn watch 10.0.0.5:7420`。

### zeroconf 报 `No route to host`

某个虚拟网卡（VPN、Docker）不可达。网关已限定只在主网卡上广播；若仍报错，用 `--port` 无关，检查 `ifconfig` 里是否有多个 inet 地址，必要时在 `gateway.py` 的 `_local_ip()` 里固定网卡。

### 找不到 `protoc`

```bash
brew install protobuf
```
