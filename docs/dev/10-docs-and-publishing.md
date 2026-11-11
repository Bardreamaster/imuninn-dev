# 文档与公开发布

文档站（<https://imuninn.projects.weijinqi.com>）从 `docs/` 构建，公开仓库 `Bardreamaster/imuninn` 是本私有仓库按白名单同步出去的副本。两者的规则都在这一页。

## 仓库与分支

| 仓库 | 分支 | 内容 |
| --- | --- | --- |
| `Bardreamaster/imuninn-dev`（私有，本地 `origin`） | `dev` | 日常开发：所有改动先提交到这里，未完成的功能可以再开自己的功能分支 |
| | `main` | 只放已经公开的内容，始终等于公开仓库最近一次发布的 `Source:` 提交 |
| `Bardreamaster/imuninn`（公开） | `main` | 受保护，不能直接推送，只通过 PR 合入。内容来自私有 `main` 的导出（去掉不公开的目录），不在这里直接开发 |
| | `publish/<日期>-<sha>` | `tools/publish.sh` 每次发布新建的分支，PR 合并后即可删除 |

发布流程：确认 `dev` 上要公开的内容都准备好 → 把 `dev` 合进 `main`（快进）→ 用 `publish.sh` 把内容推到公开仓的一个 `publish/…` 分支 → 在 GitHub 上手动建 PR 并合并到公开仓 `main` → `git push origin main dev`。没准备好的东西留在 `dev` 或功能分支上，不要合进 `main`。两个仓库之间不 cherry-pick、不互相提 PR：公开仓库没有私有仓库的历史和被排除的目录，提交对不上。

## 文档结构

| 位置 | 内容 |
| --- | --- |
| `docs/<栏目>/NN-name.md` | 中文页面（站点默认语言）。栏目 = 侧边栏分组：`start`、`python`、`web`、`cpp`、`protocol`、`phone`、`dev`、`agents`、`design` |
| `docs/en/<栏目>/NN-name.md` | 英文页面，路径与中文版一一对应；缺英文版时站点回退到中文 |
| `protocol/README.md`、`protocol/README.en.md` | 协议规范（中 / 英），站点的「协议规范」页从这里生成 |
| `docs/design/tokens.*`、`docs/design/icons/` | 设计 token 与图标，App、Web 查看器和站点构建都要用 |
| `site/` | Astro Starlight：主题、`scripts/sync-docs.mjs`、首页与顶栏组件；不写正文 |

约定：

- 文件名只用 ASCII；`NN-` 前缀决定侧边栏顺序，站点 slug 去掉前缀（`docs/python/02-quickstart.md` → `/python/quickstart/`，英文 → `/en/python/quickstart/`）。
- 页面标题取文件的一级标题；正文里用相对路径链接其它 `.md`，同步脚本会改写成站点路径。
- 链接指向本次构建里不存在的页面（例如公开站点里的开发者 / 设计栏目）时，同步脚本保留文字、去掉链接；侧边栏也不显示空栏目。所以私有页面可以放心被公开页面引用。
- 新增或改动面向用户的页面时，中英文一起改。docstring、注释、生成页一律英文。

## 生成页

| 文件 | 来源 | 生成方式 |
| --- | --- | --- |
| `docs/python/07-cli.md` | `imuninn.cli.build_parser()` | `tools/gen-docs.py` |
| `docs/python/08-api.md` | 公开 API 的 docstring（griffe 静态解析） | `tools/gen-docs.py` |
| `docs/protocol/messages.md` | `protocol/imuninn.proto` | `tools/gen-docs.py` |

生成页是英文，中英文站点共用，提交在仓库里，不要手改。改了 CLI、公开 docstring 或 `.proto` 后运行：

```bash
host/python/.venv/bin/python tools/gen-docs.py      # 需要 [docs] extra（griffe，Python 3.11+）
```

CI 的 `generated-docs` 任务在 Python 3.13 上重新生成并比较，过期就失败（argparse 的帮助格式随 Python 小版本变化，griffe 版本也固定了）。

## 不公开的内容

`tools/publish.sh` 的 `EXCLUDE` 列表决定什么不出私有仓库：

| 不公开 | 原因 |
| --- | --- |
| `docs/dev/` | 开发者文档（2026-11-08 决定暂不公开） |
| `docs/design/*.md`、截图、长时测试报告与原始数据 | 设计文档、路线图、内部测试记录 |
| `docs/agents/AGENTS.md`、`docs/AGENTS.md` | 仓库内部约定 |
| 构建产物、生成的 C++ / Swift / Java 绑定、`*.mcap` / `*.rrd` / `*.csv` | 可再生成或体积大 |

`docs/design/tokens.json`、`tokens.css`、`icons/` 例外：构建需要，所以公开。要改变公开范围就改 `EXCLUDE` 并在这里更新表格。

公开前检查：私网 IP 只用 `10.0.0.x` 示例；不出现邮箱、本机路径、设备 UDID；没有任何 token、证书、密钥（发布靠 trusted publishing）；面向用户的文档不写「规划中 / 暂时」之类未完成的承诺。

## 发布到公开仓库

公开副本只需克隆一次，放在私有仓库旁边：

```bash
git clone git@github.com:Bardreamaster/imuninn.git ../imuninn-public
```

每次发布在私有仓库根目录运行下面三条。第一条把 `main` 快进到 `dev`；第二条复制内容并在副本的发布分支上提交，不推送，用来检查改动列表；第三条加 `--push`，把发布分支推到公开仓：

```bash
git fetch . dev:main
git show main:tools/publish.sh | REPO=. bash -s -- ../imuninn-public "说明"
git show main:tools/publish.sh | REPO=. bash -s -- ../imuninn-public "说明" --push
```

然后在 GitHub 上从 `publish/<日期>-<sha>` 向 `main` 建 PR 并合并（脚本不建 PR，合并方式不限）。合并后回到私有仓库运行 `git push origin main dev`。

命令行里不要写行尾 `#` 注释：交互式 zsh 默认不把它当注释，会当成参数传给命令。

脚本行为：

1. 用 `git archive` 导出 `REF`（默认 `main`）的**已提交**内容，从不读工作区。工作区可能停在别的分支上，那里的 `tools/publish.sh` 也可能是旧版本，所以按上面的写法直接运行 `main` 上的脚本（`REPO=.` 告诉它私有仓库在哪）。
2. 在公开副本里 `fetch`，从 `origin/main` 的最新提交开始工作。副本自己的本地分支不参与，副本里有未提交改动时拒绝运行。
3. 把白名单内的每个目录**整体替换**成 `REF` 的版本，所以删除也会同步。和 `origin/main` 没有差别时报 `nothing to publish` 并退出。
4. 新建分支 `publish/<日期>-<REF 短 sha>`（可用 `BRANCH=…` 指定名字）并提交，提交信息末尾写 `Source: <完整 sha> (<ref>)`。
5. 加了 `--push` 才推送这个分支。同一内容已经推过时（重复运行）不会再提交，只提示去建或合并 PR。

上一个发布 PR 还没合并就又发布了新内容时，新分支同样从 `origin/main` 开始并包含全部改动，合并新的 PR、关掉旧的即可。

**坑：不能用旧版本覆盖。** 因为第 3 步是整体替换，拿一个比公开仓当前内容更旧（或分叉）的提交去发布，别人已发布的内容会被静默回滚（2026-11-09 推 README 时就这样回滚过 iOS 界面）。脚本会在 `origin/main` 的历史里找最近的 `Source:` 行，要求它是 `REF` 的祖先，否则拒绝；确实要回退时用 `FORCE=1`。这一行在发布提交的信息里，squash、rebase、merge commit 三种合并方式都能找到；squash 合并时不要把它从提交信息里删掉。所有发布都从私有仓库的 `main` 进行；还没准备好公开的东西留在 `dev`，或者用 `EXCLUDE` 按路径排除。

PR 合并后公开仓的 workflow：`python-ci`（测试、生成代码 / 生成文档一致性）、`web-viewer-pages`（Web 查看器 → GitHub Pages）；Cloudflare Pages 自动构建 `site/`；打 `python-v*` tag 发 PyPI（见[发版](07-release.md)）。
