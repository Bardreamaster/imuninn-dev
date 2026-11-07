"""Configuration presets (§6.8 Profile) as YAML.

    name: calibration
    mode: ar                      # ar | camera (optional)
    session: {black_screen: true} # other session-level switches (optional)
    streams:
      imu:     {enabled: true, rate_hz: 100, raw: false}
      ar_pose: {enabled: true}
      rgb:     {enabled: true, bitrate_kbps: 6000, exposure_mode: locked, white_balance_mode: locked, focus_mode: locked}
      depth:   {enabled: true}

Everything is optional; only listed keys are sent (one SetConfig, partial update).
Built-in profiles live next to this file in `profiles/`.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from .proto import imuninn_pb2 as pb

BUILTIN_DIR = Path(__file__).parent / "profiles"


def builtin_profiles() -> list[str]:
    return sorted(p.stem for p in BUILTIN_DIR.glob("*.yaml"))


def resolve_path(name_or_path: str) -> Path:
    p = Path(name_or_path)
    if p.exists():
        return p
    b = BUILTIN_DIR / f"{name_or_path}.yaml"
    if b.exists():
        return b
    raise FileNotFoundError(f"profile '{name_or_path}' not found (file or one of {builtin_profiles()})")


def load(name_or_path: str) -> dict:
    with open(resolve_path(name_or_path)) as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError("profile must be a mapping")
    return data


def to_patch(profile: dict) -> pb.DeviceConfig:
    patch = pb.DeviceConfig()
    mode = profile.get("mode")
    if mode:
        patch.mode = {"ar": pb.SESSION_MODE_AR, "camera": pb.SESSION_MODE_CAMERA}[str(mode)]
    for key, value in (profile.get("session") or {}).items():
        _fill(patch.session_params[str(key)], value)
    for stream_id, params in (profile.get("streams") or {}).items():
        sc = patch.streams.add()
        sc.stream_id = str(stream_id)
        for key, value in (params or {}).items():
            if key == "enabled":
                sc.enabled = bool(value)
                continue
            _fill(sc.params[str(key)], value)
    return patch


def _fill(v: pb.Value, value) -> None:
    if isinstance(value, bool):
        v.b = value
    elif isinstance(value, int):
        v.i = value
    elif isinstance(value, float):
        v.f = value
    else:
        v.s = str(value)


def from_config(config: pb.DeviceConfig, name: str = "snapshot") -> dict:
    """Current DeviceConfig -> profile dict (for saving what is in effect now)."""
    out: dict = {"name": name, "mode": "camera" if config.mode == pb.SESSION_MODE_CAMERA else "ar", "streams": {}}
    if config.session_params:
        out["session"] = {k: (getattr(v, v.WhichOneof("v")) if v.WhichOneof("v") else None) for k, v in config.session_params.items()}
    for sc in config.streams:
        d: dict = {"enabled": sc.enabled}
        for k, v in sc.params.items():
            kind = v.WhichOneof("v")
            d[k] = getattr(v, kind) if kind else None
        out["streams"][sc.stream_id] = d
    return out


def dump(profile: dict, path: str | Path) -> None:
    with open(path, "w") as f:
        yaml.safe_dump(profile, f, sort_keys=False, allow_unicode=True)
