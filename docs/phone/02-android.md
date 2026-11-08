# Android

Android 版目前只有**纯相机模式**（Camera2 + MediaCodec H.264、IMU、健康状态、配置 / 预设 / 租约），没有 ARCore 位姿和深度（需要真机继续开发）。和 PC 端的协议完全相同，`imuninn list` 一样能发现（NsdManager 注册同一个服务）。

相机参数映射到 Camera2：手动曝光 / 白平衡 / 对焦分别需要设备支持 `MANUAL_SENSOR`、`MANUAL_POST_PROCESSING`、可变焦镜头，缺失时自动退化为锁定 / 预设 / 自动。

构建、模拟器测试和与 iOS 的差异见[开发者 · Android](../dev/05-android.md)。
