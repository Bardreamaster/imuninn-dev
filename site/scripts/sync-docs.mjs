// Copy docs/** (plus protocol/README.md and imuninn.proto) into src/content/docs with
// Starlight frontmatter and fixed relative links. Runs before build/dev.
//
//   docs/<section>/NN-name.md  -> src/content/docs/<section>/name.md        (root locale, zh-CN)
//   docs/en/<section>/NN-name.md -> src/content/docs/en/<section>/name.md   (English)
//   generated pages (python/07-cli, python/08-api, protocol/messages) are English and are
//   copied into both locales.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, copyFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DESCRIPTIONS } from "./descriptions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const docs = join(repo, "docs");
const out = resolve(here, "../src/content/docs");
const images = resolve(here, "../public/images");

const SECTIONS = ["start", "python", "web", "cpp", "protocol", "phone", "dev", "agents", "design"];
const GENERATED = new Set(["python/07-cli.md", "python/08-api.md", "protocol/messages.md"]);
const SKIP = new Set(["README.md"]);

/** "python/02-quickstart.md" -> "python/quickstart" */
function slugOf(rel) {
  return rel.replace(/\.md$/, "").replace(/(^|\/)\d+-/g, "$1").toLowerCase();
}

/** Resolve a relative .md link from a doc at `rel` to a site path. */
function linkFor(rel, target, hash, locale) {
  let t = target.replace(/^\.\//, "");
  const dir = dirname(rel);
  // climb ../ segments against the doc's directory (docs/ is the root)
  let base = dir;
  while (t.startsWith("../")) { t = t.slice(3); base = base === "." ? ".." : dirname(base); }
  const joined = base === "." ? t : base === ".." ? t.replace(/^(docs\/)?/, "") : join(base, t);
  if (/^(\.\.\/)?protocol\/README\.md$/.test(joined) || joined === "protocol/README.md") return `/${locale}protocol/${hash}`;
  if (joined === "protocol/imuninn.proto") return `/${locale}protocol/proto/${hash}`;
  let slug = slugOf(joined.replace(/^en\//, ""));
  if (slug.endsWith("/README") || slug.endsWith("/readme")) slug = slug.replace(/\/README$/i, "");
  if (slug === "README" || slug === "readme") return `/${locale}${hash}`;
  return `/${locale}${slug}/${hash}`;
}

/** Frontmatter line with the page's meta description for this locale, or null. */
function descriptionLine(slug, locale) {
  const d = DESCRIPTIONS[slug];
  const text = d && (locale === "en/" ? d.en : d.zh);
  return text ? `description: ${JSON.stringify(text)}` : null;
}

const emitted = new Set();   // site paths that exist in this build (filled in the first pass)

function convert(rel, text, locale) {
  const m = text.match(/^#\s+(.+)$/m);
  let title = m ? m[1].trim() : basename(rel, ".md");
  title = title.replace(/^\d+\s*·\s*/, "");
  if (m) text = text.replace(m[0], "").trimStart();
  text = text.replace(/^<!--.*?-->\s*/s, "");
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+?\.md)(#[^)]*)?\)/g, (all, label, p, hash = "") => {
    if (/^https?:/.test(p)) return all;
    const href = linkFor(rel, p, hash, locale);
    const key = href.split("#")[0].replace(/^\/en\//, "/");
    if (emitted.size && !emitted.has(key)) return label;   // target not published in this build: keep the words, drop the link
    return `[${label}](${href})`;
  });
  text = text.replace(/\]\(([^)\s]+\.(png|jpg|jpeg|svg))\)/g, (all, p) => `](/images/${basename(p)})`);
  const order = (basename(rel).match(/^(\d+)-/) || [])[1];
  const slug = rel === "protocol/README.md" ? "protocol" : slugOf(rel.replace(/^en\//, ""));
  const fm = ["---", `title: "${title.replace(/"/g, '\\"')}"`, descriptionLine(slug, locale), order ? `sidebar:\n  order: ${Number(order)}` : null, "---", ""]
    .filter(Boolean).join("\n");
  return fm + "\n" + text;
}

function walk(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== "en" && !/^longrun-/.test(f) && f !== "icons") files.push(...walk(p)); continue; }
    files.push(p);
  }
  return files;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(images, { recursive: true });

let n = 0;
function sitePath(rel) { return `/${slugOf(rel.replace(/^en\//, ""))}/`; }
// first pass: what exists in this build
for (const section of SECTIONS) for (const src of walk(join(docs, section))) {
  if (src.endsWith(".md") && !SKIP.has(basename(src))) emitted.add(sitePath(relative(docs, src)));
}
emitted.add("/protocol/"); emitted.add("/protocol/proto/"); emitted.add("/");
function emit(rel, src, locale) {
  const slug = slugOf(rel.replace(/^en\//, ""));
  const dest = join(out, locale, `${slug}.md`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, convert(rel, readFileSync(src, "utf8"), locale));
  n++;
}

// root locale (Chinese) + generated pages into both locales
for (const section of SECTIONS) {
  for (const src of walk(join(docs, section))) {
    const rel = relative(docs, src);
    if (/\.(png|jpe?g|svg)$/.test(src)) { copyFileSync(src, join(images, basename(src))); continue; }
    if (!src.endsWith(".md") || SKIP.has(basename(src))) continue;
    emit(rel, src, "");
    if (GENERATED.has(rel)) emit(rel, src, "en/");
  }
}
// English translations
for (const src of walk(join(docs, "en"))) {
  if (!src.endsWith(".md") || SKIP.has(basename(src))) continue;
  emit(relative(docs, src), src, "en/");
}

// protocol spec (protocol/README.md, English in README.en.md) + raw .proto, both locales.
// The "[English](README.en.md)" / "[中文](README.md)" switch line is for GitHub; the site has its own.
const dropLangLine = (t) => t.replace(/^\[(English|中文)\]\(README(\.en)?\.md\)\s*\n/m, "");
const spec = dropLangLine(readFileSync(join(repo, "protocol/README.md"), "utf8"));
writeFileSync(join(out, "protocol.md"), convert("protocol/README.md", spec, "").replace(/^title: .*$/m, 'title: "协议规范"'));
const specEn = join(repo, "protocol/README.en.md");
if (existsSync(specEn)) {
  mkdirSync(join(out, "en"), { recursive: true });
  writeFileSync(join(out, "en/protocol.md"),
    convert("protocol/README.md", dropLangLine(readFileSync(specEn, "utf8")), "en/").replace(/^title: .*$/m, 'title: "Protocol specification"'));
}
const proto = readFileSync(join(repo, "protocol/imuninn.proto"), "utf8");
for (const locale of ["", "en/"]) {
  mkdirSync(join(out, locale, "protocol"), { recursive: true });
  writeFileSync(join(out, locale, "protocol/proto.md"), `---\ntitle: "imuninn.proto"\n${descriptionLine("protocol/proto", locale)}\n---\n\n\`\`\`proto\n${proto}\n\`\`\`\n`);
}

// landing pages
const zhHome = `---
title: 把 iPhone 变成机器人传感器
description: 把 iPhone 变成机器人用的网络传感器：相机、IMU、ARKit 位姿、LiDAR 深度。
template: splash
hero:
  title: iMuninn
  tagline: 把 iPhone 变成机器人用的网络传感器 —— 相机、IMU、ARKit 位姿、LiDAR 深度，Protobuf 协议，Python / Web / C++ 接收。
  actions:
    - text: 开始使用
      link: /start/overview/
      icon: right-arrow
    - text: pip install imuninn
      link: /python/install/
      variant: minimal
---

import { Card, CardGrid, LinkCard } from '@astrojs/starlight/components';

## 三种接收方式

<CardGrid>
  <LinkCard title="Python 包" description="pip install imuninn：脚本、数据集、Rerun、MCAP、MCP。" href="/python/quickstart/" />
  <LinkCard title="Web 查看器" description="浏览器打开即看，不装任何东西。" href="/web/web-viewer/" />
  <LinkCard title="C++ 库" description="无依赖，实时控制程序直接链接。" href="/cpp/cpp-client/" />
</CardGrid>

<CardGrid stagger>
  <Card title="低延迟" icon="rocket">USB 直连：IMU 2.6 ms、位姿 39 ms、视频 49 ms；60 Hz 位姿 / 100 Hz IMU / 60 fps H.264 / 60 Hz 深度同时零丢包。</Card>
  <Card title="一套协议" icon="document">Protobuf 定义所有消息，手机是服务端，PC 用 Python、C++ 或浏览器接入。</Card>
  <Card title="可录可放" icon="open-book">原样录成 MCAP，回放到 Rerun；数据集格式就是协议本身。</Card>
  <Card title="远程配置" icon="setting">参数自描述；PC、手机界面、YAML 预设、MCP 工具改的是同一份配置。</Card>
</CardGrid>
`;
const enHome = zhHome
  .replace("title: 把 iPhone 变成机器人传感器", "title: Turn an iPhone into a robot sensor")
  .replace("description: 把 iPhone 变成机器人用的网络传感器：相机、IMU、ARKit 位姿、LiDAR 深度。", "description: Turn an iPhone into a network sensor for robots - camera, IMU, ARKit pose, LiDAR depth.")
  .replace("tagline: 把 iPhone 变成机器人用的网络传感器 —— 相机、IMU、ARKit 位姿、LiDAR 深度，Protobuf 协议，Python / Web / C++ 接收。", "tagline: Turn an iPhone into a network sensor for robots - camera, IMU, ARKit pose, LiDAR depth, a Protobuf protocol, received from Python, a browser or C++.")
  .replace("text: 开始使用\n      link: /start/overview/", "text: Get started\n      link: /en/start/overview/")
  .replace("link: /python/install/", "link: /en/python/install/")
  .replace("## 三种接收方式", "## Three ways to receive")
  .replace('title="Python 包" description="pip install imuninn：脚本、数据集、Rerun、MCAP、MCP。" href="/python/quickstart/"', 'title="Python package" description="pip install imuninn: scripts, datasets, Rerun, MCAP, MCP." href="/en/python/quickstart/"')
  .replace('title="Web 查看器" description="浏览器打开即看，不装任何东西。" href="/web/web-viewer/"', 'title="Web viewer" description="Open it in a browser, nothing to install." href="/web/web-viewer/"')
  .replace('title="C++ 库" description="无依赖，实时控制程序直接链接。" href="/cpp/cpp-client/"', 'title="C++ library" description="Dependency-free, links straight into real-time programs." href="/cpp/cpp-client/"')
  .replace('<Card title="低延迟" icon="rocket">USB 直连：IMU 2.6 ms、位姿 39 ms、视频 49 ms；60 Hz 位姿 / 100 Hz IMU / 60 fps H.264 / 60 Hz 深度同时零丢包。</Card>', '<Card title="Low latency" icon="rocket">Over USB: IMU 2.6 ms, pose 39 ms, video 49 ms; 60 Hz pose, 100 Hz IMU, 60 fps H.264 and 60 Hz depth at once with no drops.</Card>')
  .replace('<Card title="一套协议" icon="document">Protobuf 定义所有消息，手机是服务端，PC 用 Python、C++ 或浏览器接入。</Card>', '<Card title="One protocol" icon="document">Protobuf defines every message; the phone is the server, receive from Python, C++ or a browser.</Card>')
  .replace('<Card title="可录可放" icon="open-book">原样录成 MCAP，回放到 Rerun；数据集格式就是协议本身。</Card>', '<Card title="Record and replay" icon="open-book">Recorded as-is to MCAP, replayed in Rerun; the dataset format is the protocol itself.</Card>')
  .replace('<Card title="远程配置" icon="setting">参数自描述；PC、手机界面、YAML 预设、MCP 工具改的是同一份配置。</Card>', '<Card title="Remote configuration" icon="setting">Self-describing parameters; the PC, the phone UI, YAML profiles and MCP tools edit one configuration.</Card>');
writeFileSync(join(out, "index.mdx"), zhHome);
mkdirSync(join(out, "en"), { recursive: true });
writeFileSync(join(out, "en/index.mdx"), enHome);

// llms.txt (https://llmstxt.org) and llms-full.txt for AI crawlers and agents. Only pages that
// have a description and exist in this build are listed, so private sections never leak in.
const SITE = "https://imuninn.projects.weijinqi.com";
const pageFile = (slug, locale) => join(out, locale, `${slug}.md`);
const listed = Object.keys(DESCRIPTIONS).filter((slug) => existsSync(pageFile(slug, "")));
const urlOf = (slug, locale) => `${SITE}/${locale}${slug}/`;
const titleOf = (slug, locale) => {
  const f = existsSync(pageFile(slug, locale)) ? pageFile(slug, locale) : pageFile(slug, "");
  return (readFileSync(f, "utf8").match(/^title: "?(.*?)"?$/m) || [])[1] || slug;
};
const llms = [
  "# iMuninn",
  "",
  "> iMuninn turns an iPhone into a network sensor for robots: H.264 camera, IMU, ARKit 6-DoF pose with per-frame intrinsics, and LiDAR depth, streamed over Wi-Fi or USB with a Protobuf protocol. The phone is the server; receivers are a Python package (`pip install imuninn`), a web viewer and a C++ library. Open source (MIT / Apache-2.0).",
  "",
  `Source: https://github.com/Bardreamaster/imuninn. Python package: https://pypi.org/project/imuninn/. Web viewer: https://imuninn-webviewer.projects.weijinqi.com. Full text of these docs: ${SITE}/llms-full.txt`,
  "",
  "## Docs (English)",
  "",
  ...listed.map((slug) => `- [${titleOf(slug, "en/")}](${urlOf(slug, "en/")}): ${DESCRIPTIONS[slug].en}${existsSync(pageFile(slug, "en/")) ? "" : " (Chinese only)"}`),
  "",
  "## 文档（中文）",
  "",
  ...listed.map((slug) => `- [${titleOf(slug, "")}](${urlOf(slug, "")}): ${DESCRIPTIONS[slug].zh}`),
  "",
];
writeFileSync(resolve(here, "../public/llms.txt"), llms.join("\n"));
const full = [llms.slice(0, 5).join("\n")];
for (const slug of listed) {
  const locale = existsSync(pageFile(slug, "en/")) ? "en/" : "";
  const md = readFileSync(pageFile(slug, locale), "utf8");
  const title = titleOf(slug, locale);
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  full.push(`# ${title}\n\nURL: ${urlOf(slug, locale)}\n\n${body}`);
}
writeFileSync(resolve(here, "../public/llms-full.txt"), full.join("\n\n---\n\n") + "\n");

console.log(`synced ${n} docs -> ${out}`);
