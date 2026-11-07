import { NativeModule, registerWebModule } from "expo";

import type {
  Capabilities,
  ConfigPatch,
  ConfigResult,
  DeviceConfig,
  DeviceInfo,
  MuninnCoreEvents,
} from "./MuninnCore.types";

const emptyConfig: DeviceConfig = { configVersion: 0, mode: "ar", session: {}, streams: {} };

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
  setPreview(_enabled: boolean) {}
  startSession() {}
  stopSession() {}
  startRecording() {}
  stopRecording() {}
  listRecordings() {
    return [];
  }
  getPreference(key: string) {
    try { return localStorage.getItem("imuninn." + key); } catch { return null; }
  }
  setPreference(key: string, value: string) {
    try { localStorage.setItem("imuninn." + key, value); } catch { /* ignore */ }
  }
  getScreenBrightness() {
    return 1;
  }
  setScreenBrightness(_value: number) {}
  systemLanguage() {
    return navigator.language;
  }
  cameraFormats(_lens: string) {
    return [];
  }
  takeOver() {}
  listProfiles() {
    return [] as string[];
  }
  saveProfile(_name: string) {}
  applyProfile(_name: string): ConfigResult {
    return { configVersion: 0, sessionRestarted: false, fields: [] };
  }
  deleteProfile(_name: string) {}
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
