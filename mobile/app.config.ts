import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "iMuninn",
  slug: "imuninn",
  version: "0.0.1",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  ios: {
    bundleIdentifier: "io.imuninn.app",
    supportsTablet: false,
    // Keep screen on while streaming; background capture is a platform limit (§11).
    infoPlist: {
      UIRequiresFullScreen: true,
    },
  },
  android: {
    package: "io.imuninn.app",
    adaptiveIcon: {
      backgroundColor: "#0B0F14",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
  },
  plugins: ["./plugins/withMuninn"],
};

export default config;
