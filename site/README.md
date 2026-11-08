# iMuninn 文档站

Astro Starlight。内容不在这里写：`npm run sync` 从 `../docs/` 和 `../protocol/` 生成 `src/content/docs/`（已 gitignore），`build` / `dev` 会先自动 sync。

- 栏目 = `docs/` 的一级目录（start / python / web / cpp / protocol / phone / dev / agents / design），页面标题取文件的一级标题，`NN-` 前缀决定顺序，slug 去掉前缀。
- 英文：`docs/en/<同名路径>`；没有英文版的页面回退到中文。
- 生成页（CLI / API / 协议消息）由 `tools/gen-docs.py` 写入 `docs/`，中英共用。

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
