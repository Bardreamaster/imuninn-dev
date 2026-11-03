from __future__ import annotations

import argparse

from . import DEFAULT_CONTROL_PORT, DEFAULT_DATA_PORT, PROTOCOL_VERSION, __version__


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="imuninn", description="iMuninn PC gateway")
    p.add_argument("--version", action="version", version=f"imuninn {__version__} (protocol v{PROTOCOL_VERSION})")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gateway", help="run the gateway (mDNS + control + UDP), print stream rates")
    g.add_argument("--name", help="service name shown to phones (default: hostname)")
    g.add_argument("--port", type=int, default=DEFAULT_CONTROL_PORT, help="control WebSocket port")
    g.add_argument("--data-port", type=int, default=DEFAULT_DATA_PORT, help="UDP data port")

    w = sub.add_parser("watch", help="print incoming samples (pose / imu) as text")
    w.add_argument("--stream", default=None, help="only this stream id (default: all)")
    w.add_argument("--every", type=int, default=30, help="print one sample out of N")
    w.add_argument("--start", action="store_true", help="send SessionControl START after connect")

    args = p.parse_args(argv)
    if args.cmd == "gateway":
        from .gateway import run_gateway

        run_gateway(args.name, args.port, args.data_port)
    elif args.cmd == "watch":
        _watch(args)


def _watch(args) -> None:
    import logging

    from .proto import imuninn_pb2 as pb
    from .session import open as open_session

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    with open_session() as s:
        print("waiting for a phone...")
        dev = s.wait_for_device()
        print(f"connected: {dev!r}")
        if args.start:
            dev.start()
        n = 0
        for stream, sample in s.iter(None):
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
            else:
                print(f"{stream} seq={sample.header.seq} t={t:.3f}")
