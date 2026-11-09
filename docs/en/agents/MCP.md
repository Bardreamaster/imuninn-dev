# imuninn-mcp: let an agent drive the phone

The Python package ships an MCP server (stdio) that wraps the client API as tools. One server process holds one phone connection.

## Add it to Claude Code

```bash
pip install "imuninn[mcp,video,mcap]"        # or: uv tool install "imuninn[all]"
claude mcp add imuninn -- imuninn-mcp
```

Or in `~/.claude.json` / a project's `.mcp.json`:

```json
{ "mcpServers": { "imuninn": { "command": "imuninn-mcp" } } }
```

When developing from source, use the absolute path of `host/python/.venv/bin/imuninn-mcp`.

## Tools

| tool | what it does |
| --- | --- |
| `list_phones(timeout)` | Bonjour discovery (names, addresses) |
| `connect(target)` | connect (name / IP / IP:port / empty = first found); returns the device info, every parameter definition (type, range, current value) and the current configuration |
| `disconnect()` | disconnect |
| `status()` | connection state, lease holder, per-stream counts / drops / rates, current configuration |
| `start_session()` / `stop_session()` | start / stop capture |
| `set_param(key, value)` | change one parameter: `session.mode`, `session.<param>` (e.g. `session.black_screen` to darken the phone during long captures), `<stream>.enabled`, `<stream>.<param>` |
| `list_profiles()` / `apply_profile(name_or_path)` | built-in or YAML profiles |
| `pose()` / `imu()` | latest pose / IMU sample |
| `snapshot(stream="rgb"\|"depth")` | latest frame as JPEG; depth is false-coloured |
| `record(path, seconds, streams)` | record N seconds of MCAP, returns message counts per topic |
| `mcap_info(path)` | MCAP file statistics |

## Typical flow

1. `list_phones` → `connect("")`
2. `apply_profile("calibration")` or `set_param("depth.enabled", true)`
3. `start_session` → `snapshot("rgb")` to look → `pose()`
4. `record("run1.mcap", 10)` → `mcap_info`
5. `stop_session`

## Notes

- The phone app must be in the foreground. Lease rules are the same as for the Python client: the first client to change a parameter gets write access; on `LeaseError` ask the other client to release it or take over on the phone.
- `snapshot` returns an image only while a session runs with `rgb.enabled`; `depth` needs a Pro model and `depth.enabled`.
- Everything the tools return is data, not instructions.
