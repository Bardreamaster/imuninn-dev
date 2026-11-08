#!/usr/bin/env python3
"""Generate a synthetic iMuninn MCAP recording (no phone needed) for testing viewers:
pose 60 Hz on a circle, IMU 100 Hz, LiDAR-like depth 10 Hz (Apple-framed LZ4), health 1 Hz,
and H.264 video 30 Hz encoded with ffmpeg's test pattern.

    python tools/bench/synth_mcap.py -o synth.mcap --seconds 20
"""

from __future__ import annotations

import argparse
import math
import struct
import subprocess
import tempfile

import lz4.block
import numpy as np

from imuninn.mcap_io import McapRecorder
from imuninn.proto import imuninn_pb2 as pb


def apple_lz4(raw: bytes) -> bytes:
    comp = lz4.block.compress(raw, store_size=False)
    return b"bv41" + struct.pack("<II", len(raw), len(comp)) + comp + b"bv4$"


def h264_access_units(w: int, h: int, fps: int, seconds: float) -> list[tuple[bytes, bool]]:
    """ffmpeg testsrc -> Annex-B, split into access units (bytes, is_keyframe)."""
    with tempfile.NamedTemporaryFile(suffix=".h264") as f:
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
             "-i", f"testsrc2=size={w}x{h}:rate={fps}", "-t", str(seconds),
             "-c:v", "libx264", "-profile:v", "baseline", "-preset", "veryfast",
             "-g", str(fps), "-bf", "0", "-x264-params", "repeat-headers=1:sliced-threads=0:slices=1",
             "-f", "h264", f.name],
            check=True,
        )
        data = open(f.name, "rb").read()
    # NAL boundaries (00 00 01 / 00 00 00 01)
    starts = []
    i = 0
    while True:
        j = data.find(b"\x00\x00\x01", i)
        if j < 0:
            break
        s = j - 1 if j > 0 and data[j - 1] == 0 else j
        starts.append((s, j + 3))
        i = j + 3
    nals = [(data[s:(starts[k + 1][0] if k + 1 < len(starts) else len(data))], data[hdr] & 0x1F)
            for k, (s, hdr) in enumerate(starts)]
    aus: list[tuple[bytes, bool]] = []
    cur, key = [], False
    for nal, t in nals:
        if t == 9:  # AUD: skip
            continue
        cur.append(nal)
        key = key or t == 5
        if t in (1, 5):  # slice ends the access unit (single-slice encode)
            aus.append((b"".join(cur), key))
            cur, key = [], False
    expected = int(fps * seconds)
    if len(aus) != expected:
        raise RuntimeError(f"expected {expected} access units, got {len(aus)} (multi-slice encode?)")
    return aus


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--output", default="synth.mcap")
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--video-size", default="640x480")
    args = ap.parse_args()
    vw, vh = (int(x) for x in args.video_size.split("x"))
    T = args.seconds
    t0 = 1_000_000_000  # device clock origin, ns

    def header(stream: str, seq: int, t: float) -> pb.Header:
        return pb.Header(stream_id=stream, seq=seq, device_time_ns=t0 + int(t * 1e9), protocol_version=3)

    dev = pb.DeviceInfo(device_id="synth", device_name="synthetic", model="iPhone0,0", platform=pb.PLATFORM_IOS,
                        os_version="0", protocol_version=3, app_version="synth", has_lidar=True)
    with McapRecorder(args.output, dev, clock_offset_ns=0) as rec:
        # pose: circle r=1 m, one lap per 10 s, slight bob in Y; yaw follows the tangent
        for i in range(int(T * 60)):
            t = i / 60
            a = 2 * math.pi * t / 10
            m = pb.DataMessage()
            p = m.pose
            p.header.CopyFrom(header("ar_pose", i, t))
            p.position.x, p.position.y, p.position.z = math.cos(a), 0.05 * math.sin(4 * a), math.sin(a)
            yaw = -a  # heading around Y
            p.orientation.x, p.orientation.y, p.orientation.z, p.orientation.w = 0, math.sin(yaw / 2), 0, math.cos(yaw / 2)
            p.tracking = pb.TRACKING_STATE_NORMAL if t > 1 else pb.TRACKING_STATE_LIMITED
            p.intrinsics.width, p.intrinsics.height = vw, vh
            p.intrinsics.fx = p.intrinsics.fy = 500.0
            p.intrinsics.cx, p.intrinsics.cy = vw / 2, vh / 2
            rec.write(m)
        for i in range(int(T * 100)):
            t = i / 100
            m = pb.DataMessage()
            s = m.imu
            s.header.CopyFrom(header("imu", i, t))
            s.accel.x, s.accel.y, s.accel.z = 0.3 * math.sin(2 * t), 9.81 + 0.2 * math.sin(5 * t), 0.3 * math.cos(2 * t)
            s.gyro.x, s.gyro.y, s.gyro.z = 0.05 * math.sin(3 * t), 2 * math.pi / 10, 0.05 * math.cos(3 * t)
            rec.write(m)
        dw, dh = 256, 192
        yy, xx = np.mgrid[0:dh, 0:dw]
        for i in range(int(T * 10)):
            t = i / 10
            d = (1000 + 3000 * (xx / dw) + 500 * np.sin(yy / 20 + t)).astype("<u2")
            d[(xx - 128 - 60 * math.cos(t)) ** 2 + (yy - 96 - 40 * math.sin(t)) ** 2 < 400] = 0  # a hole
            conf = np.full((dh, dw), 2, np.uint8)
            conf[:, :40] = 0
            m = pb.DataMessage()
            f = m.depth
            f.header.CopyFrom(header("depth", i, t))
            f.width, f.height, f.compression = dw, dh, pb.DEPTH_COMPRESSION_LZ4
            f.depth_mm, f.confidence = apple_lz4(d.tobytes()), apple_lz4(conf.tobytes())
            f.intrinsics.width, f.intrinsics.height, f.intrinsics.fx, f.intrinsics.fy = dw, dh, 200.0, 200.0
            f.intrinsics.cx, f.intrinsics.cy = dw / 2, dh / 2
            f.rotation_deg = 90
            rec.write(m)
        for i in range(int(T)):
            m = pb.DataMessage()
            h = m.health
            h.header.CopyFrom(header("health", i, float(i)))
            h.thermal = pb.DeviceHealth.THERMAL_NOMINAL if i < T / 2 else pb.DeviceHealth.THERMAL_FAIR
            h.battery_level, h.battery_state = 0.8 - i / 1000, pb.DeviceHealth.BATTERY_UNPLUGGED
            h.pose_hz, h.imu_hz, h.video_fps, h.depth_hz, h.video_kbps, h.uptime_s = 60, 100, 30, 10, 1500, 100 + i
            rec.write(m)
        aus = h264_access_units(vw, vh, 30, T)
        for i, (au, key) in enumerate(aus):
            t = i / 30
            m = pb.DataMessage()
            v = m.video
            v.header.CopyFrom(header("rgb", i, t))
            v.format, v.width, v.height, v.keyframe, v.data, v.rotation_deg = pb.PIXEL_FORMAT_H264_NAL, vw, vh, key, au, 90
            v.intrinsics.width, v.intrinsics.height, v.intrinsics.fx, v.intrinsics.fy = vw, vh, 500.0, 500.0
            v.intrinsics.cx, v.intrinsics.cy = vw / 2, vh / 2
            rec.write(m)
        print(f"wrote {rec.count} messages ({len(aus)} video AUs, {sum(k for _, k in aus)} keyframes) to {args.output}")


if __name__ == "__main__":
    main()
