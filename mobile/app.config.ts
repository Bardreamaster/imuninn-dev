import type { ExpoConfig } from "expo/config";

// APP_VARIANT=dev builds a separate "iMuninn Dev" app (own bundle ID, badged icon) that
// installs next to the App Store version. Unset = the release identity; see
// docs/dev/02-build-run.md. Re-run prebuild after switching.
const dev = process.env.APP_VARIANT === "dev";
const appId = "com.weijinqi.projects.imuninn" + (dev ? ".dev" : "");

const config: ExpoConfig = {
  name: dev ? "iMuninn Dev" : "iMuninn",
  slug: "imuninn",
  version: "0.1.0",
  orientation: "default",   // follows the system rotation lock; layout adapts in App.tsx
  icon: dev ? "./assets/icon-dev.png" : "./assets/icon.png",
  userInterfaceStyle: "automatic", // theme.ts follows the system appearance (useColorScheme)
  ios: {
    bundleIdentifier: appId,
    appleTeamId: "NHCF5WN8GK",
    supportsTablet: false,
    buildNumber: "2",
    // Keep screen on while streaming; background capture is a platform limit (§11).
    infoPlist: {
      // Only Apple-provided TLS/none: no export-compliance questions on each upload.
      ITSAppUsesNonExemptEncryption: false,
      UIRequiresFullScreen: true,
      // Lists the app under Settings > iMuninn > Language (iOS per-app language);
      // the in-app picker (src/ui/i18n.ts) overrides it when set.
      CFBundleLocalizations: ["en", "zh-Hans"],
      CFBundleDevelopmentRegion: "en",
    },
  },
  android: {
    package: appId,
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
