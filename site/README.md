# iMuninn 文档站

Astro Starlight。内容不在这里写：`npm run sync` 从 `../docs/{user,dev,agents,design}` 和 `../protocol/` 生成 `src/content/docs/`（已 gitignore），`build`/`dev` 会先自动 sync。

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
