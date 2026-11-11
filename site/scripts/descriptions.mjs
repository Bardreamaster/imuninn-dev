// Per-page <meta name="description"> for search results and link previews, keyed by site slug.
// sync-docs.mjs writes these into each page's frontmatter. zh is used for the root locale and
// en for /en/ (English translations and the generated English pages copied into both locales).
// Pages missing here fall back to the site-wide description in astro.config.mjs.
export const DESCRIPTIONS = {
  "start/overview": {
    zh: "iMuninn 把 iPhone 变成局域网上的机器人传感器：相机 H.264、IMU、ARKit 6DoF 位姿和 LiDAR 深度，通过 Protobuf 发到 Python、浏览器或 C++。",
    en: "iMuninn turns an iPhone into a network sensor for robots: H.264 camera, IMU, ARKit 6-DoF pose and LiDAR depth over Wi-Fi or USB, received in Python, a browser or C++.",
  },
  "start/install-and-connect": {
    zh: "在 iPhone 上装 iMuninn App，在电脑上装接收端，通过 Wi-Fi 或 USB 线连接，第一次看到相机画面、位姿和 IMU 数据。",
    en: "Install the iMuninn app on the iPhone and a receiver on the PC, connect over Wi-Fi or a USB cable, and see the first video, pose and IMU data.",
  },
  "python/install": {
    zh: "用 pip 或 uv 安装 imuninn Python 包，以及视频解码、MCAP、Rerun、MCP server 等可选依赖。",
    en: "Install the imuninn Python package with pip or uv, plus optional extras for H.264 video decoding, MCAP recording, Rerun and the MCP server.",
  },
  "python/quickstart": {
    zh: "五行 Python 代码连上 iPhone，拿到 ARKit 位姿、IMU、视频和深度；全部是同步 API，不需要 asyncio。",
    en: "Connect to an iPhone and read ARKit pose, IMU, video and depth in five lines of Python. The API is synchronous, no asyncio needed.",
  },
  "python/concepts": {
    zh: "imuninn 的核心概念：数据流与传输方式、可远程修改的参数、YAML 预设、控制租约，以及时间戳和时钟同步。",
    en: "Core concepts of imuninn: streams and their transports, remotely editable parameters, YAML profiles, the control lease, and timestamps and clock sync.",
  },
  "python/video-camera": {
    zh: "从 iPhone 实时接收 H.264 视频并解码成 NumPy；在纯相机模式下切换广角、超广角、长焦镜头，调曝光、白平衡和对焦。",
    en: "Stream H.264 video from an iPhone and decode it to NumPy; in camera mode switch between wide, ultra-wide and telephoto lenses and set exposure, white balance and focus.",
  },
  "python/depth-mcap": {
    zh: "接收 iPhone Pro 的 LiDAR 深度图（毫米与置信度），把所有数据流录成 MCAP，并回放或转换。",
    en: "Receive LiDAR depth maps (millimetres and confidence) from an iPhone Pro, record every stream to MCAP, and replay or convert the recordings.",
  },
  "python/rerun": {
    zh: "用一条命令把 iPhone 的视频、位姿、IMU 和 LiDAR 点云实时显示在 Rerun Viewer 中，支持多台手机和 MCAP 回放。",
    en: "Show an iPhone's video, pose, IMU and LiDAR point cloud live in the Rerun Viewer with one command, with several phones at once or from an MCAP recording.",
  },
  "python/cli": {
    zh: "imuninn command-line reference: list, watch, rerun, record, convert, web, info and profile.",
    en: "Command-line reference for imuninn: list, watch, rerun, record, convert, web, info and profile, with every option.",
  },
  "python/api": {
    zh: "imuninn Python API reference generated from the docstrings: connect(), Device, discovery, video, depth, MCAP and more.",
    en: "Python API reference for imuninn, generated from the docstrings: connect(), Device, discovery, video, depth, MCAP and more.",
  },
  "python/advanced": {
    zh: "imuninn 进阶用法：自己管理 asyncio 事件循环的 PhoneClient、浏览器同款 WebSocket 传输，以及给 AI agent 用的 MCP server。",
    en: "Advanced imuninn: the asyncio PhoneClient for your own event loop, the WebSocket transport used by browsers, and the MCP server for AI agents.",
  },
  "web/web-viewer": {
    zh: "在浏览器里直接查看 iPhone 的视频、深度、3D 位姿轨迹和 IMU 曲线，无需安装；也可以离线回放 MCAP 文件。",
    en: "View an iPhone's video, depth, 3D pose trajectory and IMU plots in a browser with nothing to install, or replay an MCAP file offline.",
  },
  "cpp/cpp-client": {
    zh: "只依赖 protobuf 的 C++ 接收库，实时控制程序可直接链接，收到的消息与 Python 版完全相同。",
    en: "A C++ receiver library that only depends on protobuf, for real-time control programs; it gets the same messages as the Python package.",
  },
  "protocol": {
    zh: "iMuninn 协议规范：控制通道 WebSocket、视频和深度走 TCP、位姿和 IMU 走 UDP，以及握手、版本与时间同步规则。",
    en: "The iMuninn protocol specification: WebSocket control channel, TCP for video and depth, UDP for pose and IMU, handshake, versioning and time sync.",
  },
  "protocol/messages": {
    zh: "Protocol message reference generated from imuninn.proto: every Protobuf message, field and enum.",
    en: "Protocol message reference generated from imuninn.proto: every Protobuf message, field and enum with its comments.",
  },
  "protocol/proto": {
    zh: "iMuninn 协议的 Protobuf 定义文件 imuninn.proto 全文。",
    en: "The full imuninn.proto Protobuf definition of the iMuninn protocol.",
  },
  "phone/ios-app": {
    zh: "iMuninn iOS App 使用说明：服务状态、预览、采集控制、网络地址和全部参数配置，以及前台运行等限制。",
    en: "Using the iMuninn iOS app: server status, preview, capture controls, network addresses and the full configuration, plus limits such as staying in the foreground.",
  },
  "phone/android": {
    zh: "iMuninn Android 版：Camera2 纯相机模式、H.264、IMU，与 iOS 版使用相同的协议。",
    en: "iMuninn for Android: camera-only mode with Camera2, H.264 and IMU, on the same protocol as the iOS app.",
  },
  "phone/privacy": {
    zh: "iMuninn App 隐私政策：不收集任何个人数据，没有账号和服务器，数据只通过局域网发送到你自己的电脑。",
    en: "Privacy policy of the iMuninn app: no personal data is collected, there are no accounts or servers, and data only goes over the local network to your own computer.",
  },
  "agents/mcp": {
    zh: "imuninn-mcp：让 Claude Code 等 AI agent 通过 MCP 工具连接 iPhone、修改参数、截图和录制数据。",
    en: "imuninn-mcp lets AI agents such as Claude Code connect to an iPhone, change parameters, grab frames and record data through MCP tools.",
  },
};
