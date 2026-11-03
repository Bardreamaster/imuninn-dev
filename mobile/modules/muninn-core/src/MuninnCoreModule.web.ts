import { NativeModule, registerWebModule } from "expo";

import type {
  Capabilities,
  ConfigPatch,
  ConfigResult,
  DeviceConfig,
  DeviceInfo,
  MuninnCoreEvents,
} from "./MuninnCore.types";

const emptyConfig: DeviceConfig = { configVersion: 0, mode: "ar", streams: {} };

// Web has no sensor pipeline; exists only so `expo start --web` renders the UI.
class MuninnCoreModule extends NativeModule<MuninnCoreEvents> {
  protocolVersion = 1;
  getDeviceInfo(): DeviceInfo {
    return {
      deviceId: "web",
      deviceName: "browser",
      model: "web",
      marketingName: navigator.userAgent,
      platform: "ios",
      osVersion: "n/a",
      protocolVersion: 1,
      appVersion: "0.0.1",
      hasLidar: false,
      arSupported: false,
    };
  }
  startServer(_name?: string) {}
  stopServer() {}
  startSession() {}
  stopSession() {}
  startRecording() {}
  stopRecording() {}
  listRecordings() {
    return [];
  }
  cameraFormats(_lens: string) {
    return [];
  }
  getCapabilities(): Capabilities {
    return { streams: [], sessionParams: [], config: emptyConfig };
  }
  getConfig(): DeviceConfig {
    return emptyConfig;
  }
  setConfig(_patch: ConfigPatch): ConfigResult {
    return { configVersion: 0, sessionRestarted: false, fields: [] };
  }
}

export default registerWebModule(MuninnCoreModule, "MuninnCore");
