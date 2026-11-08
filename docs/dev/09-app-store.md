# App Store 上架资料

App Store Connect 里要填的文案和设置，复制粘贴用。主语言建议英文，简体中文作为本地化。

## 基本信息

| 项 | 值 |
| --- | --- |
| 名称 | iMuninn（被占用时用 iMuninn Sensor Stream） |
| Bundle ID | 见 `mobile/app.config.ts` 的 `ios.bundleIdentifier` |
| SKU | imuninn-ios |
| 主类别 / 次类别 | 开发者工具 Developer Tools / 工具 Utilities |
| 价格 | 免费 |
| 年龄分级 | 问卷全部选「无」→ 4+ |
| 版权 | 2026 Jinqi Wei |
| 隐私政策 URL | https://imuninn.projects.weijinqi.com/en/phone/privacy/ |
| 支持 URL | https://github.com/Bardreamaster/imuninn/issues |
| 营销 URL | https://imuninn.projects.weijinqi.com |
| App 隐私 | 「不收集数据」（App 不联网、没有统计 / 广告 SDK） |
| 加密出口 | `ITSAppUsesNonExemptEncryption = false`，上传时不再询问 |
| 设备 | 仅 iPhone（`supportsTablet: false`），需要 ARKit |

## English

**Subtitle** (≤30): `iPhone as a robot sensor`

**Promotional text** (≤170):

> Stream camera, IMU, ARKit pose and LiDAR depth from your iPhone to Python, C++ or a browser on your computer, with millisecond-level latency over Wi‑Fi or USB.

**Keywords** (≤100): `ARKit,LiDAR,IMU,robotics,sensor,depth,pose,SLAM,ROS,dataset,streaming,camera,Python,MCAP,6DoF`

**Description**:

> iMuninn turns your iPhone into a networked sensor for robotics, research and data collection.
>
> Open the app and your computer can connect to it over the local network (Wi‑Fi or USB). iMuninn streams:
>
> • ARKit 6‑DoF pose with per-frame camera intrinsics, up to 60 Hz
> • IMU: accelerometer and gyroscope, 100–200 Hz
> • H.264 video up to 1920×1440 at 60 fps
> • LiDAR depth with confidence on Pro models, 60 Hz
> • Device health: thermal state, battery, actual frame rates
>
> On the computer, receive the data with the open-source Python package (pip install imuninn), the C++ library, or the web viewer. Record MCAP files, visualize in Rerun, feed your robot stack, or let an AI agent use it through MCP.
>
> Every setting — sample rates, resolution, lens, exposure, white balance, focus, bitrate — can be changed remotely from the computer. Several computers can connect to the same phone at once.
>
> Privacy: iMuninn has no account and no server and never connects to the internet. Data goes only to computers you connect on your own network.
>
> iMuninn is open source (MIT OR Apache-2.0). Documentation: imuninn.projects.weijinqi.com

## 简体中文

**副标题**（≤30）：`把 iPhone 变成机器人传感器`

**推广文本**（≤170）：

> 把 iPhone 的相机、IMU、ARKit 位姿和 LiDAR 深度实时传到电脑上的 Python、C++ 或浏览器，Wi‑Fi 或 USB 直连，毫秒级延迟。

**关键词**（≤100）：`ARKit,LiDAR,IMU,机器人,传感器,深度,位姿,SLAM,ROS,数据采集,推流,相机,Python,MCAP,六自由度`

**描述**：

> iMuninn 把 iPhone 变成网络上的传感器节点，用于机器人、科研和数据采集。
>
> 打开 App，电脑就能通过局域网（Wi‑Fi 或 USB）连上手机。iMuninn 实时发送：
>
> • ARKit 六自由度位姿，每帧带相机内参，最高 60 Hz
> • IMU：加速度计和陀螺仪，100–200 Hz
> • H.264 视频，最高 1920×1440 60 fps
> • LiDAR 深度和置信度（Pro 机型），60 Hz
> • 设备状态：热状态、电量、实际帧率
>
> 电脑端用开源的 Python 包（pip install imuninn）、C++ 库或 Web 查看器接收。可以录 MCAP、用 Rerun 可视化、接入机器人程序，也可以通过 MCP 交给 AI agent 使用。
>
> 采样率、分辨率、镜头、曝光、白平衡、对焦、码率等所有参数都能在电脑端远程修改；多台电脑可以同时连同一台手机。
>
> 隐私：iMuninn 没有账号、没有服务器、不连接互联网，数据只发给你在自己网络里连接的电脑。
>
> iMuninn 开源（MIT OR Apache-2.0）。文档：imuninn.projects.weijinqi.com

## 审核备注（App Review Information → Notes）

App 单独打开只会显示相机预览和服务状态，审核员需要一台接收端才能看到完整功能，所以备注里要写清楚怎么测，最好再附一段演示视频（屏幕录制 + 电脑端画面）。

> iMuninn is a sensor app for developers: the iPhone acts as a server on the local network and a computer connects to it to receive camera, IMU, ARKit pose and LiDAR depth data. No account or login is needed.
>
> To test without a computer: open the app, allow Camera, Motion and Local Network access, and tap "Start capture". The preview, tracking state and live data rates (pose / IMU / video / depth) are shown on screen.
>
> To test the full stream from a Mac on the same Wi‑Fi:
> 1. pip install imuninn
> 2. imuninn list (or use the phone's IP address shown in the Service card)
> 3. imuninn web (opens the viewer in the browser), then enter the phone address to see the live video and sensor plots
>
> A demo video is attached. The app never connects to the internet; Local Network access is only used for the computer to discover and connect to the phone.

联系信息填自己的姓名、电话和邮箱；不需要演示账号（取消勾选 Sign-in required）。

## 截图

需要 6.9 英寸（1320 × 2868 竖屏）一组，3–10 张；更小尺寸会自动缩放。iPhone 17 Pro 截图是 1206 × 2622，等比放大到 1320 × 2868 即可（比例差 < 0.1%）。建议内容：

1. 采集中的预览 + 实时速率（AR 模式）
2. 服务卡片：Bonjour 名称、地址、已连接的 PC
3. 配置卡片：远程可调的参数
4. 电脑端 Web 查看器或 Rerun 画面（可以作为最后一张，展示接收端效果）
