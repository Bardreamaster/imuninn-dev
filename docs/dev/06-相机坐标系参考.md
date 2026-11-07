# iPhone 相机坐标系参考（带出处）

> 整理于 2026-11-07。每条结论后面附 Apple 官方原文（英文原样引用）和链接。
> 标 **【官方】** 的是 Apple 文档、WWDC 视频或 Apple 新闻稿原文；标 **【Apple 工程师】** 的是 Apple 开发者论坛上带 Apple 标识的回复；标 **【推导】** 的是根据官方原文推出来、Apple 没有直接写出的结论；标 **【无官方说法】** 的是查不到 Apple 表述的地方；标 **【真机实测】** 的是本项目在真机上测得的结果。
>
> Apple 文档会更新，链接指向 developer.apple.com 的当前版本。抓取方式：`https://developer.apple.com/tutorials/data/documentation/<路径>.json` 可以拿到页面原文，方便以后复查。

## 0. 一页总结

| 坐标系 | 原点 | +X | +Y | +Z | 参考姿态 | 出处 |
|---|---|---|---|---|---|---|
| 传感器原生图像（CVPixelBuffer、ARFrame.capturedImage、pointOfInterest、intrinsics） | 左上角 | 向右 | 向下 | （2D） | 横屏、Home 键/底部在右（landscapeRight） | §1、§2 |
| ARKit 相机坐标（ARCamera.transform 的局部系） | 相机光心 | 沿长边从前摄指向 Home 键/底部 | 横屏（底部在右）时朝上 | 指向屏幕一侧（相机朝 −Z） | 同上 | §3.2 |
| ARKit 世界坐标（`.gravity`，默认） | 会话开始时设备位置 | 水平，右手系补全 | 与重力相反（朝上） | 水平，会话开始时相机朝向的反方向 | — | §3.1 |
| Core Motion 设备坐标（加速度计、陀螺仪、CMDeviceMotion.gravity） | 设备中心 | 竖屏时朝右 | 竖屏时朝上（指向听筒/顶部） | 垂直屏幕朝外 | 竖屏 | §4 |
| Core Motion 姿态参考系（CMAttitude 的 reference frame） | — | 任意 / 磁北 / 真北 | 水平 | 竖直（朝上） | — | §4 |

协调者初步版本的核实结果：

1. **"相机坐标 x 朝右、y 朝上、z 朝屏幕外，以 landscapeRight 为准"**：对 **ARKit** 成立。需要补两点：ARKit 相机朝 **−Z** 看（Z 朝屏幕一侧，也就是朝用户）；`ARCamera.transform` 的文档写的是 UIDevice 的 `landscapeLeft`，它和 UIInterface/AVCapture 的 `landscapeRight` 是**同一个物理姿态**（Home 键在右、前摄在左），只是两套枚举命名相反。这条**不适用**于 AVCameraCalibrationData 和 OpenCV 风格的内参，那边图像 y 朝下（见 §2.4）。
2. **"CVPixelBuffer 原点在左上角"**：结论成立，但 **CVPixelBuffer 自己的文档没写"左上角"**，只说 base address 指向像素 (0,0)。"左上角"出自内参、pointOfInterest、displayTransform 等文档的表述（见 §2.1）。

---

## 1. 传感器安装方向与原生方向

### 1.1 传感器原生方向是横屏 【官方】

- **CGImagePropertyOrientation**（ImageIO）
  > "For example, the pixel data for an image captured by an iOS device camera is encoded in the camera sensor's native landscape orientation. When the user captures a photo while holding the device in portrait orientation, iOS writes an orientation value of `right` in the resulting image file."
  — https://developer.apple.com/documentation/imageio/cgimagepropertyorientation

- **WWDC23 Session 10106《Support external cameras in your iPadOS app》**（讲 RotationCoordinator 的部分，以 iPhone 相机 app 为例）
  > "The UIKit coordinate system's origin is at the top left of the drawing area, where its positive x-axis extends to the right and positive y-axis extends down. The back camera sensor's coordinate system has a different origin. The camera sensor first scans along the height of the phone, then along the width. To account for the physical orientation of the camera, the app rotates the camera's video frames 90 degrees for preview in the UI."
  >
  > "When the iPhone is in the camera sensor's native orientation, the app does not need to rotate photos or movies for them to appear upright."
  — https://developer.apple.com/videos/play/wwdc2023/10106

  "先沿手机的长边扫描"说明图像的行（宽度方向）沿手机长边，即竖屏拿手机时得到的是横向的原始帧。

### 1.2 后摄的原生方向 = Home 键在右的横屏 【官方】

- **AVCaptureDevice.focusPointOfInterest / exposurePointOfInterest**
  > "This property's CGPoint value uses a coordinate system where {0,0} is the top-left of the picture area and {1,1} is the bottom-right. This coordinate system is always relative to a landscape device orientation with the home button on the right, regardless of the actual device orientation."
  — https://developer.apple.com/documentation/avfoundation/avcapturedevice/focuspointofinterest
  — https://developer.apple.com/documentation/avfoundation/avcapturedevice/exposurepointofinterest

- **ARConfiguration.WorldAlignment.camera**
  > "Camera alignment defines a coordinate system based on the native sensor orientation of the device camera. Relative to a landscapeRight-oriented camera image, the x-axis points to the right, the y-axis points up, and the z-axis points out the front of the device (toward the user)."
  — https://developer.apple.com/documentation/arkit/arconfiguration/worldalignment-swift.enum/camera

- 三套"landscape"枚举的物理含义（容易混）：
  - `UIInterfaceOrientation.landscapeRight`："The device is in landscape mode, with the device upright and the Home button on the right." — https://developer.apple.com/documentation/uikit/uiinterfaceorientation/landscaperight
  - `UIDeviceOrientation.landscapeLeft`："The device is in landscape mode, with the device held upright and the front-facing camera on the left side." — https://developer.apple.com/documentation/uikit/uideviceorientation/landscapeleft
  - `AVCaptureVideoOrientation.landscapeRight`："Indicates that video should be oriented horizontally, top on the left." — https://developer.apple.com/documentation/avfoundation/avcapturevideoorientation/landscaperight

  【推导】前三者描述的是同一个物理姿态：手机横拿，Home 键 / 底部 / 充电口在右，前摄和顶部在左。

### 1.3 前摄的原生方向 【无官方说法】→ 替代来源

- Apple 文档没有单独写前摄的原生方向。pointOfInterest 文档说"always relative to ... home button on the right"，但没区分前后摄。
- 开发者论坛（非 Apple 员工）讨论：前摄连接默认 `videoOrientation` 为 `landscapeLeft`、后摄为 `landscapeRight`；帖内没有 Apple 员工答复，只能当经验。— https://developer.apple.com/forums/thread/106891
- **iPhone 17 前摄方向变了** 【Apple 工程师】：论坛里 Apple "Media Engineer" 对 iPhone 17 上 `videoRotationAngleForHorizonLevelCapture` 和旧机型不同的回答：
  > "The difference in rotation angle is expected on iPhone 17 due to a different sensor rotation. … To achieve best performance, set your video rotation angle on your video data output's connection to 0 — which will result in unrotated video from the source. But be aware that the source might come from a different sensor rotation with respect to the phone."
  — https://developer.apple.com/forums/thread/813548

- **iPhone 17 Pro 前摄实测** 【真机实测，2026-11-07】：手机竖拿时，前摄和后摄送出的缓冲区方向一致，都要**顺时针转 90°** 才是正向，所以前摄的 `rotation_deg` 也是 90，不是早先注释里写的 270。`protocol/imuninn.proto` 的 `VideoFrame` 注释已按此修改（提交 c42e160）。
  - 这和上面 Apple 工程师说的"iPhone 17 sensor rotation 不同"相符：旧机型前摄的经验值（landscapeLeft / 270）在 iPhone 17 上不再成立。
  - 只测了 iPhone 17 Pro。旧机型的前摄没有实测，社区经验是 270（见上面的论坛帖）。
  - 建议仍在运行时从 `AVCaptureDevice.RotationCoordinator` 取角度，不按机型写死。

### 1.4 三颗后摄的长宽比 【无官方说法】→ 替代来源

- Apple 的技术规格页和开发者文档**不公布**各颗传感器的物理长宽比，只给像素数（如 "48MP Fusion Main camera"）。— https://www.apple.com/newsroom/2025/09/apple-debuts-iphone-17/
- **唯一有官方表述的长宽比是 iPhone 17 前摄** 【官方】：
  > "The Center Stage front camera features the first square front camera sensor on iPhone"
  — https://www.apple.com/newsroom/2025/09/apple-debuts-iphone-17/
- 后摄主摄 / 超广角 / 长焦：社区普遍认为都是 4:3（最大照片 4032×3024、8064×6048 等都是 4:3），但这是从输出格式反推的，不是传感器规格。iFixit 拆机报告给出模组照片，不标长宽比和安装朝向，**不能作为可靠来源**。
- **最可靠的办法是在真机上查**：遍历 `AVCaptureDevice.formats`，读 `CMVideoFormatDescriptionGetDimensions(format.formatDescription)` 和 `format.supportedMaxPhotoDimensions`。最大尺寸的长宽比就是该镜头对外暴露的传感器有效区域长宽比。
  — https://developer.apple.com/documentation/avfoundation/avcapturedevice/format/supportedmaxphotodimensions

### 1.5 物理安装方向（模组在机身里怎么摆）【无官方说法】

Apple 不公开传感器的机械安装方向。能确定的只是 §1.1–1.2 的**软件可见方向**（图像行沿长边、原生朝向为 Home 键在右的横屏）。对写代码来说这就够了，因为所有 API 都按这个约定给数据。

---

## 2. AVFoundation / CVPixelBuffer 图像坐标

### 2.1 像素坐标原点：左上角，x 向右，y 向下

- **CVPixelBufferGetBaseAddress** 【官方】只说 (0,0) 是 base address 指向的像素，没说是哪个角：
  > "For chunky buffers, returns a pointer to the pixel at (0,0) in the buffer."
  — https://developer.apple.com/documentation/corevideo/cvpixelbuffergetbaseaddress(_:)
  CVPixelBuffer 主页只写 "The pixel buffer stores an image in main memory."（https://developer.apple.com/documentation/corevideo/cvpixelbuffer）。**CVPixelBuffer 文档本身没有"左上角"的说法。**

- "左上角"出自以下文档 【官方】：
  - AVCameraCalibrationData.intrinsicMatrix："The `ox` and `oy` values are the offsets of the principal point, from the top-left corner of the image frame. The principal point is relative to the top-left corner of the top-left pixel. Each pixel value represents a sampled value from the center of that pixel." — https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/intrinsicmatrix
  - ARFrame.displayTransform："Normalized image coordinates range from (0,0) in the upper left corner of the image to (1,1) in the lower right corner." — https://developer.apple.com/documentation/arkit/arframe/displaytransformfororientation:viewportsize:
  - pointOfInterest："{0,0} represents the top-left and {1,1} represents the bottom-right of the unrotated image." — https://developer.apple.com/documentation/avfoundation/avcapturevideopreviewlayer/capturedevicepointconverted(fromlayerpoint:)

  【推导】这些 API 描述的就是 CVPixelBuffer 里的那张图，所以第 0 行 = 图像顶部，(0,0) = 左上角，x 向右、y 向下。注意：像素 (0,0) 的**中心**在连续坐标 (0.5, 0.5)。

- 注意：Vision 可以选左下原点（`CoordinateOrigin.lowerLeft`，旧版 VN API 的归一化坐标默认左下），Core Image 也是左下原点。从这两者拿到的坐标要翻转 y。— https://developer.apple.com/documentation/vision/coordinateorigin

### 2.2 videoRotationAngle 【官方】

- **AVCaptureConnection.videoRotationAngle**
  > "Only 0, 90, 180, and 270 are valid angles."
  > "Connections to AVCaptureVideoDataOutput and AVCaptureDepthDataOutput instances deliver physically rotated buffers instead, which costs work on every frame."
  > "If your app rotates buffers itself, set videoRotationAngle to 0 to keep the connection from rotating them again. If your app applies a coordinator's angles with its own math, account for the property's current value. Account for it on every device rather than only the devices where the default differs, which keeps the same code correct as hardware changes."
  — https://developer.apple.com/documentation/avfoundation/avcaptureconnection/videorotationangle

  要点：VideoDataOutput 设了角度会**真的旋转像素**（每帧都有开销）；Movie/Photo 输出只写元数据。**默认值不保证是 0，各机型可能不同**，要读出来而不是假设。

- **ARKit 的角度约定**（新 API `viewRotationAngle`）：
  > "The view angle, in degrees, is the clockwise rotation needed to keep the camera image level with the horizon (0 LandscapeRight, 90 Portrait, 180 LandscapeLeft, 270 PortraitUpsideDown)."
  — https://developer.apple.com/documentation/arkit/arframe/displaytransform(viewrotationangle:viewportsize:)

  【推导】即 0° = 原生方向（landscapeRight），竖屏要顺时针转 90°。这和 proto 里"后摄 90"一致。

- **RotationCoordinator**：
  > "A class that monitors the physical orientation of a capture device and provides adjustment angles to keep images level, relative to gravity."
  — https://developer.apple.com/documentation/avfoundation/avcapturedevice/rotationcoordinator
  WWDC23 10106："Rely on it to provide angles rather than trying to calculate them yourself. As your app switches cameras, be sure to create a new rotation coordinator."

### 2.3 videoMirrored 【官方】

> "Capture connections to AVCaptureVideoDataOutput and AVCaptureDepthDataOutput instances mirror video frames they provide to their … delegate methods"
— https://developer.apple.com/documentation/avfoundation/avcaptureconnection/isvideomirrored

前摄若打开镜像，像素 x 方向被翻转，内参的 cx 也要相应变成 `W − cx`（【推导】）。

### 2.4 AVCameraCalibrationData 内参与外参 【官方】

- **intrinsicMatrix**：
  > "The intrinsic matrix allows you to transform 3D coordinates to 2D coordinates on an image plane using the pinhole camera model. … The equation expresses all values in pixels. The values fx and fy are the pixel focal length, and are identical for square pixels. The ox and oy values are the offsets of the principal point, from the top-left corner of the image frame."
  — https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/intrinsicmatrix

- **intrinsicMatrixReferenceDimensions**：
  > "The intrinsicMatrix property measures focal length and principal point offset in pixels, but those values are meaningful only in the context of an image of this size."
  — https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/intrinsicmatrixreferencedimensions
  WWDC17 507："Typically, they're the full size of the sensor"（通常是传感器全尺寸，用于低分辨率深度图时要自己缩放）。

- **extrinsicMatrix**：
  > "The extrinsic matrix consists of a unitless 3 x 3 rotation matrix (R) on the left and a 3 x 1 column vector translation (t) on the right. The translation vector's units are millimeters."
  > "The camera's pose is expressed with respect to a reference camera (camera-to-world view). If the rotation matrix is an identity matrix, then this camera is the reference camera."
  > "A matrix_float4x3 matrix is column major with 3 rows and 4 columns."
  — https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/extrinsicmatrix
  WWDC17 507《Capturing Depth in iPhone Photography》（以双摄为例）："the tele camera is the origin of the world when you're using the dual camera … If you're working with wide and tele, then the wide will, of course, not be an identity matrix" — https://developer.apple.com/videos/play/wwdc2017/507/
  多摄设备上谁是参考相机随机型而变，**以 R 是否为单位阵判断**。

- **lensDistortionCenter**：
  > "Due to geometric distortions in the image, the center of the distortion may not be equal to the optical center (principal point) of the lens. When making an image rectilinear, use the distortion center rather than the optical center of the image."
  — https://developer.apple.com/documentation/avfoundation/avcameracalibrationdata/lensdistortioncenter

- **逐帧内参**：`AVCaptureConnection.isCameraIntrinsicMatrixDeliveryEnabled` 打开后，每个样本缓冲带 `kCMSampleBufferAttachmentKey_CameraIntrinsicMatrix`。WWDC17 507："These are all in pixel values and they're given at the resolution of the video buffer with which they're provided."
  — https://developer.apple.com/documentation/avfoundation/avcaptureconnection/iscameraintrinsicmatrixdeliveryenabled

- **3D 相机坐标轴方向 【无官方说法】**：AVCameraCalibrationData 文档没写 3D 相机系的 x/y/z 指向。【推导】由于主点从图像左上角量起、像素 y 向下，且是标准针孔模型 `u = fx·X/Z + ox`，对应的就是 OpenCV 约定：x 右、y 下、z 指向场景（前方）。外参的旋转方向（camera-to-world）有官方原文，但轴向是这一推导。

---

## 3. ARKit

### 3.1 世界坐标 【官方】

- 总则（Understanding World Tracking）：
  > "In all AR experiences, ARKit uses world and camera coordinate systems following a right-handed convention: the y-axis points upward, and (when relevant) the z-axis points toward the viewer and the x-axis points toward the viewer's right."
  — https://developer.apple.com/documentation/arkit/understanding-world-tracking

- `.gravity`（默认）：
  > "The y-axis matches the direction of gravity as detected by the device's motion sensing hardware; that is, the vector (0,-1,0) points downward. … For the z-axis, ARKit chooses a basis vector (0,0,-1) pointing in the direction the device camera faces and perpendicular to the gravity axis."
  — https://developer.apple.com/documentation/arkit/arconfiguration/worldalignment-swift.enum/gravity

- `.gravityAndHeading`：
  > "(That is, the positive x-, y-, and z-axes point east, up, and south, respectively.)"
  — https://developer.apple.com/documentation/arkit/arconfiguration/worldalignment-swift.enum/gravityandheading

- 单位：米（ARKit 通用约定，文档各处 transform 均以米计，此处不单列）。

### 3.2 相机坐标：ARCamera.transform 【官方】

> "The position and orientation of the camera in world coordinate space."
> "This transform creates a local coordinate space for the camera that is constant with respect to device orientation. In camera space, the x-axis points to the right when the device is in UIDeviceOrientation.landscapeLeft orientation—that is, the x-axis always points along the long axis of the device, from the front-facing camera toward the Home button. The y-axis points upward (with respect to landscapeLeft orientation), and the z-axis points away from the device on the screen side."
— https://developer.apple.com/documentation/arkit/arcamera/transform

要点：
- 它是 **camera-to-world**（相机在世界中的位姿），不是 view matrix。view matrix 用 `viewMatrix(viewRotationAngle:)`，它还带了界面方向的旋转。
- 这里的 `landscapeLeft` 是 **UIDeviceOrientation**，物理上 = Home 键在右 = AVCapture/UIInterface 的 `landscapeRight`（§1.2）。
- 相机看向 **−Z**（Z 指向屏幕一侧）。【官方】world alignment `.camera` 原文也说 "the z-axis points out the front of the device (toward the user)"。

### 3.3 ARCamera.intrinsics 与 imageResolution 【官方】

> "The values fx and fy are the pixel focal length, and are identical for square pixels. The values ox and oy are the offsets of the principal point from the top-left corner of the image frame. All values are expressed in pixels."
— https://developer.apple.com/documentation/arkit/arcamera/intrinsics

> "This size describes the image in the capturedImage buffer, which contains image data in the camera device's native sensor orientation."
— https://developer.apple.com/documentation/arkit/arcamera/imageresolution

- 内参对应 `capturedImage` 的原生横向图像，**不随设备方向旋转**；`ARKit 的 capturedImage` 已是校正后的图像，`MnIntrinsics.distortion` 为空与此相符（ARKit 没提供畸变参数）。

### 3.4 ARKit 相机系 ↔ 内参/图像系：需要翻转 Y、Z

- 【官方，Apple 示例代码】Apple 的点云示例（Visualizing a Point Cloud Using Scene Depth 旧版，代码在论坛帖中被原样引用）：
  ```swift
  // flip to ARKit Camera's coordinate
  let flipYZ = matrix_float4x4(
      [1, 0, 0, 0],
      [0, -1, 0, 0],
      [0, 0, -1, 0],
      [0, 0, 0, 1] )
  ```
  — https://developer.apple.com/forums/thread/671932 （引用的示例代码）；现行示例说明：https://developer.apple.com/documentation/arkit/displaying-a-point-cloud-using-scene-depth
  现行示例的 shader 用 `xrw = (pos.x − cx) * depth / fx; yrw = (pos.y − cy) * depth / fy; xyz = {xrw, yrw, depth}` 反投影，即**内参系为 x 右、y 下、z 前**，进入 ARKit 相机系前需乘 `diag(1, −1, −1)`。

- 所以：`P_world = ARCamera.transform · diag(1,−1,−1,1) · [ (u−cx)·d/fx, (v−cy)·d/fy, d, 1 ]ᵀ`，(u, v) 是 capturedImage 原生像素坐标。（【推导】由上面两段官方原文组合得出。）

### 3.5 displayTransform 【官方】

> "This method creates an affine transform representing the rotation and aspect-fit crop operations necessary to adapt the camera image to the specified orientation and to the aspect ratio of the specified viewport. The affine transform does not scale to the viewport's pixel size."
> "The capturedImage pixel buffer is the original image captured by the device camera, and thus not adjusted for device orientation or view aspect ratio."
— https://developer.apple.com/documentation/arkit/arframe/displaytransformfororientation:viewportsize:

新 API（以角度代替枚举）：
> "The display transform can be used to convert normalized points in the image-space coordinate system of the captured image to normalized points in the view's coordinate space. The transform provides the correct rotation and aspect-fill for presenting the captured image in the given view angle and size."
— https://developer.apple.com/documentation/arkit/arframe/displaytransform(viewrotationangle:viewportsize:)

注意：旧文档写 "aspect-fit crop"，新文档写 "aspect-fill"，实际行为是**裁切填满**（填满视口、超出部分裁掉）。输入输出都是 0–1 归一化坐标，原点左上。

### 3.6 设备坐标

ARKit **没有**单独暴露"设备坐标系"。离设备最近的是 ARCamera.transform 的相机系（§3.2），它以后摄光心为原点、按横屏定义轴。【无官方说法】ARKit 文档没有给出相机光心到 IMU 或机身中心的偏移。

---

## 4. Core Motion 与 ARKit 的区别

### 4.1 设备坐标系 【官方】

`CMMotionManager` 文档 "Identify the coordinate axes of the device" 一节附图（iPhone 竖屏）：**+X 指向右侧，+Y 指向顶部（听筒方向），+Z 垂直屏幕朝外**。
— https://developer.apple.com/documentation/coremotion/cmmotionmanager
（图注原文："An illustration showing iPhone, iPad, Apple Watch, and Apple Vision Pro with labels representing the positive x-axis, positive y-axis, and positive z-axis on each device."）

加速度单位：
> "The values reported by the accelerometers are measured in increments of the gravitational acceleration, with the value 1.0 representing an acceleration of 9.8 meters per second (per second) in the given direction."
— https://developer.apple.com/documentation/coremotion/getting-raw-accelerometer-events

### 4.2 CMAttitude 的参考系 【官方】

> "The default frame of reference is xArbitraryZVertical, which places the z-axis perpendicular to the ground and matches the x- and y-axes to the device's current orientation in space."
— https://developer.apple.com/documentation/coremotion/getting-processed-device-motion-data

> "xMagneticNorthZVertical: A reference frame where the Z axis is vertical and the X axis points to the magnetic north pole."
— https://developer.apple.com/documentation/coremotion/cmattitudereferenceframe/xmagneticnorthzvertical

> "Core Motion outputs a direction cosine matrix (DCM)—basically a rotation from the last "old" orientation to the new orientation of the device."
— https://developer.apple.com/documentation/coremotion/cmattitude

【无官方说法】`CMAttitude.rotationMatrix` 是"参考系→设备"还是"设备→参考系"，文档没有明确写（只说是 DCM）。使用前应用重力向量自测：`CMDeviceMotion.gravity`（"The gravity acceleration vector expressed in the device's reference frame." — https://developer.apple.com/documentation/coremotion/cmdevicemotion/gravity）平放时应为 (0, 0, −1)，用它和 rotationMatrix 乘出的结果比对方向。

### 4.3 对照

| | Core Motion | ARKit |
|---|---|---|
| 竖直轴 | **Z** 竖直（参考系） | **Y** 朝上（世界系） |
| 机身坐标的参考姿态 | 竖屏（X 右、Y 顶、Z 屏外） | 横屏，Home 键在右（X 指向 Home 键、Y 朝上、Z 屏外） |
| 原点 | 无平移，只有姿态 | 有平移，原点 = 会话开始时设备位置，单位米 |
| 航向 | 可选磁北 / 真北 / 任意 | `.gravity` 任意、`.gravityAndHeading` 真北（−Z 指北，+X 指东） |
| 数据来源 | IMU 融合（加速度计、陀螺仪、磁力计） | 视觉惯性里程计（相机 + IMU） |

**Core Motion 设备系 → ARKit 相机系的轴映射**（【推导】由 §3.2 与 §4.1 两段官方原文推出）：
横拿手机、Home 键在右时，设备 +Y（顶部）指向左，设备 +X（竖屏右侧）指向上。ARKit 相机 +X 从前摄指向 Home 键，即设备 −Y；ARKit 相机 +Y 朝上，即设备 +X；两者 Z 相同。

```
x_cam = −y_dev
y_cam =  x_dev
z_cam =  z_dev
R_cam←dev = [[0,−1,0],[1,0,0],[0,0,1]]   （行列式 +1，右手系一致）
```

这只是**轴向**关系。IMU 与相机之间的平移和微小安装误差，Apple 不公开（【无官方说法】）。

---

## 5. 对 iMuninn 的建议

1. 真机实测 iPhone 17 Pro 前后摄的 `rotation_deg` 都是 90，proto 注释已改（§1.3）。为兼容其他机型（旧机型前摄可能是 270），手机端最好发送 RotationCoordinator 当时给出的 `videoRotationAngleForHorizonLevelCapture`，并把 video data output 连接的 `videoRotationAngle` 固定设为 0（§2.2）。
2. 设计文档 §6.6 "Y 轴向上、相机朝 −Z" 与 ARKit 官方原文一致；PC 端转 OpenCV 时用 §3.4 的 `diag(1,−1,−1)`。
3. 内参始终对应原生横向图像（§3.3）。如果哪天打开 `videoRotationAngle ≠ 0` 或镜像，内参要同步变换。
4. 各镜头的长宽比在真机上用 `AVCaptureDevice.formats` 查，不要按经验写死（§1.4）。
