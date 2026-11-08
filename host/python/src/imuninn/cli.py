from __future__ import annotations

import argparse
import logging

from . import PROTOCOL_VERSION, __version__


def build_parser() -> argparse.ArgumentParser:
    """The `imuninn` command-line parser (also used to generate the CLI reference)."""
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

    r = sub.add_parser("rerun", help="visualise pose / trajectory / video / depth / IMU / health live in the Rerun viewer")
    r.add_argument("targets", nargs="*", default=[], metavar="target",
                   help="phone name, host, or host:port; several for a multi-device view (default: first phone found)")
    r.add_argument("--start", action="store_true", help="send SessionControl START after connect")
    r.add_argument("--depth", action="store_true", help="enable the depth stream on the phone(s) first")
    r.add_argument("--no-spawn", action="store_true", help="connect to an already running viewer")
    r.add_argument("--video", choices=("decode", "stream", "off"), default="decode",
                   help="decode: PyAV in this client (default); stream: hand H.264 to the viewer "
                        "(viewer-side ffmpeg, stutters at 60 fps); off")
    r.add_argument("--every", type=int, default=1, help="with --video decode: show one frame out of N")
    r.add_argument("--scale", type=float, default=0.5,
                   help="with --video decode: downscale frames for the viewer (1 = full size)")
    r.add_argument("--buffer-ms", type=float, default=0.0,
                   help="playout buffer: release samples in device-time order this many ms late, "
                        "smoothing bursty Wi-Fi delivery (try 150)")
    r.add_argument("--port", type=int, default=None,
                   help="spawn / connect to a viewer on this port instead of the default 9876 (own viewer)")
    r.add_argument("--points", action="store_true",
                   help="back-project depth into a Points3D cloud on the PC (RGB-coloured with --video decode)")
    r.add_argument("--point-stride", type=int, default=2, help="subsample the depth map for --points")
    r.add_argument("--points-hz", type=float, default=10.0, help="rate cap for --points and the confidence image (0 = every frame)")
    r.add_argument("--no-trajectory", action="store_true", help="do not draw the camera path")
    r.add_argument("--no-blueprint", action="store_true", help="keep the viewer's own layout")
    r.add_argument("--mcap", default=None, help="replay this MCAP file instead of connecting to a phone")
    r.add_argument("--save", default=None, help="write a .rrd file instead of opening the viewer")
    r.add_argument("--seconds", type=float, default=None, help="stop after this long (live mode)")

    rec = sub.add_parser("record", help="record all subscribed streams to an MCAP file")
    add_target(rec)
    rec.add_argument("-o", "--output", default=None, help="output .mcap (default: imuninn-<time>.mcap)")
    rec.add_argument("--streams", default=None, help="comma-separated stream ids (default: all)")
    rec.add_argument("--depth", action="store_true", help="enable the depth stream before recording")

    cv = sub.add_parser("convert", help="convert a phone-side .imuninn recording to MCAP")
    cv.add_argument("input")
    cv.add_argument("-o", "--output", default=None)

    info = sub.add_parser("info", help="message counts per topic in an MCAP file")
    info.add_argument("input")

    pr = sub.add_parser("profile", help="apply / save / list YAML configuration presets")
    prs = pr.add_subparsers(dest="pcmd", required=True)
    pa = prs.add_parser("apply", help="apply a built-in profile name or a YAML file to the phone")
    pa.add_argument("profile")
    pa.add_argument("target", nargs="?", default="")
    ps = prs.add_parser("save", help="save the phone's current config as YAML")
    ps.add_argument("-o", "--output", required=True)
    ps.add_argument("target", nargs="?", default="")
    prs.add_parser("list", help="list built-in profiles")

    return p


def main(argv: list[str] | None = None) -> None:
    """Entry point of the `imuninn` command."""
    p = build_parser()
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    if args.cmd == "list":
        _list(args)
    elif args.cmd == "watch":
        _watch(args)
    elif args.cmd == "rerun":
        _rerun(args)
    elif args.cmd == "record":
        _record(args)
    elif args.cmd == "convert":
        from .mcap_io import convert

        out = args.output or str(args.input).rsplit(".", 1)[0] + ".mcap"
        n = convert(args.input, out)
        print(f"wrote {n} messages to {out}")
    elif args.cmd == "profile":
        _profile(args)
    elif args.cmd == "info":
        from .mcap_io import summary

        for topic, n in sorted(summary(args.input).items()):
            print(f"{topic:16s} {n}")


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
            elif isinstance(sample, pb.DeviceHealth):
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} thermal={pb.DeviceHealth.Thermal.Name(sample.thermal).removeprefix('THERMAL_').lower()} "
                    f"battery={sample.battery_level:.2f} {pb.DeviceHealth.BatteryState.Name(sample.battery_state).removeprefix('BATTERY_').lower()} "
                    f"pose={sample.pose_hz:.0f} imu={sample.imu_hz:.0f} video={sample.video_fps:.0f} depth={sample.depth_hz:.0f} up={sample.uptime_s:.0f}s"
                )
            elif isinstance(sample, pb.DepthFrame):
                from .depth import decode

                d, c = decode(sample)
                valid = d[d > 0]
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} {sample.width}x{sample.height} "
                    f"{len(sample.depth_mm)}+{len(sample.confidence)} B "
                    f"range {valid.min() if valid.size else 0}-{valid.max() if valid.size else 0} mm "
                    f"valid {100 * valid.size / d.size:.0f}% fx={sample.intrinsics.fx:.1f}"
                )
            elif isinstance(sample, pb.VideoFrame):
                print(
                    f"{stream} seq={sample.header.seq} t={t:.3f} {sample.width}x{sample.height} "
                    f"{'I' if sample.keyframe else 'P'} {len(sample.data)} B rot={sample.rotation_deg} fx={sample.intrinsics.fx:.1f}"
                )
            else:
                print(f"{stream} seq={sample.header.seq} t={t:.3f}")


def _rerun(args) -> None:
    from contextlib import ExitStack

    from .rerun_bridge import run_devices, run_mcap
    from .session import connect

    kw = dict(spawn=not args.no_spawn, save=args.save, use_blueprint=not args.no_blueprint, port=args.port,
              video=args.video, every_nth_video=args.every, video_scale=args.scale, points=args.points,
              point_stride=args.point_stride, points_hz=args.points_hz, trajectory=not args.no_trajectory)
    if args.mcap:
        counts = run_mcap(args.mcap, **kw)
        print(f"replayed: {counts}")
        return
    with ExitStack() as stack:
        devs = [stack.enter_context(connect(t)) for t in (args.targets or [""])]
        for dev in devs:
            print(f"connected: {dev!r}")
            if args.depth:
                dev.set("depth.enabled", True)
            if args.start:
                dev.start()
        if args.seconds:
            import threading

            threading.Timer(args.seconds, lambda: [d.close() for d in devs]).start()
        try:
            run_devices(devs, buffer_ms=args.buffer_ms, **kw)
        except Exception as e:  # queue ends when every device closes
            if any(d.connected for d in devs):
                raise
            print(f"stopped: {e}")


def _record(args) -> None:
    import time

    from .mcap_io import McapRecorder
    from .proto import imuninn_pb2 as pb
    from .session import connect

    out = args.output or time.strftime("imuninn-%Y%m%d-%H%M%S.mcap")
    with connect(args.target) as dev:
        print(f"connected: {dev!r}")
        if args.depth:
            dev.set("depth.enabled", True)
        if args.streams:
            dev.subscribe([s.stream_id for s in dev.capabilities.streams], unsubscribe=True)
            dev.subscribe(args.streams.split(","))
        with McapRecorder(out, dev.info, dev.capabilities, dev.clock_offset_ns) as rec:
            rec.write_config(dev.config)
            dev.on("__event__", lambda e: rec.write_config(dev.config) if e == "config" else None)
            if args.start:
                dev.start()
            print(f"recording to {out} … Ctrl-C to stop")
            t0 = time.time()
            try:
                for stream, sample in dev.iter(None):
                    rec.write(pb.DataMessage(**{_stream_field(sample): sample}))
                    if time.time() - t0 > 5:
                        t0 = time.time()
                        print(f"  {rec.count} messages; " + ", ".join(f"{k} {v.rate_hz:.0f} Hz" for k, v in dev.stats.items()))
            except KeyboardInterrupt:
                pass
        print(f"wrote {rec.count} messages to {out}")


def _profile(args) -> None:
    from .profiles import builtin_profiles, resolve_path
    from .session import connect

    if args.pcmd == "list":
        for name in builtin_profiles():
            print(f"{name:16s} {resolve_path(name)}")
        return
    with connect(args.target) as dev:
        if args.pcmd == "apply":
            r = dev.apply_profile(args.profile)
            for f in r.fields:
                status = pb_status(f.status)
                print(f"  {f.key:28s} {status:9s} {f.reason}")
            print(f"config v{r.config_version}{' (session restarted)' if r.session_restarted else ''}")
        elif args.pcmd == "save":
            dev.save_profile(args.output)
            print(f"saved {args.output}")


def pb_status(status) -> str:
    from .proto import imuninn_pb2 as pb

    return pb.ConfigResult.FieldResult.Status.Name(status).removeprefix("STATUS_").lower()


def _stream_field(sample) -> str:
    from .proto import imuninn_pb2 as pb

    return {pb.ImuSample: "imu", pb.PoseSample: "pose", pb.VideoFrame: "video",
            pb.DepthFrame: "depth", pb.Gap: "gap", pb.DeviceHealth: "health"}[type(sample)]
