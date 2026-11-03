// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Content is generated from ../docs by scripts/sync-docs.mjs (npm run sync).
export default defineConfig({
  site: "https://imuninn.projects.weijinqi.com",
  integrations: [
    starlight({
      title: "iMuninn",
      description: "iPhone 作为机器人传感器：相机、IMU、ARKit 位姿、LiDAR 深度",
      defaultLocale: "root",
      locales: { root: { label: "中文", lang: "zh-CN" } },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/Bardreamaster/imuninn" }],
      sidebar: [
        { label: "使用者", items: [{ autogenerate: { directory: "user" } }] },
        { label: "开发者", items: [{ autogenerate: { directory: "dev" } }] },
        {
          label: "协议",
          items: [
            { label: "协议规范", slug: "protocol" },
            { label: "imuninn.proto", slug: "protocol-proto" },
          ],
        },
        { label: "Agent", items: [{ autogenerate: { directory: "agents" } }] },
        { label: "设计", items: [{ autogenerate: { directory: "design" } }] },
      ],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
