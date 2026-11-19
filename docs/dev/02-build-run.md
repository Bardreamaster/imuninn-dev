# 02 · 构建与运行

所有命令在仓库根目录执行，除非写明。

## 手机端（iOS）

### 日常：改了 TS/UI 代码

不用重新构建。Metro 热更新即可：

```bash
cd mobile && npx expo start
```

然后在手机上打开 iMuninn（Debug 包启动时会连 Mac 上的 Metro，手机和 Mac 必须在同一局域网，或插线）。

### 改了原生代码（Swift / Kotlin）或 Config Plugin / app.config.ts

必须重新编译安装：

```bash
cd mobile
npx expo run:ios --device          # 列出设备让你选；或 --device <UDID>
```

`expo run:ios` 会自动 `prebuild`（重新生成 `mobile/ios/`）、`pod install`、编译、安装、启动 Metro。

查 UDID：

```bash
xcrun devicectl list devices
```

### 开发版与正式版（`APP_VARIANT`）

App Store 版和自己编译的包默认是同一个 Bundle ID，装开发包会原地覆盖商店版。要让两者并存，用开发版变体构建：

```bash
cd mobile
APP_VARIANT=dev npx expo prebuild --platform ios --clean
APP_VARIANT=dev npx expo run:ios --device <UDID>
```

| | 正式版（默认，不设变量） | 开发版（`APP_VARIANT=dev`） |
| --- | --- | --- |
| Bundle ID / Android package | `com.weijinqi.projects.imuninn` | `com.weijinqi.projects.imuninn.dev` |
| 桌面名称 | iMuninn | iMuninn Dev |
| 图标 | `assets/icon.png` | `assets/icon-dev.png`（底部红色 DEV 条） |

要点：

- 变体在 `mobile/app.config.ts` 里读环境变量决定，写进生成的 `mobile/ios/`（开发版的工程名也随之变成 `iMuninnDev`）。**切换变体后必须重新 `prebuild --clean`**，并且 `prebuild` 和 `run:ios` 两条命令都要带同一个变量（`run:ios` 会重新读配置）。
- 开发版是另一个 App：设置、配置档不与正式版共享，首次启动要重新授予相机、运动、本地网络权限。
- 两个 App 默认都用 7420（控制）和 7422（数据）端口。挂在后台的那个可能还占着端口，这时前台的 App 会自动改用空闲端口（日志 `control port 7420 in use; using a free port`），Bonjour 广播的是真实端口，`imuninn list` 能看到；用 IP 直连时要写成 `IP:端口`，端口在 App 的 Server 卡片里。App Store 0.1.0 进后台不释放端口，之后的版本会释放。两个 App 的 Bonjour 设备名相同，PC 端分不出版本，以手机屏幕为准。
- 开发版的 Bundle ID 由 Xcode 自动签名在团队下注册，不需要在 App Store Connect 建记录。
- **发版归档前确认是正式配置**：不带 `APP_VARIANT` 重新 `prebuild --clean`，检查 `grep PRODUCT_BUNDLE_IDENTIFIER mobile/ios/*.xcodeproj/project.pbxproj` 没有 `.dev`。带着 `.dev` 上传会被 App Store Connect 拒绝（没有对应的 App 记录）。
- 涉及旧数据迁移的改动，发版前用正式配置在测试机上覆盖安装验证一次，开发版验证不了升级路径。
- Android 的开发版目前只改了 package 和名称，图标没有角标。
- 改图标：角标是 `icon.png` 上移 70 px 后在底部叠一条 232 px 高的 `#FF5A52` 色带加 DEV 字样，`icon.png` 变了要重新生成 `icon-dev.png`。

### 模拟器（无 AR / LiDAR，只能验证 UI 与 JS↔原生桥）

```bash
cd mobile && npx expo run:ios      # 默认选一个已安装的模拟器
```

### Release 包（不依赖 Metro，JS 打进 App，可离线运行）

```bash
cd mobile && npx expo run:ios --device --configuration Release
```

### 什么时候要重新 prebuild

`mobile/ios/` 和 `mobile/android/` 是生成物，**不要手改**，也不入库。以下改动后要重新生成：

- `app.config.ts`（Bundle ID、权限文案、Team ID…）
- `plugins/withMuninn.ts`
- 新增 npm 原生依赖

```bash
cd mobile && npx expo prebuild --platform ios --clean
```

## 手机端（Android）

环境安装和模拟器用法见 [Android](05-android.md)。日常：

```bash
cd mobile && npx expo run:android          # 改了 Kotlin / 插件后；自动 prebuild + gradle
adb forward tcp:7420 tcp:7420 && adb forward tcp:7422 tcp:7422   # 模拟器：PC 用 127.0.0.1 连
```

## PC 端（Python 客户端）

```bash
cd host/python
source .venv/bin/activate
imuninn list                        # 发现手机（Bonjour）
imuninn watch --start               # 连第一台，开始采集，打印样本
imuninn rerun --start               # Rerun 可视化
```

测试：

```bash
cd host/python && .venv/bin/pytest -q
```

## C++ 库与 bench

```bash
cd host/cpp && cmake -S . -B build -DCMAKE_PREFIX_PATH=/opt/homebrew && cmake --build build -j8
./build/imuninn_watch <手机IP> 5
host/python/.venv/bin/python tools/bench/latency.py --seconds 10 --depth
```

## 协议改动流程

1. 改 `protocol/imuninn.proto`
2. `protocol/VERSION` 数字 +1，同时改 `host/python/src/imuninn/__init__.py` 的 `PROTOCOL_VERSION`、`DeviceInfo.swift` 的 `protocolVersion`、`MuninnCoreModule.kt` 的 `PROTOCOL_VERSION`
3. `tools/gen-proto.sh`
4. 三端改动放同一个 commit

版本历史：v3 加 `health` 流；v4 加 `DeviceConfig.session_params`（会话级开关，如 `black_screen`；`mode` 仍是独立字段）。Android 端的 `Protocol.kt` 还是 v3，Python 连 Android 会打一条 protocol mismatch 警告但不影响使用。

## 目录速查

| 想改什么 | 去哪 |
| --- | --- |
| 界面、交互 | `mobile/App.tsx` |
| JS 调用原生的接口 | `mobile/modules/muninn-core/src/` |
| iOS 采集 / 编码 / 网络 | `mobile/modules/muninn-core/ios/Core/`（纯 Swift） |
| iOS 暴露给 Expo 的桥 | `mobile/modules/muninn-core/ios/MuninnCoreModule.swift` |
| Android 采集 / 编码 / 网络 | `mobile/modules/muninn-core/android/src/main/java/expo/modules/muninncore/core/`（纯 Kotlin） |
| Android 暴露给 Expo 的桥 | `.../muninncore/MuninnCoreModule.kt` |
| 权限、Info.plist、Bonjour | `mobile/plugins/withMuninn.ts` |
| 协议 | `protocol/imuninn.proto` |
| PC 网关 | `host/python/src/imuninn/` |
