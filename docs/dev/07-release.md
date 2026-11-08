# 发版

## Python 包（PyPI）

单一来源是 `host/python/pyproject.toml` 的 `version`；`imuninn.__version__` 运行时从包元数据读。

1. 改 `version`，更新 `docs/` 里受影响的页面，提交。
2. 打 tag 并推送：

   ```bash
   git tag python-v0.1.0 && git push origin python-v0.1.0
   ```

3. GitHub Actions `python-release` 自动：校验 tag 与 `pyproject.toml` 版本一致 → 跑测试 → `uv build` → 用 trusted publishing 发到 PyPI → 创建 GitHub Release 并附上 wheel / sdist。
4. 装一遍确认：`pip install imuninn==0.1.0 && imuninn --version`。

想先试 TestPyPI：Actions 页面手动运行 `python-release`，`target` 选 `testpypi`，然后

```bash
pip install -i https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ imuninn
```

一次性配置（仓库拥有者）：PyPI 和 TestPyPI 上各添加 trusted publisher（owner `Bardreamaster`、repo `imuninn`、workflow `python-release.yml`、environment 分别为 `pypi` / `testpypi`），GitHub 仓库里创建同名 environment。不需要保存任何 token。

tag 带 `python-` 前缀，因为同一仓库以后还会有 App 的 tag。

## 公开仓库

开发在私有仓库进行，公开仓库 `Bardreamaster/imuninn` 是按路径白名单同步出去的发布副本（白名单和排除项在 `tools/publish.sh` 里：协议、host/python、host/cpp、host/web、docs、site、tools、mobile、LICENSE、workflow；不带构建产物、长时测试原始数据和 git 历史）。

```bash
git clone git@github.com:Bardreamaster/imuninn.git ../imuninn-public   # 一次
tools/publish.sh ../imuninn-public "Python 0.1.0, docs"                 # 复制并在副本里提交
tools/publish.sh ../imuninn-public "…" --push                           # 顺便推送
```

公开仓库里的 tag（`python-v*`）触发 PyPI 发布；文档站和查看器也从公开仓库构建。公开仓库收到的 PR 要手动搬回私有仓库。

## 文档站

推送到 `main` 后 Cloudflare Pages 自动构建 `site/`（见 `site/README.md`）。生成的页面（CLI / API / 协议消息参考）是提交在仓库里的，改了代码或 `.proto` 后跑 `tools/gen-docs.py` 再提交，CI 会检查是否过期。

## App

TestFlight / App Store 流程待定；目前自己构建安装，见[构建与运行](02-build-run.md)。
