import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "iMuninn",
  slug: "imuninn",
  version: "0.0.1",
  orientation: "default",   // follows the system rotation lock; layout adapts in App.tsx
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic", // theme.ts follows the system appearance (useColorScheme)
  ios: {
    bundleIdentifier: "com.weijinqi.projects.imuninn",
    appleTeamId: "NHCF5WN8GK",
    supportsTablet: false,
    // Keep screen on while streaming; background capture is a platform limit (§11).
    infoPlist: {
      UIRequiresFullScreen: true,
      // Lists the app under Settings > iMuninn > Language (iOS per-app language);
      // the in-app picker (src/ui/i18n.ts) overrides it when set.
      CFBundleLocalizations: ["en", "zh-Hans"],
      CFBundleDevelopmentRegion: "en",
    },
  },
  android: {
    package: "com.weijinqi.projects.imuninn",
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
