# iMuninn 文档站

Astro Starlight。内容不在这里写：`npm run sync` 从 `../docs/` 和 `../protocol/` 生成 `src/content/docs/`（已 gitignore），`build` / `dev` 会先自动 sync。

- 栏目 = `docs/` 的一级目录（start / python / web / cpp / protocol / phone / dev / agents / design），页面标题取文件的一级标题，`NN-` 前缀决定顺序，slug 去掉前缀。
- 英文：`docs/en/<同名路径>`；没有英文版的页面回退到中文。
- 生成页（CLI / API / 协议消息）由 `tools/gen-docs.py` 写入 `docs/`，中英共用。
- 每页的 meta description（搜索结果和分享预览用）写在 `scripts/descriptions.mjs`，按 slug 分中英文。新增公开页面时顺手加一条；没写的页面用站点默认描述，也不会进 llms.txt。
- sync 同时生成 `public/llms.txt` 和 `public/llms-full.txt`（给 AI 爬虫和 agent），只包含 `descriptions.mjs` 里列出且本次构建存在的页面，所以私有栏目不会混进去。
- 分享预览图是 `public/og.jpg`（1200×630，从宣传图裁出），在 `astro.config.mjs` 的 `head` 里引用。

```bash
cd site && npm install
npm run dev        # http://localhost:4321
npm run build      # 输出 dist/
```

## 部署到 Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接 GitHub 仓库。
2. 构建设置：Framework preset **Astro**；Root directory `site`；Build command `npm run build`；Output directory `dist`。
3. 环境变量 `NODE_VERSION=22`。
4. 自定义域名：`imuninn.projects.weijinqi.com`（`astro.config.mjs` 里的 `site` 已设为此值）。

也可以本地 `npx wrangler pages deploy dist --project-name imuninn`。
