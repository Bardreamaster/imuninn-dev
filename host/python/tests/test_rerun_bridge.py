"""Offline check of the Rerun sink: synthetic MCAP -> .rrd, no viewer."""

import math
import struct

import lz4.block
import numpy as np
import pytest

from imuninn.mcap_io import McapRecorder
from imuninn.proto import imuninn_pb2 as pb

rr = pytest.importorskip("rerun")


def _apple_lz4(raw: bytes) -> bytes:
    comp = lz4.block.compress(raw, store_size=False)
    return b"bv41" + struct.pack("<II", len(raw), len(comp)) + comp + b"bv4$"


def _h264_frames(n: int, w: int = 64, h: int = 48) -> list[tuple[bytes, bool]]:
    """Annex-B H.264 frames from PyAV, or [] when the bundled FFmpeg has no H.264 encoder."""
    try:
        import av
    except ImportError:
        return []
    out = []
    for name in ("libopenh264", "h264_videotoolbox", "libx264"):
        try:
            ctx = av.CodecContext.create(name, "w")
        except Exception:
            continue
        ctx.width, ctx.height, ctx.pix_fmt = w, h, "yuv420p"
        from fractions import Fraction

        ctx.time_base = Fraction(1, 30)
        ctx.framerate = Fraction(30, 1)
        try:
            ctx.open()
        except Exception:
            continue
        for i in range(n):
            img = np.zeros((h, w, 3), np.uint8)
            img[:, : (i + 1) * w // n] = (255, 128, 0)
            frame = av.VideoFrame.from_ndarray(img, format="rgb24").reformat(format="yuv420p")
            frame.pts = i
            for pkt in ctx.encode(frame):
                out.append((bytes(pkt), bool(pkt.is_keyframe)))
        for pkt in ctx.encode(None):
            out.append((bytes(pkt), bool(pkt.is_keyframe)))
        if out:
            # videotoolbox emits AVCC (length-prefixed); the phone sends Annex-B. Convert if needed.
            if not out[0][0].startswith(b"\x00\x00\x00\x01") and not out[0][0].startswith(b"\x00\x00\x01"):
                out = [(_avcc_to_annexb(d), k) for d, k in out]
                if ctx.extradata:
                    out[0] = (_extradata_to_annexb(ctx.extradata) + out[0][0], out[0][1])
            return out
    return []


def _avcc_to_annexb(data: bytes) -> bytes:
    i, parts = 0, []
    while i + 4 <= len(data):
        n = int.from_bytes(data[i:i + 4], "big")
        parts.append(b"\x00\x00\x00\x01" + data[i + 4:i + 4 + n])
        i += 4 + n
    return b"".join(parts)


def _extradata_to_annexb(ex: bytes) -> bytes:
    # avcC: skip 5 bytes header, then SPS count (low 5 bits), SPS entries, PPS count, PPS entries
    i = 5
    n_sps = ex[i] & 0x1F
    i += 1
    out = b""
    for _ in range(n_sps):
        n = int.from_bytes(ex[i:i + 2], "big")
        out += b"\x00\x00\x00\x01" + ex[i + 2:i + 2 + n]
        i += 2 + n
    n_pps = ex[i]
    i += 1
    for _ in range(n_pps):
        n = int.from_bytes(ex[i:i + 2], "big")
        out += b"\x00\x00\x00\x01" + ex[i + 2:i + 2 + n]
        i += 2 + n
    return out


def make_synthetic_mcap(path, seconds: float = 2.0, with_video: bool = True) -> dict:
    """A phone walking a circle: pose 30 Hz, IMU 100 Hz, depth 5 Hz, health 1 Hz, one gap, one config."""
    frames = _h264_frames(int(seconds * 10)) if with_video else []
    info = pb.DeviceInfo(device_id="synthetic", device_name="Synthetic iPhone", model="iPhone18,1",
                         platform=pb.PLATFORM_IOS, protocol_version=3, has_lidar=True)
    counts = {"pose": 0, "imu": 0, "depth": 0, "health": 0, "video": 0}
    ns = lambda t: int(t * 1e9)  # noqa: E731
    with McapRecorder(path, info, clock_offset_ns=1_700_000_000_000_000_000) as rec:
        rec.write_config(pb.DeviceConfig(config_version=1, mode=pb.SESSION_MODE_AR,
                                         streams=[pb.StreamConfig(stream_id="rgb", enabled=True)]))
        t = 0.0
        seq = {k: 0 for k in counts}

        def hdr(stream, key):
            seq[key] += 1
            counts[key] += 1
            return pb.Header(stream_id=stream, seq=seq[key], device_time_ns=ns(t), protocol_version=3, config_version=1)

        while t < seconds:
            if abs((t * 100) % 1) < 1e-6:
                m = pb.DataMessage()
                m.imu.header.CopyFrom(hdr("imu", "imu"))
                m.imu.accel.CopyFrom(pb.Vec3(x=0.1 * math.sin(t), y=9.81, z=0.1 * math.cos(t)))
                m.imu.gyro.CopyFrom(pb.Vec3(x=0, y=0.5, z=0))
                rec.write(m)
            if abs((t * 30) % 1) < 1e-6 or abs((t * 30) % 1 - 1) < 1e-6:
                m = pb.DataMessage()
                m.pose.header.CopyFrom(hdr("ar_pose", "pose"))
                a = t * 0.5
                m.pose.position.CopyFrom(pb.Vec3(x=math.cos(a), y=1.2, z=math.sin(a)))
                m.pose.orientation.CopyFrom(pb.Quat(x=0, y=math.sin(a / 2), z=0, w=math.cos(a / 2)))
                m.pose.tracking = pb.TRACKING_STATE_NORMAL if t > 0.3 else pb.TRACKING_STATE_LIMITED
                m.pose.intrinsics.CopyFrom(pb.Intrinsics(width=64, height=48, fx=50, fy=50, cx=32, cy=24))
                rec.write(m)
            if abs((t * 5) % 1) < 1e-6:
                w, h = 16, 12
                d = np.full((h, w), 1500, "<u2")
                d[:, :4] = 0
                c = np.full((h, w), 2, np.uint8)
                m = pb.DataMessage()
                m.depth.header.CopyFrom(hdr("depth", "depth"))
                m.depth.width, m.depth.height = w, h
                m.depth.compression = pb.DEPTH_COMPRESSION_LZ4
                m.depth.depth_mm = _apple_lz4(d.tobytes())
                m.depth.confidence = _apple_lz4(c.tobytes())
                m.depth.intrinsics.CopyFrom(pb.Intrinsics(width=w, height=h, fx=12.5, fy=12.5, cx=8, cy=6))
                m.depth.rotation_deg = 90
                rec.write(m)
            if abs(t % 1) < 1e-6:
                m = pb.DataMessage()
                m.health.header.CopyFrom(hdr("health", "health"))
                m.health.thermal = pb.DeviceHealth.THERMAL_FAIR if t >= 1 else pb.DeviceHealth.THERMAL_NOMINAL
                m.health.battery_level = 0.8
                m.health.battery_state = pb.DeviceHealth.BATTERY_CHARGING
                m.health.pose_hz, m.health.imu_hz, m.health.video_fps, m.health.depth_hz = 30, 100, 10, 5
                m.health.video_kbps = 1200
                rec.write(m)
            if frames and abs((t * 10) % 1) < 1e-6:
                i = int(round(t * 10))
                if i < len(frames):
                    data, key = frames[i]
                    m = pb.DataMessage()
                    m.video.header.CopyFrom(hdr("rgb", "video"))
                    m.video.format = pb.PIXEL_FORMAT_H264_NAL
                    m.video.width, m.video.height, m.video.keyframe, m.video.data = 64, 48, key, data
                    m.video.intrinsics.CopyFrom(pb.Intrinsics(width=64, height=48, fx=50, fy=50, cx=32, cy=24))
                    m.video.rotation_deg = 90
                    rec.write(m)
            if abs(t - 1.0) < 1e-9:
                m = pb.DataMessage()
                m.gap.header.CopyFrom(pb.Header(stream_id="rgb", seq=0, device_time_ns=ns(t)))
                m.gap.reason = "session restarted"
                rec.write(m)
            t = round(t + 0.01, 6)
    return counts


@pytest.mark.parametrize("video", ["stream", "decode", "off"])
def test_replay_to_rrd(tmp_path, video):
    from imuninn.rerun_bridge import run_mcap

    mcap = tmp_path / "syn.mcap"
    made = make_synthetic_mcap(mcap, seconds=2.0)
    rrd = tmp_path / f"out-{video}.rrd"
    counts = run_mcap(str(mcap), spawn=False, save=str(rrd), video=video, points=True, point_stride=1)
    (name, c), = counts.items()
    assert name == "synthetic_iphone"
    assert c["ar_pose"] == made["pose"] and c["imu"] == made["imu"]
    assert c["depth"] == made["depth"] and c["health"] == made["health"]
    assert c["rgb"] == made["video"]
    rr.disconnect()
    assert rrd.stat().st_size > 10_000


def test_sink_entities_and_timelines(tmp_path):
    """Everything lands under world/<name>, plots/<name>, events/<name> with pc/device/seq timelines."""
    import rerun as rr

    from imuninn.mcap_io import replay_timed
    from imuninn.rerun_bridge import RerunSink, device_entity_name

    assert device_entity_name("Jinqi's iPhone") == "jinqis_iphone"
    assert device_entity_name("") == "phone"
    mcap = tmp_path / "syn.mcap"
    make_synthetic_mcap(mcap, seconds=1.0, with_video=False)
    rec = rr.RecordingStream("imuninn-test")
    rrd = tmp_path / "sink.rrd"
    rec.save(str(rrd))
    sink = RerunSink(rr, "dev_a", video="off", points=True, point_stride=1, recording=rec)
    for stream, sample, log_time in replay_timed(mcap):
        sink.log(stream, sample, log_time_ns=log_time)
    sink.flush()
    assert sink._traj and len(sink._traj) >= 2
    assert sink._tracking == pb.TRACKING_STATE_NORMAL and sink._thermal == pb.DeviceHealth.THERMAL_NOMINAL
    rec.disconnect()
    paths = rrd.read_bytes()
    for ent in (b"world/dev_a/trajectory", b"world/dev_a/depth/image", b"world/dev_a/points",
                b"plots/dev_a/imu/accel", b"events/dev_a"):
        assert ent in paths, ent
