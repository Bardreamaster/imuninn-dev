// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Content is generated from ../docs by scripts/sync-docs.mjs (npm run sync).
// Chinese is the root locale; English pages live under docs/en and fall back to Chinese.
const group = (label, en, directory) => ({ label, translations: { en }, items: [{ autogenerate: { directory } }] });

export default defineConfig({
  site: "https://imuninn.projects.weijinqi.com",
  integrations: [
    starlight({
      title: "iMuninn",
      logo: { light: "./src/assets/wordmark-light.svg", dark: "./src/assets/wordmark-dark.svg", replacesTitle: true, alt: "iMuninn" },
      components: { Header: "./src/components/Header.astro" },
      description: "iPhone 作为机器人传感器：相机、IMU、ARKit 位姿、LiDAR 深度",
      defaultLocale: "root",
      locales: {
        root: { label: "中文", lang: "zh-CN" },
        en: { label: "English", lang: "en" },
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Bardreamaster/imuninn" }],
      sidebar: [
        group("开始", "Get started", "start"),
        group("Python 包", "Python package", "python"),
        group("Web 查看器", "Web viewer", "web"),
        group("C++ 库", "C++ library", "cpp"),
        {
          label: "协议",
          translations: { en: "Protocol" },
          items: [
            { label: "协议规范", translations: { en: "Specification" }, slug: "protocol" },
            { label: "消息参考", translations: { en: "Messages" }, slug: "protocol/messages" },
            { label: "imuninn.proto", slug: "protocol/proto" },
          ],
        },
        group("手机端", "Phone apps", "phone"),
        group("开发者", "Developers", "dev"),
        group("Agent", "Agents", "agents"),
        group("设计", "Design", "design"),
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
