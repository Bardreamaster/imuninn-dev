import { NativeModule, requireNativeModule } from "expo";

import type {
  Capabilities,
  ConfigPatch,
  ConfigResult,
  DeviceConfig,
  DeviceInfo,
  MuninnCoreEvents,
} from "./MuninnCore.types";

declare class MuninnCoreModule extends NativeModule<MuninnCoreEvents> {
  protocolVersion: number;
  getDeviceInfo(): DeviceInfo;

  startDiscovery(): void;
  stopDiscovery(): void;
  /** Connect to a gateway found by discovery, by its service name. */
  connectToGateway(name: string): boolean;
  connectToHost(host: string, port: number): void;
  disconnect(): void;

  startSession(): void;
  stopSession(): void;
  startRecording(): void;
  stopRecording(): void;
  listRecordings(): { name: string; bytes: number }[];
  /** Format ids ("WxH@fps") the given lens offers in camera mode. */
  cameraFormats(lens: string): string[];

  getCapabilities(): Capabilities;
  getConfig(): DeviceConfig;
  setConfig(patch: ConfigPatch): ConfigResult;
}

export default requireNativeModule<MuninnCoreModule>("MuninnCore");
