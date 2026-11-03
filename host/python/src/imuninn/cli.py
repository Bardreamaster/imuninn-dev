from __future__ import annotations

import argparse
import logging

from . import PROTOCOL_VERSION, __version__


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="imuninn", description="iMuninn PC client")
    p.add_argument("--version", action="version", version=f"imuninn {__version__} (protocol v{PROTOCOL_VERSION})")
    sub = p.add_subparsers(dest="cmd", required=True)

    ls = sub.add_parser("list", help="discover phones on the local network")
    ls.add_argument("--timeout", type=float, default=2.0)

    def add_target(sp):
        sp.add_argument("target", nargs="?", default="", help="phone name, host, or host:port (default: first phone found)")
        sp.add_argument("--start", action="store_true", help="send SessionControl START after connect")

    w = sub.add_parser("watch", help="print incoming samples as text")
    add_target(w)
    w.add_argument("--stream", default=None, help="only this stream id (default: all)")
    w.add_argument("--every", type=int, default=30, help="print one sample out of N")

    r = sub.add_parser("rerun", help="visualise pose / IMU / video live in the Rerun viewer")
    add_target(r)
    r.add_argument("--no-spawn", action="store_true", help="connect to an already running viewer")
    r.add_argument("--every", type=int, default=1, help="decode one video frame out of N")

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if args.cmd == "list":
        _list(args)
    elif args.cmd == "watch":
        _watch(args)
    elif args.cmd == "rerun":
        _rerun(args)


def _list(args) -> None:
    from .discovery import discover

    phones = discover(args.timeout)
    if not phones:
        print("no phones found (is the iMuninn app open and on the same Wi-Fi?)")
    for ph in phones:
        others = [a for a in ph.addresses if a != ph.host]
        extra = f"  (also {', '.join(others)})" if others else ""
        print(f"{ph.name:30s} {ph.address:22s} proto v{ph.protocol_version}{extra}")


def _watch(args) -> None:
    from .proto import imuninn_pb2 as pb
    from .session import connect

    with connect(args.target) as dev:
        print(f"connected: {dev!r}")
        if args.start:
            dev.start()
        n = 0
        for stream, sample in dev.iter(None):
            if args.stream and stream != args.stream:
                continue
            n += 1
            if n % args.every:
                continue
            t = sample.header.device_time_ns / 1e9
            if isinstance(sample, pb.PoseSample):
                p_, q = sample.position, sample.orientation
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} "
                    f"p=({p_.x:+.3f},{p_.y:+.3f},{p_.z:+.3f}) q=({q.x:+.3f},{q.y:+.3f},{q.z:+.3f},{q.w:+.3f}) "
                    f"{pb.TrackingState.Name(sample.tracking)}"
                )
            elif isinstance(sample, pb.ImuSample):
                a, g = sample.accel, sample.gyro
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} "
                    f"a=({a.x:+.2f},{a.y:+.2f},{a.z:+.2f}) g=({g.x:+.3f},{g.y:+.3f},{g.z:+.3f})"
                )
            elif isinstance(sample, pb.VideoFrame):
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} {sample.width}x{sample.height} "
                    f"{'I' if sample.keyframe else 'P'} {len(sample.data)} B rot={sample.rotation_deg} fx={sample.intrinsics.fx:.1f}"
                )
            else:
                print(f"{stream} seq={sample.header.seq} t={t:.3f}")


def _rerun(args) -> None:
    from .rerun_bridge import run
    from .session import connect

    with connect(args.target) as dev:
        print(f"connected: {dev!r}")
        if args.start:
            dev.start()
        run(dev, spawn=not args.no_spawn, every_nth_video=args.every)
