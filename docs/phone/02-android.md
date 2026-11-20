# Android

Android 版与 iOS 版功能相同，协议完全一样，`imuninn list` 一样能发现（NsdManager 注册同一个服务）。目前从源码构建（`npx expo run:android`，见 [开发者文档：Android](../dev/05-android.md)），还没有上架。

与 iOS 的差别：

- **AR 模式**用 ARCore，需要手机支持 ARCore 并装有 Google Play Services for AR；不支持的手机只有相机模式。
- **深度**来自 ARCore Depth API（多数机型由运动估计，没有 LiDAR）：打开后要移动手机一两秒才出第一帧，量程和精度低于 LiDAR。`depth.smoothed` 默认开（补全并滤波过的深度图，没有置信度）；关掉得到稀疏的原始深度加置信度。
- **AR 模式下的相机控制**只有对焦（自动 / 固定）和手电，其余由 ARCore 管；相机模式下全部可调。
- **相机参数**映射到 Camera2：手动曝光 / 白平衡 / 对焦分别需要设备支持 `MANUAL_SENSOR`、`MANUAL_POST_PROCESSING`、可变焦镜头，缺失时自动退化为锁定 / 预设 / 自动。
- **相机模式下进出全屏预览或关闭预览**，视频会短暂中断一下（Camera2 要重建采集会话），IMU 和音频不受影响。
