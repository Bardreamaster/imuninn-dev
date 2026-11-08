// Protobuf schema loaded at runtime from protocol/imuninn.proto (the single source of
// truth) via protobufjs' parser — no generated code to keep in sync.
import protobuf from "protobufjs";
import protoText from "../../../protocol/imuninn.proto?raw";

const root = protobuf.parse(protoText, { keepCase: true }).root;
const ns = "imuninn.v1.";

export const T = {
  DataMessage: root.lookupType(ns + "DataMessage"),
  ControlMessage: root.lookupType(ns + "ControlMessage"),
  ImuSample: root.lookupType(ns + "ImuSample"),
  PoseSample: root.lookupType(ns + "PoseSample"),
  VideoFrame: root.lookupType(ns + "VideoFrame"),
  DepthFrame: root.lookupType(ns + "DepthFrame"),
  DeviceHealth: root.lookupType(ns + "DeviceHealth"),
  Gap: root.lookupType(ns + "Gap"),
  ConfigChanged: root.lookupType(ns + "ConfigChanged"),
};

const toObjectOpts = { longs: Number, enums: Number, defaults: true } as const;

export interface Header { stream_id: string; seq: number; device_time_ns: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Quat extends Vec3 { w: number }
export interface Intrinsics { width: number; height: number; fx: number; fy: number; cx: number; cy: number }
export interface ImuSample { header: Header; accel: Vec3; gyro: Vec3; mag: Vec3 }
export interface PoseSample { header: Header; position: Vec3; orientation: Quat; tracking: number; intrinsics: Intrinsics }
export interface VideoFrame { header: Header; format: number; width: number; height: number; keyframe: boolean; data: Uint8Array; intrinsics: Intrinsics; rotation_deg: number }
export interface DepthFrame { header: Header; width: number; height: number; compression: number; depth_mm: Uint8Array; confidence: Uint8Array; intrinsics: Intrinsics; rotation_deg: number }
export interface DeviceHealth { header: Header; thermal: number; battery_level: number; battery_state: number; low_power_mode: boolean; pose_hz: number; imu_hz: number; video_fps: number; depth_hz: number; video_kbps: number; encoder_dropped: number; uptime_s: number }

export type Body =
  | { kind: "imu"; msg: ImuSample }
  | { kind: "pose"; msg: PoseSample }
  | { kind: "video"; msg: VideoFrame }
  | { kind: "depth"; msg: DepthFrame }
  | { kind: "health"; msg: DeviceHealth }
  | { kind: "gap"; msg: { header: Header; reason: string } }
  | { kind: "config_changed"; msg: unknown };

export const THERMAL = ["?", "nominal", "fair", "serious", "critical"];
export const BATTERY = ["?", "unplugged", "charging", "full"];
export const TRACKING = ["?", "not_available", "limited", "normal"];

export function decode<T>(type: protobuf.Type, bytes: Uint8Array): T {
  return type.toObject(type.decode(bytes), toObjectOpts) as T;
}

/** Decode a wire DataMessage (relay / phone) into its body. */
export function decodeDataMessage(bytes: Uint8Array): Body | null {
  const m = T.DataMessage.decode(bytes) as any;
  for (const kind of ["imu", "pose", "video", "depth", "health", "gap", "config_changed"] as const) {
    if (m[kind] != null) {
      const sub = (T.DataMessage.fields[kind].resolvedType as protobuf.Type);
      return { kind, msg: sub.toObject(m[kind], toObjectOpts) } as Body;
    }
  }
  return null;
}

/** MCAP schema name (e.g. "imuninn.v1.VideoFrame") -> body kind + decoder. */
const schemaKinds: Record<string, Body["kind"]> = {
  ImuSample: "imu", PoseSample: "pose", VideoFrame: "video", DepthFrame: "depth",
  DeviceHealth: "health", Gap: "gap", ConfigChanged: "config_changed",
};

export function decodeBySchema(schemaName: string, bytes: Uint8Array): Body | null {
  const short = schemaName.split(".").pop()!;
  const kind = schemaKinds[short];
  if (!kind) return null;
  const type = root.lookupType(ns + short);
  return { kind, msg: type.toObject(type.decode(bytes), toObjectOpts) } as Body;
}
