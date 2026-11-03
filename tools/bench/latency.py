#!/usr/bin/env python3
"""End-to-end latency / drop / bandwidth benchmark (tools/bench, design doc §3).

    host/python/.venv/bin/python tools/bench/latency.py [phone] [--seconds 10] [--depth] [--json out.json]

Measures, per stream, the one-way latency from capture on the phone to arrival in
Python: (pc_recv_time) - (device_time + clock_offset). The clock offset comes from
the NTP-style handshake, so absolute numbers carry its error (≈ RTT/2); the spread
and the per-stream differences are what matter. Also reports control RTT, drops,
and bytes/s.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "host" / "python" / "src"))

import imuninn  # noqa: E402
from imuninn.proto import imuninn_pb2 as pb  # noqa: E402


def pct(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    k = min(len(xs) - 1, max(0, int(round(p / 100 * (len(xs) - 1)))))
    return xs[k]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", default="")
    ap.add_argument("--seconds", type=float, default=10.0)
    ap.add_argument("--depth", action="store_true", help="enable the depth stream too")
    ap.add_argument("--rtt-rounds", type=int, default=50)
    ap.add_argument("--json", default=None, help="write results here")
    args = ap.parse_args()

    with imuninn.connect(args.target) as dev:
        print(f"connected: {dev!r}  offset {dev.clock_offset_ns / 1e6:.3f} ms")

        # control RTT distribution
        rtts = []
        for _ in range(args.rtt_rounds):
            t0 = time.perf_counter()
            dev.time_sync.__self__._call(dev._client.request(pb.ControlMessage(get_config=pb.GetConfig())))  # noqa: SLF001
            rtts.append((time.perf_counter() - t0) * 1000)
        print(f"control RTT: median {statistics.median(rtts):.2f} ms, p95 {pct(rtts, 95):.2f} ms, max {max(rtts):.2f} ms")

        if args.depth:
            dev.set("depth.enabled", True)
        dev.start()
        time.sleep(1.5)  # let sources settle
        dev.time_sync()
        offset = dev.clock_offset_ns

        lat: dict[str, list[float]] = defaultdict(list)
        bytes_: dict[str, int] = defaultdict(int)
        count: dict[str, int] = defaultdict(int)
        t_end = time.time() + args.seconds
        for stream, sample in dev.iter(None, timeout=5):
            now = time.time_ns()
            lat[stream].append((now - (sample.header.device_time_ns + offset)) / 1e6)
            bytes_[stream] += sample.ByteSize()
            count[stream] += 1
            if time.time() > t_end:
                break
        dev.stop()
        elapsed = args.seconds

        rows = []
        print(f"\n{'stream':8s} {'rate':>8s} {'drop':>6s} {'Mbit/s':>7s} {'lat med':>8s} {'p95':>7s} {'p99':>7s} {'max':>7s}")
        for stream in sorted(lat):
            xs = lat[stream]
            st = dev.stats[stream]
            row = {
                "stream": stream, "count": count[stream], "rate_hz": count[stream] / elapsed,
                "dropped": st.dropped, "mbps": bytes_[stream] * 8 / elapsed / 1e6,
                "latency_ms": {"median": statistics.median(xs), "p95": pct(xs, 95), "p99": pct(xs, 99), "max": max(xs)},
            }
            rows.append(row)
            l = row["latency_ms"]
            print(f"{stream:8s} {row['rate_hz']:7.1f}  {st.dropped:6d} {row['mbps']:7.2f} {l['median']:8.1f} {l['p95']:7.1f} {l['p99']:7.1f} {l['max']:7.1f}")
        print("\nlatency = capture on phone -> sample available in Python, in ms (includes clock-offset error ≈ RTT/2)")

        if args.json:
            out = {
                "device": dev.info.model, "host": dev._client.host, "seconds": elapsed,  # noqa: SLF001
                "control_rtt_ms": {"median": statistics.median(rtts), "p95": pct(rtts, 95), "max": max(rtts)},
                "streams": rows,
            }
            Path(args.json).write_text(json.dumps(out, indent=2))
            print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
