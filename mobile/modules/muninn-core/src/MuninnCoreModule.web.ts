import { NativeModule, registerWebModule } from "expo";

import type { DeviceInfo, MuninnCoreEvents } from "./MuninnCore.types";

// Web has no sensor pipeline; exists only so `expo start --web` renders the UI.
class MuninnCoreModule extends NativeModule<MuninnCoreEvents> {
  protocolVersion = 1;
  getDeviceInfo(): DeviceInfo {
    return {
      deviceId: "web",
      deviceName: "browser",
      model: navigator.userAgent,
      platform: "ios",
      osVersion: "n/a",
      protocolVersion: 1,
      appVersion: "0.0.1",
      hasLidar: false,
      arSupported: false,
    };
  }
}

export default registerWebModule(MuninnCoreModule, "MuninnCore");
