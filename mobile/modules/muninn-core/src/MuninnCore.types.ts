export type Platform = "ios" | "android";

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  model: string;
  platform: Platform;
  osVersion: string;
  protocolVersion: number;
  appVersion: string;
  hasLidar: boolean;
  arSupported: boolean;
}

/** Throttled status from native (§4.3): never per-sample. */
export interface StatusEvent {
  connected: boolean;
  fps: number;
  bitrateKbps: number;
  tracking: "none" | "limited" | "normal";
  dropRate: number;
  recording: boolean;
}

export type MuninnCoreEvents = {
  onStatus: (e: StatusEvent) => void;
};
