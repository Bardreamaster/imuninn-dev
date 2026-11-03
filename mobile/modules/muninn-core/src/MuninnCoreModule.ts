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

  /** Advertise `_imuninn._tcp` and listen for PC clients. `name` defaults to the device name. */
  startServer(name?: string): void;
  stopServer(): void;

  startSession(): void;
  stopSession(): void;
  startRecording(): void;
  stopRecording(): void;
  listRecordings(): { name: string; bytes: number }[];
  /** Format ids ("WxH@fps") the given lens offers in camera mode. */
  cameraFormats(lens: string): string[];
  /** Revoke the PC client's config lease; the phone UI becomes the writer. */
  takeOver(): void;

  listProfiles(): string[];
  saveProfile(name: string): void;
  applyProfile(name: string): ConfigResult;
  deleteProfile(name: string): void;

  getCapabilities(): Capabilities;
  getConfig(): DeviceConfig;
  setConfig(patch: ConfigPatch): ConfigResult;
}

export default requireNativeModule<MuninnCoreModule>("MuninnCore");
