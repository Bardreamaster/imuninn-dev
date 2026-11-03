"""MCP server so an agent (Claude Code, etc.) can operate the phone directly.

    imuninn-mcp                       # stdio transport (what MCP clients expect)

Claude Code config (`~/.claude.json` → mcpServers, or `claude mcp add imuninn -- <path>/.venv/bin/imuninn-mcp`):

    {"mcpServers": {"imuninn": {"command": "/path/to/imuninn/host/python/.venv/bin/imuninn-mcp"}}}

One phone connection per server process. Tools return plain dicts / text; `snapshot`
returns an image. Nothing here touches the data path: it is the same client API
scripts use (`imuninn.connect`), wrapped for tool calls.
"""

from __future__ import annotations

import io
import threading
import time
from typing import Any

from mcp.server.mcpserver import Image, MCPServer

from . import __version__
from .proto import imuninn_pb2 as pb

server = MCPServer(
    "imuninn",
    instructions=(
        "Operate an iMuninn phone (iPhone as a camera / IMU / pose / LiDAR sensor). "
        "Call list_phones, then connect; start_session before expecting data; "
        "set_param / apply_profile change the phone configuration; snapshot returns the latest camera frame."
    ),
)

_lock = threading.Lock()
_dev = None
_latest: dict[str, Any] = {}


def _on_sample(stream: str, sample) -> None:
    _latest[stream] = sample


def _need() -> Any:
    if _dev is None or not _dev.connected:
        raise RuntimeError("not connected: call connect first")
    return _dev


def _value(v: pb.Value):
    kind = v.WhichOneof("v")
    return getattr(v, kind) if kind else None


def _config_dict(c: pb.DeviceConfig) -> dict:
    return {
        "config_version": c.config_version,
        "mode": "camera" if c.mode == pb.SESSION_MODE_CAMERA else "ar",
        "streams": {s.stream_id: {"enabled": s.enabled, **{k: _value(v) for k, v in s.params.items()}} for s in c.streams},
    }


def _result_dict(r: pb.ConfigResult) -> dict:
    return {
        "config_version": r.config_version,
        "session_restarted": r.session_restarted,
        "fields": [
            {"key": f.key, "status": pb.ConfigResult.FieldResult.Status.Name(f.status).removeprefix("STATUS_").lower(),
             "effective": _value(f.effective), "reason": f.reason}
            for f in r.fields
        ],
    }


@server.tool()
def list_phones(timeout: float = 2.0) -> list[dict]:
    """Discover iMuninn phones on the local network / USB (Bonjour). Returns name, host, port."""
    from .discovery import discover

    return [{"name": p.name, "host": p.host, "port": p.port, "addresses": list(p.addresses), "protocol": p.protocol_version}
            for p in discover(timeout)]


@server.tool()
def connect(target: str = "") -> dict:
    """Connect to a phone by name, host, host:port, or "" for the first one found. Returns device info and available streams/params."""
    global _dev
    from .session import connect as _connect

    with _lock:
        if _dev is not None:
            try:
                _dev.close()
            except Exception:
                pass
        _dev = _connect(target, name="mcp-agent")
        _dev.on("*", _on_sample)
    d = _dev.info
    caps = _dev.capabilities
    return {
        "device": {"name": d.device_name, "model": d.model, "os": d.os_version, "lidar": d.has_lidar},
        "clock_offset_ms": (_dev.clock_offset_ns or 0) / 1e6,
        "streams": {
            s.stream_id: {p.key: {"kind": pb.ParamSpec.Kind.Name(p.kind).removeprefix("KIND_").lower(),
                                  "current": _value(p.current), "min": p.min, "max": p.max, "choices": list(p.choices),
                                  "apply": "restart" if p.apply == pb.ParamSpec.APPLY_RESTART_SESSION else "immediate"}
                          for p in s.params}
            for s in caps.streams
        },
        "session_params": {p.key: {"choices": list(p.choices), "current": _value(p.current)} for p in caps.session_params},
        "config": _config_dict(_dev.config),
    }


@server.tool()
def disconnect() -> str:
    """Close the phone connection."""
    global _dev
    with _lock:
        if _dev is not None:
            _dev.close()
            _dev = None
    return "disconnected"


@server.tool()
def status() -> dict:
    """Connection state, lease holder, per-stream counts / drops / rates, current config."""
    dev = _need()
    return {
        "connected": dev.connected,
        "lease_holder": dev.lease_holder,
        "streams": {k: {"count": v.count, "dropped": v.dropped, "rate_hz": round(v.rate_hz, 1)} for k, v in dev.stats.items()},
        "config": _config_dict(dev.config),
    }


@server.tool()
def start_session() -> str:
    """Start capture on the phone (sources run; data flows to subscribers)."""
    _need().start()
    return "started"


@server.tool()
def stop_session() -> str:
    """Stop capture on the phone."""
    _need().stop()
    return "stopped"


@server.tool()
def set_param(key: str, value: str | int | float | bool) -> dict:
    """Set one parameter. key: "session.mode", "<stream>.enabled", or "<stream>.<param>"
    (e.g. "imu.rate_hz", "rgb.lens", "rgb.exposure_mode", "rgb.white_balance_mode", "depth.enabled")."""
    dev = _need()
    if isinstance(value, str):
        low = value.lower()
        if low in ("true", "false"):
            value = low == "true"
        else:
            try:
                value = int(value)
            except ValueError:
                try:
                    value = float(value)
                except ValueError:
                    pass
    return _result_dict(dev.set(key, value))


@server.tool()
def list_profiles() -> list[str]:
    """Built-in YAML configuration presets (calibration, teleop, dataset, camera_wide)."""
    from .profiles import builtin_profiles

    return builtin_profiles()


@server.tool()
def apply_profile(name_or_path: str) -> dict:
    """Apply a built-in profile name or a YAML file to the phone."""
    return _result_dict(_need().apply_profile(name_or_path))


@server.tool()
def pose() -> dict:
    """Latest ARKit pose (position m, orientation quaternion xyzw, tracking state, intrinsics)."""
    _need()
    p = _latest.get("ar_pose")
    if p is None:
        return {"error": "no pose received yet (is the session started and ar_pose enabled?)"}
    return {
        "device_time_s": p.header.device_time_ns / 1e9,
        "position": [p.position.x, p.position.y, p.position.z],
        "orientation_xyzw": [p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w],
        "tracking": pb.TrackingState.Name(p.tracking).removeprefix("TRACKING_STATE_").lower(),
        "intrinsics": {"fx": p.intrinsics.fx, "fy": p.intrinsics.fy, "cx": p.intrinsics.cx, "cy": p.intrinsics.cy,
                       "width": p.intrinsics.width, "height": p.intrinsics.height},
    }


@server.tool()
def imu() -> dict:
    """Latest IMU sample (accel m/s², gyro rad/s)."""
    _need()
    s = _latest.get("imu")
    if s is None:
        return {"error": "no IMU sample received yet"}
    return {"device_time_s": s.header.device_time_ns / 1e9,
            "accel": [s.accel.x, s.accel.y, s.accel.z], "gyro": [s.gyro.x, s.gyro.y, s.gyro.z]}


@server.tool()
def snapshot(stream: str = "rgb", max_width: int = 960) -> Image:
    """Latest camera frame (stream "rgb") or LiDAR depth (stream "depth", colour-mapped) as a JPEG image."""
    from PIL import Image as PILImage

    dev = _need()
    if stream == "rgb":
        from .video import H264Decoder

        dec = H264Decoder()
        img = None
        t0 = time.time()
        for f in dev.iter("rgb", timeout=3):
            for img in dec.decode(f):
                pass
            if img is not None or time.time() - t0 > 3:
                break
        if img is None:
            raise RuntimeError("no video frame decoded (is rgb enabled and the session started?)")
        pil = PILImage.fromarray(img)
    elif stream == "depth":
        import numpy as np

        from .depth import decode

        f = _latest.get("depth")
        if f is None:
            for f in dev.iter("depth", timeout=3):
                break
        if f is None:
            raise RuntimeError("no depth frame (enable depth.enabled and start the session)")
        d, _ = decode(f)
        m = d.astype("float32") / 1000.0
        norm = np.clip(m / 5.0, 0, 1)
        rgb = np.stack([(255 * norm), (255 * (1 - abs(norm - 0.5) * 2)), (255 * (1 - norm))], axis=-1).astype("uint8")
        rgb[d == 0] = 0
        pil = PILImage.fromarray(rgb)
    else:
        raise ValueError("stream must be 'rgb' or 'depth'")
    if pil.width > max_width:
        pil = pil.resize((max_width, int(pil.height * max_width / pil.width)))
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=85)
    return Image(data=buf.getvalue(), format="jpeg")


@server.tool()
def record(path: str, seconds: float = 5.0, streams: str = "") -> dict:
    """Record all (or comma-separated) streams to an MCAP file for `seconds`. Starts the session if needed."""
    from .mcap_io import McapRecorder, summary

    dev = _need()
    if streams:
        dev.subscribe([s.stream_id for s in dev.capabilities.streams], unsubscribe=True)
        dev.subscribe(streams.split(","))
    dev.start()
    field = {pb.ImuSample: "imu", pb.PoseSample: "pose", pb.VideoFrame: "video", pb.DepthFrame: "depth", pb.Gap: "gap", pb.DeviceHealth: "health"}
    with McapRecorder(path, dev.info, dev.capabilities, dev.clock_offset_ns) as rec:
        rec.write_config(dev.config)
        t_end = time.time() + seconds
        for _stream, sample in dev.iter(None, timeout=5):
            rec.write(pb.DataMessage(**{field[type(sample)]: sample}))
            if time.time() > t_end:
                break
    if streams:
        dev.subscribe([s.stream_id for s in dev.capabilities.streams])
    return {"path": path, "messages": rec.count, "topics": summary(path)}


@server.tool()
def mcap_info(path: str) -> dict:
    """Message counts per topic in an MCAP file."""
    from .mcap_io import summary

    return summary(path)


@server.tool()
def version() -> str:
    """imuninn client library version."""
    return __version__


def main() -> None:
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
