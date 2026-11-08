// Two-language UI (zh / en). Static text: elements with data-i18n / data-i18n-placeholder /
// data-i18n-title. Dynamic text: t(key). The choice is remembered in localStorage.

const dict = {
  zh: {
    title: "iMuninn Web Viewer",
    addr_placeholder: "手机地址，例如 10.0.0.5（App「服务」卡片里显示）",
    connect: "连接", disconnect: "断开", start: "开始采集", stop: "停止",
    depth: "深度", depth_ar_only: "深度只有 AR 模式才有", mode_ar: "AR 模式", mode_camera: "相机模式",
    orient: "画面", orient_auto: "自动（重力）", orient_portrait: "竖屏", orient_land_l: "横屏（左）", orient_land_r: "横屏（右）", orient_upside: "倒置",
    open_mcap: "打开 MCAP", replay_done: "回放结束", replay: "回放",
    video: "视频", depth_panel: "深度", pose: "位姿（3D，拖动旋转 · 滚轮缩放）", imu: "IMU", health: "设备状态", log: "日志",
    dropped: "丢", low_power: "低电量模式", via_relay: "经中继", direct: "直连",
    https_hint: "Safari 可直接连手机；Chrome / Edge 请运行",
    https_hint_tail: "，然后从 localhost 打开本页。",
    no_webcodecs: "此浏览器没有 WebCodecs，视频不能解码（Chrome / Edge / Safari 16.4+ 可用）",
    need_target: "请填手机地址，例如 10.0.0.5 或 10.0.0.5:7420",
    open_failed: "打开 MCAP 失败", thermal: "热状态", battery: "电量", phone_rates: "手机端速率", video_rate: "视频", uptime: "运行时间",
    grid: "网格 1 m", tracking: "追踪",
    subtitle_idle: "浏览器查看器 · 协议 v5", connection: "连接", preview: "预览", capture: "采集", mode: "模式",
    pose_hz: "位姿", dropped_frames: "丢帧（本端）", st_disconnected: "未连接", st_connecting: "连接中", st_connected: "已连接", st_replay: "回放中", st_error: "连接失败",
  },
  en: {
    title: "iMuninn Web Viewer",
    addr_placeholder: "phone address, e.g. 10.0.0.5 (shown in the app's Server card)",
    connect: "Connect", disconnect: "Disconnect", start: "Start capture", stop: "Stop",
    depth: "Depth", depth_ar_only: "Depth is only available in AR mode", mode_ar: "AR mode", mode_camera: "Camera mode",
    orient: "View", orient_auto: "Auto (gravity)", orient_portrait: "Portrait", orient_land_l: "Landscape (left)", orient_land_r: "Landscape (right)", orient_upside: "Upside down",
    open_mcap: "Open MCAP", replay_done: "replay finished", replay: "replay",
    video: "Video", depth_panel: "Depth", pose: "Pose (3D, drag to orbit · wheel to zoom)", imu: "IMU", health: "Device", log: "Log",
    dropped: "dropped", low_power: "low power mode", via_relay: "via relay", direct: "direct",
    https_hint: "Safari can connect to the phone directly; in Chrome / Edge run",
    https_hint_tail: " and open this page from localhost.",
    no_webcodecs: "No WebCodecs in this browser: video cannot be decoded (Chrome / Edge / Safari 16.4+)",
    need_target: "Enter the phone address, e.g. 10.0.0.5 or 10.0.0.5:7420",
    open_failed: "cannot open MCAP", thermal: "thermal", battery: "battery", phone_rates: "phone rates", video_rate: "video", uptime: "uptime",
    grid: "grid 1 m", tracking: "tracking",
    subtitle_idle: "browser viewer · protocol v5", connection: "Connection", preview: "Preview", capture: "Capture", mode: "Mode",
    pose_hz: "Pose", dropped_frames: "Dropped (here)", st_disconnected: "Disconnected", st_connecting: "Connecting", st_connected: "Connected", st_replay: "Replaying", st_error: "Connection failed",
  },
};
export type Lang = keyof typeof dict;
type Key = keyof typeof dict.zh;

let lang: Lang = (localStorage.getItem("imuninn.lang") as Lang) || (navigator.language.startsWith("zh") ? "zh" : "en");

export function t(key: Key): string { return dict[lang][key] ?? dict.zh[key] ?? key; }
export function currentLang(): Lang { return lang; }

export function applyLang(next?: Lang): void {
  if (next) { lang = next; try { localStorage.setItem("imuninn.lang", next); } catch { /* private mode */ } }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n as Key); });
  document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => { (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder as Key); });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle as Key); });
  const b = document.getElementById("lang");
  if (b) b.textContent = lang === "zh" ? "EN" : "中";
}
