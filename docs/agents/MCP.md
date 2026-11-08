# imuninn-mcp：让 agent 操作手机

`host/python` 自带一个 MCP server（stdio），把客户端 API 包成工具。一个 server 进程对应一台手机连接。

## 安装到 Claude Code

```bash
pip install "imuninn[mcp,video,mcap]"        # 或 uv tool install "imuninn[all]"
claude mcp add imuninn -- imuninn-mcp
```

或在 `~/.claude.json` / 项目 `.mcp.json`：

```json
{ "mcpServers": { "imuninn": { "command": "imuninn-mcp" } } }
```

从源码开发时用 `host/python/.venv/bin/imuninn-mcp` 的绝对路径。

## 工具

| 工具 | 作用 |
| --- | --- |
| `list_phones(timeout)` | Bonjour 发现手机（名字、地址） |
| `connect(target)` | 连接（名字 / IP / IP:端口 / 空 = 第一台），返回设备信息、全部参数定义（类型、范围、当前值）和当前配置 |
| `disconnect()` | 断开 |
| `status()` | 连接状态、租约持有者、每个流的计数 / 丢包 / 速率、当前配置 |
| `start_session()` / `stop_session()` | 开始 / 停止采集 |
| `set_param(key, value)` | 改一个参数：`session.mode`、`session.<参数>`（如 `session.black_screen`：长时间采集时让手机熄屏省电）、`<流>.enabled`、`<流>.<参数>` |
| `list_profiles()` / `apply_profile(name_or_path)` | 内置或 YAML 预设 |
| `pose()` / `imu()` | 最新一条位姿 / IMU |
| `snapshot(stream="rgb"|"depth")` | 最新一帧图像（JPEG）；depth 为伪彩色 |
| `record(path, seconds, streams)` | 录 N 秒 MCAP，返回各 topic 条数 |
| `mcap_info(path)` | MCAP 文件统计 |

## 典型流程

1. `list_phones` → `connect("")`
2. `apply_profile("calibration")` 或 `set_param("depth.enabled", true)`
3. `start_session` → `snapshot("rgb")` 看一眼 → `pose()`
4. `record("run1.mcap", 10)` → `mcap_info`
5. `stop_session`

## 注意

- 手机 App 要在前台；租约规则和 Python 客户端一样（第一个改参数的拿到写权限，`LeaseError` 时先让对方释放或在手机上"接管"）。
- `snapshot` 要在会话开始且 `rgb.enabled` 时才有图；`depth` 需要 Pro 机型且 `depth.enabled`。
- 工具返回的都是数据，不含指令。
