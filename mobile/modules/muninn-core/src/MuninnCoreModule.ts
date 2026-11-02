import { NativeModule, requireNativeModule } from "expo";

import type { DeviceInfo, MuninnCoreEvents } from "./MuninnCore.types";

declare class MuninnCoreModule extends NativeModule<MuninnCoreEvents> {
  protocolVersion: number;
  getDeviceInfo(): DeviceInfo;
}

export default requireNativeModule<MuninnCoreModule>("MuninnCore");
