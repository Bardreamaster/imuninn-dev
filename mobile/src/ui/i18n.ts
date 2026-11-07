// Tiny i18n: two languages, no dependencies. Language follows the system unless the
// user picked one (persisted in UserDefaults via the native module).
import { useCallback, useEffect, useState } from "react";

import { MuninnCore } from "../../modules/muninn-core/src";

export type Lang = "zh" | "en";

const zh = {
  // header / server
  "pcs": (n: number) => `${n} 台 PC`,
  "net.error": "网络错误，重试中",
  "starting": "启动中",
  "stopped": "已停止",
  "controlled.by": (w: string) => `${w} 控制中 · 接管`,
  "server": "服务",
  "status": "状态",
  "bonjour.name": "Bonjour 名称",
  "wifi": "Wi‑Fi",
  "usb": (i: string) => `${i}（USB）`,
  "waiting.pc": "等待 PC 连接：在 PC 上运行 imuninn list / imuninn watch --start",
  "not.subscribed": "未订阅",
  // capture
  "capture": "采集",
  "preview.on": "开启预览",
  "preview.off": "关闭预览",
  "tracking": "追踪",
  "pose": "位姿",
  "imu": "IMU",
  "video": "视频",
  "depth": "深度",
  "encoder.drops": "编码丢帧",
  "recording": "录制中",
  "start": "开始采集",
  "stop": "停止采集",
  "stop.recording": "停止录制",
  "dim.on": "黑屏模式",
  "dim.off": "退出黑屏模式",
  "dim.hint": "黑屏模式：5 秒无操作后熄屏（采集继续），点屏幕唤醒；PC 可用 session.black_screen 远程开关",
  "dim.tap": "采集中 · 点击唤醒",
  "camera.mode": "相机模式",
  "fullscreen": "⤢ 全屏",
  "preview.compact": "▭ 小窗",
  "preview.tall": "□ 大窗",
  "exit.fullscreen": "✕ 退出全屏",
  // config
  "config": "配置",
  "restart.note": "↻ 标记的参数会重启采集会话；镜头 / 相机格式只在纯相机模式显示",
  "profiles": "配置预设",
  "no.profiles": "还没有预设。把当前配置存成一个：",
  "profile.placeholder": "预设名，如 calibration",
  "save.current": "保存当前",
  "profiles.hint": "点一下应用，长按删除。PC 端 imuninn profile 也能推送 YAML 预设。",
  // settings
  "settings": "设置",
  "language": "语言",
  "lang.system": "跟随系统",
  // param labels (by key); unknown keys fall back to the native label
  "p.mode": "会话模式",
  "p.black_screen": "黑屏模式（采集时熄屏，可远程设置）",
  "p.rate_hz": "采样率",
  "p.raw": "原始传感器（未标定）",
  "p.video_format": "AR 视频格式",
  "p.lens": "镜头（仅相机模式）",
  "p.camera_format": "相机格式（仅相机模式）",
  "p.bitrate_kbps": "H.264 码率",
  "p.keyframe_interval": "关键帧间隔",
  "p.exposure_mode": "曝光",
  "p.iso": "ISO（手动）",
  "p.exposure_ms": "快门（手动）",
  "p.exposure_bias": "EV 补偿",
  "p.white_balance_mode": "白平衡",
  "p.wb_temperature_k": "白平衡色温（手动）",
  "p.wb_tint": "白平衡色调（手动）",
  "p.focus_mode": "对焦",
  "p.lens_position": "镜头位置（手动）",
  "p.zoom": "变焦（相机模式）",
  "p.torch": "手电筒（相机模式）",
  "p.hdr": "视频 HDR（相机模式）",
  "p.low_light_boost": "低光增强（相机模式）",
  "p.stabilization": "防抖（相机模式；off 才能保证内参准确）",
  "p.smoothed": "时域平滑",
  "p.compression": "压缩",
  "p.rate_divisor": "每 N 帧发一帧",
  "p.health.rate_hz": "健康状态上报频率",
};

const en: Record<keyof typeof zh, string | ((...a: any[]) => string)> = {
  "pcs": (n: number) => `${n} PC${n === 1 ? "" : "s"}`,
  "net.error": "Network error, retrying",
  "starting": "Starting",
  "stopped": "Stopped",
  "controlled.by": (w: string) => `${w} in control · take over`,
  "server": "Server",
  "status": "Status",
  "bonjour.name": "Bonjour name",
  "wifi": "Wi‑Fi",
  "usb": (i: string) => `${i} (USB)`,
  "waiting.pc": "Waiting for a PC: run imuninn list / imuninn watch --start",
  "not.subscribed": "no subscription",
  "capture": "Capture",
  "preview.on": "Preview on",
  "preview.off": "Preview off",
  "tracking": "Tracking",
  "pose": "Pose",
  "imu": "IMU",
  "video": "Video",
  "depth": "Depth",
  "encoder.drops": "Encoder drops",
  "recording": "Recording",
  "start": "Start capture",
  "stop": "Stop capture",
  "stop.recording": "Stop recording",
  "dim.on": "Black screen",
  "dim.off": "Exit black screen",
  "dim.hint": "Black screen: dark after 5 s idle (capture continues); tap to wake; PC can set session.black_screen",
  "dim.tap": "Capturing · tap to wake",
  "camera.mode": "Camera mode",
  "fullscreen": "⤢ Full screen",
  "preview.compact": "▭ Small",
  "preview.tall": "□ Large",
  "exit.fullscreen": "✕ Exit full screen",
  "config": "Configuration",
  "restart.note": "↻ parameters restart the capture session; lens / camera format only show in camera mode",
  "profiles": "Profiles",
  "no.profiles": "No profiles yet. Save the current configuration as one:",
  "profile.placeholder": "Profile name, e.g. calibration",
  "save.current": "Save current",
  "profiles.hint": "Tap to apply, long-press to delete. The PC can push YAML profiles with imuninn profile.",
  "settings": "Settings",
  "language": "Language",
  "lang.system": "System",
  "p.mode": "Session mode",
  "p.black_screen": "Black screen while capturing (remote-settable)",
  "p.rate_hz": "Sample rate",
  "p.raw": "Raw sensors (uncalibrated)",
  "p.video_format": "AR video format",
  "p.lens": "Lens (camera mode)",
  "p.camera_format": "Camera format (camera mode)",
  "p.bitrate_kbps": "H.264 bitrate",
  "p.keyframe_interval": "Keyframe interval",
  "p.exposure_mode": "Exposure",
  "p.iso": "ISO (manual)",
  "p.exposure_ms": "Shutter (manual)",
  "p.exposure_bias": "EV bias",
  "p.white_balance_mode": "White balance",
  "p.wb_temperature_k": "WB temperature (manual)",
  "p.wb_tint": "WB tint (manual)",
  "p.focus_mode": "Focus",
  "p.lens_position": "Lens position (manual)",
  "p.zoom": "Zoom (camera mode)",
  "p.torch": "Torch (camera mode)",
  "p.hdr": "Video HDR (camera mode)",
  "p.low_light_boost": "Low-light boost (camera mode)",
  "p.stabilization": "Stabilization (camera mode; off keeps intrinsics exact)",
  "p.smoothed": "Temporally smoothed",
  "p.compression": "Compression",
  "p.rate_divisor": "Send every Nth frame",
  "p.health.rate_hz": "Health report rate",
};

const dicts = { zh, en };
type Key = keyof typeof zh;

let current: Lang = detectSystem();
let override: Lang | null = null;
const listeners = new Set<() => void>();

function detectSystem(): Lang {
  try {
    return MuninnCore.uiInfo().language.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function load(): void {
  try {
    const v = MuninnCore.getPreference("lang");
    override = v === "zh" || v === "en" ? v : null;
  } catch {
    override = null;
  }
  current = override ?? detectSystem();
}
load();

export function getLang(): Lang {
  return current;
}

export function getOverride(): Lang | null {
  return override;
}

/** null = follow the system. */
export function setLang(lang: Lang | null): void {
  override = lang;
  current = lang ?? detectSystem();
  try {
    MuninnCore.setPreference("lang", lang ?? "");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function t(key: Key, ...args: any[]): string {
  const v = (dicts[current] as any)[key] ?? (zh as any)[key] ?? key;
  return typeof v === "function" ? v(...args) : v;
}

/** Translated parameter label by stream + key; falls back to the native label. */
export function paramLabel(streamId: string, key: string, fallback: string): string {
  const specific = `p.${streamId}.${key}` as Key;
  const generic = `p.${key}` as Key;
  const d = dicts[current] as any;
  const v = d[specific] ?? d[generic];
  return typeof v === "string" ? v : fallback;
}

/** Re-renders the component when the language changes. */
export function useLang(): [Lang, Lang | null, (l: Lang | null) => void] {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  const set = useCallback((l: Lang | null) => setLang(l), []);
  return [current, override, set];
}
