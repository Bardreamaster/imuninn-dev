// Config plugin: inject every native entitlement / permission iMuninn needs so the
// prebuild-generated ios/ and android/ folders are never edited by hand (§6.7, §11).
import {
  withAndroidManifest,
  withInfoPlist,
  type ConfigPlugin,
} from "expo/config-plugins";

export const BONJOUR_SERVICE = "_imuninn._tcp";

const withMuninnIos: ConfigPlugin = (config) =>
  withInfoPlist(config, (c) => {
    const plist = c.modResults;
    plist.NSCameraUsageDescription =
      "iMuninn streams the camera to your computer over the local network.";
    plist.NSMotionUsageDescription =
      "iMuninn streams IMU (accelerometer / gyroscope) data to your computer.";
    plist.NSLocalNetworkUsageDescription =
      "iMuninn discovers and connects to the iMuninn gateway on your local network.";
    const existingBonjour = (plist.NSBonjourServices as string[] | undefined) ?? [];
    plist.NSBonjourServices = Array.from(new Set([...existingBonjour, BONJOUR_SERVICE]));
    // ARKit + LiDAR are required in AR mode; keep the App Store filter honest.
    const existingCaps = (plist.UIRequiredDeviceCapabilities as string[] | undefined) ?? [];
    plist.UIRequiredDeviceCapabilities = Array.from(new Set([...existingCaps, "arkit"]));
    return c;
  });

const withMuninnAndroid: ConfigPlugin = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    const perms = new Set(
      (manifest["uses-permission"] ?? []).map((p) => p.$["android:name"]),
    );
    for (const name of [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
      "android.permission.ACCESS_NETWORK_STATE",
      "android.permission.ACCESS_WIFI_STATE",
      "android.permission.CHANGE_WIFI_MULTICAST_STATE", // mDNS
      "android.permission.HIGH_SAMPLING_RATE_SENSORS",
    ]) {
      if (!perms.has(name)) {
        manifest["uses-permission"] = [
          ...(manifest["uses-permission"] ?? []),
          { $: { "android:name": name } },
        ];
      }
    }
    // ARCore: optional at install time so the app still launches on devices without GMS.
    const app = manifest.application?.[0];
    if (app) {
      app["meta-data"] = [
        ...(app["meta-data"] ?? []).filter(
          (m) => m.$["android:name"] !== "com.google.ar.core",
        ),
        { $: { "android:name": "com.google.ar.core", "android:value": "optional" } },
      ];
    }
    return c;
  });

const withMuninn: ConfigPlugin = (config) =>
  withMuninnAndroid(withMuninnIos(config));

export default withMuninn;
