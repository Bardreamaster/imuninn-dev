#!/usr/bin/env python3
"""Long-run stability test: thermal state, battery and per-stream rates over hours.

    host/python/.venv/bin/python tools/bench/longrun.py [phone] --hours 4 --out docs/design/longrun-YYYYMMDD

Every `--interval` seconds it appends a CSV row (wall time, uptime, thermal, battery,
phone-side rates from DeviceHealth, PC-side rates / drops / bitrate) and at the end
(or on Ctrl-C) writes PNG charts + a summary.json. Streams flow to the PC but are not
stored (that is what we are stress-testing: capture + encode + send).
"""

from __future__ import annotations

import argparse
import csv
import json
import signal
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "host" / "python" / "src"))

import imuninn  # noqa: E402
from imuninn.proto import imuninn_pb2 as pb  # noqa: E402

FIELDS = ["wall_time", "elapsed_s", "uptime_s", "thermal", "battery", "battery_state", "low_power",
          "phone_pose_hz", "phone_imu_hz", "phone_video_fps", "phone_depth_hz", "phone_video_kbps", "encoder_dropped",
          "pc_pose_hz", "pc_imu_hz", "pc_video_fps", "pc_depth_hz", "pc_video_mbps",
          "drop_pose", "drop_imu", "drop_video", "drop_depth", "config_version"]

THERMAL_NAMES = {0: "unknown", 1: "nominal", 2: "fair", 3: "serious", 4: "critical"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", default="")
    ap.add_argument("--hours", type=float, default=4.0)
    ap.add_argument("--interval", type=float, default=10.0)
    ap.add_argument("--profile", default="dataset", help="profile to apply first (dataset = all streams on)")
    ap.add_argument("--out", default=None, help="output directory (default: longrun-<timestamp>)")
    args = ap.parse_args()

    out = Path(args.out or time.strftime("longrun-%Y%m%d-%H%M%S"))
    out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "longrun.csv"
    stop = False

    def on_sig(*_):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, on_sig)
    signal.signal(signal.SIGTERM, on_sig)

    rows: list[dict] = []
    with imuninn.connect(args.target, name="longrun") as dev:
        print(f"connected: {dev!r}", flush=True)
        r = dev.apply_profile(args.profile)
        bad = [f for f in r.fields if f.status != pb.ConfigResult.FieldResult.STATUS_APPLIED]
        print(f"profile {args.profile}: v{r.config_version}, {len(bad)} non-applied", flush=True)
        dev.start()
        t0 = time.time()
        t_end = t0 + args.hours * 3600
        window_bytes = {"rgb": 0}
        window_counts: dict[str, int] = {}
        last_window = time.time()

        def on_any(stream, sample):
            window_counts[stream] = window_counts.get(stream, 0) + 1
            if stream == "rgb":
                window_bytes["rgb"] += len(sample.data)

        dev.on("*", on_any)
        if "health" in {s.stream_id for s in dev.capabilities.streams}:
            dev.set("health.rate_hz", 1.0)

        with open(csv_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            w.writeheader()
            while not stop and time.time() < t_end:
                time.sleep(args.interval)
                now = time.time()
                dt = now - last_window
                last_window = now
                h = dev.health
                st = dev.stats
                row = {
                    "wall_time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
                    "elapsed_s": round(now - t0, 1),
                    "uptime_s": round(h.uptime_s, 1) if h else "",
                    "thermal": THERMAL_NAMES.get(h.thermal, "?") if h else "",
                    "battery": round(h.battery_level, 3) if h else "",
                    "battery_state": pb.DeviceHealth.BatteryState.Name(h.battery_state).removeprefix("BATTERY_").lower() if h else "",
                    "low_power": int(h.low_power_mode) if h else "",
                    "phone_pose_hz": round(h.pose_hz, 1) if h else "",
                    "phone_imu_hz": round(h.imu_hz, 1) if h else "",
                    "phone_video_fps": round(h.video_fps, 1) if h else "",
                    "phone_depth_hz": round(h.depth_hz, 1) if h else "",
                    "phone_video_kbps": round(h.video_kbps, 0) if h else "",
                    "encoder_dropped": h.encoder_dropped if h else "",
                    "pc_pose_hz": round(window_counts.get("ar_pose", 0) / dt, 1),
                    "pc_imu_hz": round(window_counts.get("imu", 0) / dt, 1),
                    "pc_video_fps": round(window_counts.get("rgb", 0) / dt, 1),
                    "pc_depth_hz": round(window_counts.get("depth", 0) / dt, 1),
                    "pc_video_mbps": round(window_bytes["rgb"] * 8 / dt / 1e6, 2),
                    "drop_pose": st["ar_pose"].dropped if "ar_pose" in st else 0,
                    "drop_imu": st["imu"].dropped if "imu" in st else 0,
                    "drop_video": st["rgb"].dropped if "rgb" in st else 0,
                    "drop_depth": st["depth"].dropped if "depth" in st else 0,
                    "config_version": dev.config.config_version if dev.config else "",
                }
                window_counts.clear()
                window_bytes["rgb"] = 0
                rows.append(row)
                w.writerow(row)
                f.flush()
                if len(rows) % 6 == 0:  # once a minute at 10 s
                    print(f"[{row['elapsed_s']:>7.0f}s] thermal={row['thermal']:8s} batt={row['battery']} "
                          f"pose={row['pc_pose_hz']} imu={row['pc_imu_hz']} video={row['pc_video_fps']}fps "
                          f"depth={row['pc_depth_hz']} {row['pc_video_mbps']}Mbps drops v/d={row['drop_video']}/{row['drop_depth']}",
                          flush=True)
                if not dev.connected:
                    print("phone disconnected; stopping", flush=True)
                    break
        try:
            dev.stop()
        except Exception:
            pass

    write_summary(rows, out, args)
    plot(rows, out)
    print(f"done: {len(rows)} samples -> {out}", flush=True)


def write_summary(rows: list[dict], out: Path, args) -> None:
    def col(name):
        return [float(r[name]) for r in rows if r[name] not in ("", None)]

    thermal_seq = [r["thermal"] for r in rows]
    first_non_nominal = next((r["elapsed_s"] for r in rows if r["thermal"] not in ("", "nominal")), None)
    summary = {
        "hours_requested": args.hours,
        "samples": len(rows),
        "duration_s": rows[-1]["elapsed_s"] if rows else 0,
        "thermal_states": {s: thermal_seq.count(s) for s in sorted(set(thermal_seq))},
        "first_non_nominal_s": first_non_nominal,
        "battery_start": rows[0]["battery"] if rows else None,
        "battery_end": rows[-1]["battery"] if rows else None,
        "rates": {k: {"mean": statistics.mean(v), "min": min(v), "p5": sorted(v)[int(0.05 * (len(v) - 1))]}
                  for k in ("pc_pose_hz", "pc_imu_hz", "pc_video_fps", "pc_depth_hz") if (v := col(k))},
        "video_mbps_mean": statistics.mean(col("pc_video_mbps")) if col("pc_video_mbps") else None,
        "drops_end": {k: rows[-1][k] for k in ("drop_pose", "drop_imu", "drop_video", "drop_depth")} if rows else {},
        "encoder_dropped_end": rows[-1]["encoder_dropped"] if rows else None,
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))


def plot(rows: list[dict], out: Path) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skipping charts")
        return
    if not rows:
        return
    t = [float(r["elapsed_s"]) / 60 for r in rows]
    therm = {"": 0, "unknown": 0, "nominal": 1, "fair": 2, "serious": 3, "critical": 4}
    fig, axes = plt.subplots(3, 1, figsize=(11, 10), sharex=True)
    ax = axes[0]
    ax.step(t, [therm[r["thermal"]] for r in rows], where="post", color="tab:red", label="thermal state")
    ax.set_yticks([1, 2, 3, 4]); ax.set_yticklabels(["nominal", "fair", "serious", "critical"])
    ax.set_ylim(0.5, 4.5); ax.set_ylabel("thermal"); ax.grid(alpha=0.3)
    ax2 = ax.twinx()
    batt = [float(r["battery"]) * 100 if r["battery"] != "" else float("nan") for r in rows]
    ax2.plot(t, batt, color="tab:green", label="battery %"); ax2.set_ylabel("battery %"); ax2.set_ylim(0, 105)
    ax.set_title("iMuninn long-run: thermal state and battery")
    ax = axes[1]
    for key, label in (("pc_pose_hz", "pose Hz"), ("pc_video_fps", "video fps"), ("pc_depth_hz", "depth Hz")):
        ax.plot(t, [float(r[key]) for r in rows], label=label)
    ax.plot(t, [float(r["pc_imu_hz"]) for r in rows], label="imu Hz", alpha=0.6)
    ax.set_ylabel("rate at PC"); ax.grid(alpha=0.3); ax.legend(loc="lower left", ncol=4)
    ax = axes[2]
    ax.plot(t, [float(r["pc_video_mbps"]) for r in rows], color="tab:purple", label="video Mbit/s")
    ax.set_ylabel("video Mbit/s"); ax.grid(alpha=0.3)
    ax3 = ax.twinx()
    ax3.plot(t, [float(r["drop_video"]) + float(r["drop_depth"]) for r in rows], color="tab:orange", label="drops (video+depth)")
    ax3.set_ylabel("cumulative drops")
    ax.set_xlabel("minutes")
    fig.tight_layout()
    fig.savefig(out / "longrun.png", dpi=130)
    print(f"chart -> {out / 'longrun.png'}")


if __name__ == "__main__":
    main()
