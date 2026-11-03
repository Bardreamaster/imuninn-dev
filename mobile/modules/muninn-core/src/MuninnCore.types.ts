export type Platform = "ios" | "android";

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  /** Hardware identifier, e.g. "iPhone18,1". */
  model: string;
  /** Marketing name, e.g. "iPhone 17 Pro". */
  marketingName: string;
  platform: Platform;
  osVersion: string;
  protocolVersion: number;
  appVersion: string;
  hasLidar: boolean;
  arSupported: boolean;
}

export type TrackingState = "none" | "limited" | "normal";

export interface ClientStatus {
  id: number;
  name: string;
  host: string;
  subscribed: string[];
  udpDropped: number;
  tcpDropped: number;
  writer: boolean;
}

/** Throttled status from native (§4.3): 5 Hz, never per-sample. */
export interface StatusEvent {
  /** "starting" | "listening" | "stopped" | "failed: …" */
  server: string;
  serviceName: string;
  /** "en0 10.0.0.5" per interface, Wi-Fi first. */
  addresses: string[];
  controlPort: number;
  tcpPort: number;
  clients: ClientStatus[];
  mode: "ar" | "camera";
  sessionRunning: boolean;
  tracking: TrackingState;
  poseHz: number;
  imuHz: number;
  videoHz: number;
  videoKbps: number;
  encoderDropped: number;
  recording: boolean;
  recordingFile: string;
  recordingBytes: number;
  configVersion: number;
  remoteControlled: boolean;
  lastError: string;
}

export type ParamKind = "bool" | "int" | "float" | "enum" | "string" | "unknown";
export type ParamValue = boolean | number | string | null;

/** Self-describing parameter (§6.8); UI controls are generated from this. */
export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  kind: ParamKind;
  apply: "immediate" | "restart";
  min: number;
  max: number;
  step: number;
  choices: string[];
  current: ParamValue;
  default: ParamValue;
  readOnly: boolean;
}

export interface StreamDescriptor {
  streamId: string;
  kind: "imu" | "pose" | "video" | "depth" | "other";
  params: ParamSpec[];
}

export interface StreamConfig {
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export interface DeviceConfig {
  configVersion: number;
  mode: "ar" | "camera";
  streams: Record<string, StreamConfig>;
}

export interface Capabilities {
  streams: StreamDescriptor[];
  sessionParams: ParamSpec[];
  config: DeviceConfig;
}

export interface ConfigPatch {
  mode?: "ar" | "camera";
  streams?: Record<string, { enabled?: boolean; params?: Record<string, ParamValue> }>;
}

export interface ConfigResult {
  configVersion: number;
  sessionRestarted: boolean;
  fields: { key: string; status: "applied" | "clamped" | "rejected" | "unknown"; effective: ParamValue; reason: string }[];
}

export type MuninnCoreEvents = {
  onStatus: (e: StatusEvent) => void;
  onConfig: (e: { config: DeviceConfig }) => void;
};
