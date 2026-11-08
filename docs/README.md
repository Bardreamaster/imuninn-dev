# iMuninn 文档

`docs/` 是文档站（<https://imuninn.projects.weijinqi.com>）的唯一手写来源；`site/` 只放主题和构建脚本。文件名用 ASCII，数字前缀决定侧边栏顺序，页面标题取自每个文件的一级标题。英文版放在 `en/` 下同名路径，缺页时站点回退到中文。

| 栏目 | 目录 | 内容 |
| --- | --- | --- |
| 开始 | [`start/`](start/) | iMuninn 是什么、装 App、连上手机、三种接收方式 |
| Python 包 | [`python/`](python/) | `pip install imuninn`：安装、快速开始、概念、视频 / 深度 / MCAP / Rerun、CLI 与 API 参考（生成）、高级用法 |
| Web 查看器 | [`web/`](web/) | 浏览器里看手机数据，不装任何东西 |
| C++ 库 | [`cpp/`](cpp/) | 无依赖的 C++ 客户端与延迟测试 |
| 协议 | [`../protocol/README.md`](../protocol/README.md)、[`protocol/`](protocol/) | 协议规范、消息参考（生成）、`imuninn.proto` |
| 手机端 | [`phone/`](phone/) | iOS App 界面与参数、Android 版 |
| 开发者 | [`dev/`](dev/) | 环境、构建、常见问题、架构、Android、相机坐标系、发版、Python 包开发 |
| Agent | [`agents/`](agents/) | AGENTS.md 仓库约定、MCP server |
| 设计 | [`design/`](design/) | 设计文档、设计风格与 token、路线图、长时测试报告 |

生成的页面（`python/07-cli.md`、`python/08-api.md`、`protocol/messages.md`）由 `tools/gen-docs.py` 写出并提交，CI 检查它们和代码一致；不要手改。
