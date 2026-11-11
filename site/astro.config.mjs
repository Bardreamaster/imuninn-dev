// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { existsSync, readdirSync } from "node:fs";

// Content is generated from ../docs by scripts/sync-docs.mjs (npm run sync).
// Chinese is the root locale; English pages live under docs/en and fall back to Chinese.
// A section exists when ../docs/<dir> has at least one page; the public mirror omits some sections.
const hasPages = (dir) => existsSync(`../docs/${dir}`) && readdirSync(`../docs/${dir}`).some((f) => f.endsWith(".md") && f !== "README.md");
const group = (label, en, directory) => hasPages(directory) ? { label, translations: { en }, items: [{ autogenerate: { directory } }] } : null;

export default defineConfig({
  site: "https://imuninn.projects.weijinqi.com",
  integrations: [
    starlight({
      title: "iMuninn",
      logo: { light: "./src/assets/wordmark-light.svg", dark: "./src/assets/wordmark-dark.svg", replacesTitle: true, alt: "iMuninn" },
      components: { Header: "./src/components/Header.astro", Hero: "./src/components/Hero.astro" },
      description: "iPhone 作为机器人传感器：相机、IMU、ARKit 位姿、LiDAR 深度",
      // Link previews (Open Graph / X). Starlight already emits og:title/description/url and
      // twitter:card=summary_large_image; this adds the image. Absolute URL as the spec requires.
      head: [
        { tag: "meta", attrs: { property: "og:image", content: "https://imuninn.projects.weijinqi.com/og.jpg" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { property: "og:image:alt", content: "iMuninn: your iPhone as a robot sensor" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://imuninn.projects.weijinqi.com/og.jpg" } },
      ],
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
      ].filter(Boolean),
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
