// Copy docs/user, docs/dev and protocol/README.md into src/content/docs with
// Starlight frontmatter, ASCII slugs and fixed relative links. Runs before build/dev.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const out = resolve(here, "../src/content/docs");

// Chinese file names -> ASCII slugs (sidebar order = number prefix).
const SLUGS = {
  "user/01-安装与连接.md": "user/install",
  "user/02-Python-API.md": "user/python-api",
  "user/03-视频与相机模式.md": "user/video-camera",
  "user/04-深度与MCAP.md": "user/depth-mcap",
  "user/05-预设-租约-C++-bench.md": "user/profiles-lease-cpp",
  "user/06-Web查看器.md": "user/web-viewer",
  "dev/01-环境搭建.md": "dev/setup",
  "dev/02-构建与运行.md": "dev/build-run",
  "dev/03-常见问题.md": "dev/troubleshooting",
  "dev/04-架构与代码地图.md": "dev/architecture",
  "agents/AGENTS.md": "agents/agents-md",
  "agents/README.md": "agents/index",
  "design/ROADMAP.md": "design/roadmap",
  "design/iMuninn-设计文档.md": "design/design-doc",
};

function slugFor(rel) {
  if (SLUGS[rel]) return SLUGS[rel];
  return rel.replace(/\.md$/, "").replace(/[^A-Za-z0-9/_-]+/g, "-").toLowerCase();
}

function convert(rel, src) {
  let text = readFileSync(src, "utf8");
  const m = text.match(/^#\s+(.+)$/m);
  let title = m ? m[1].trim() : basename(rel, ".md");
  title = title.replace(/^\d+\s*·\s*/, "");          // "01 · 安装与连接" -> "安装与连接"
  if (m) text = text.replace(m[0], "").trimStart();
  // relative .md links -> site slugs
  text = text.replace(/\]\((\.{1,2}\/[^)#]+?\.md|[^/)#][^)#]*?\.md)(#[^)]*)?\)/g, (all, p, hash = "") => {
    const dir = dirname(rel);
    let target = p.startsWith("../") ? p.replace(/^\.\.\//, "") : join(dir, p);
    target = target.replace(/^\.\//, "");
    if (target.startsWith("../protocol/README.md") || target === "protocol/README.md") return `](/protocol/${hash})`;
    const slug = SLUGS[target] ?? slugFor(target);
    if (slug.endsWith("/README") || slug.endsWith("/index")) return `](/${slug.replace(/\/(README|index)$/, "")}/${hash})`;
    return `](/${slug}/${hash})`;
  });
  // images referenced from design/ docs
  text = text.replace(/\]\(([^)]+\.(png|jpg|jpeg|svg))\)/g, (all, p) => `](/images/${basename(p)})`);
  const order = (rel.match(/\/(\d+)-/) || [])[1];
  const fm = [`---`, `title: "${title.replace(/"/g, '\\"')}"`, order ? `sidebar:\n  order: ${Number(order)}` : null, `---`, ""]
    .filter(Boolean).join("\n");
  return fm + "\n" + text;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(resolve(here, "../public/images"), { recursive: true });

const sources = [];
for (const dir of ["user", "dev", "agents", "design"]) {
  const d = join(repo, "docs", dir);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) {
    if (f.endsWith(".md") && f !== "README.md") sources.push([`${dir}/${f}`, join(d, f)]);
    if (/\.(png|jpe?g|svg)$/.test(f)) copyFileSync(join(d, f), resolve(here, "../public/images", f));
  }
}
for (const [rel, src] of sources) {
  const slug = slugFor(rel);
  const dest = join(out, `${slug}.md`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, convert(rel, src));
}
// protocol spec
const proto = join(repo, "protocol", "README.md");
if (existsSync(proto)) writeFileSync(join(out, "protocol.md"), convert("protocol/README.md", proto).replace(/^title: .*$/m, 'title: "协议规范"'));
// raw .proto as a page
const protoSrc = join(repo, "protocol", "imuninn.proto");
if (existsSync(protoSrc)) {
  writeFileSync(join(out, "protocol-proto.md"), `---\ntitle: "imuninn.proto"\n---\n\n\`\`\`proto\n${readFileSync(protoSrc, "utf8")}\n\`\`\`\n`);
}
// landing page
writeFileSync(
  join(out, "index.mdx"),
  `---
title: iMuninn
description: 把 iPhone 变成机器人用的网络传感器：相机、IMU、ARKit 位姿、LiDAR 深度。
template: splash
hero:
  tagline: 把 iPhone 变成机器人用的网络传感器 —— 相机、IMU、ARKit 位姿、LiDAR 深度，Protobuf 协议，Python / C++ 接入。
  actions:
    - text: 开始使用
      link: /user/install/
      icon: right-arrow
    - text: 开发者文档
      link: /dev/setup/
      variant: minimal
---

import { Card, CardGrid } from '@astrojs/starlight/components';

<CardGrid stagger>
  <Card title="低延迟" icon="rocket">USB 直连：IMU 2.6 ms、位姿 39 ms、视频 49 ms；60 Hz 位姿 / 100 Hz IMU / 60 fps H.264 / 60 Hz 深度同时零丢包。</Card>
  <Card title="一套协议" icon="document">Protobuf 定义所有消息，手机是服务端，PC 用 Python、C++ 或任何 WebSocket + UDP 客户端接入。</Card>
  <Card title="可录可放" icon="open-book">原样录成 MCAP，回放到 Rerun；数据集格式就是协议本身。</Card>
  <Card title="远程配置" icon="setting">参数自描述；PC、手机界面、YAML 预设、MCP 工具改的是同一份配置。</Card>
</CardGrid>
`
);
console.log(`synced ${sources.length} docs -> ${out}`);
