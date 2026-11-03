import struct

import lz4.block
import numpy as np

from imuninn import depth as depth_mod
from imuninn.mcap_io import McapRecorder, convert, read_phone_recording, replay, summary
from imuninn.proto import imuninn_pb2 as pb


def _apple_lz4(raw: bytes) -> bytes:
    """Build Apple-framed LZ4 the way Compression.framework does (one bv41 block)."""
    comp = lz4.block.compress(raw, store_size=False)
    return b"bv41" + struct.pack("<II", len(raw), len(comp)) + comp + b"bv4$"


def test_depth_decode_lz4_and_rotation():
    h, w = 4, 6
    d = (np.arange(h * w, dtype="<u2") * 100).reshape(h, w)
    c = np.full((h, w), 2, dtype=np.uint8)
    f = pb.DepthFrame(width=w, height=h, compression=pb.DEPTH_COMPRESSION_LZ4,
                      depth_mm=_apple_lz4(d.tobytes()), confidence=_apple_lz4(c.tobytes()), rotation_deg=90)
    dd, cc = depth_mod.decode(f, upright=False)
    assert dd.shape == (h, w) and np.array_equal(dd, d) and cc.shape == (h, w)
    up, _ = depth_mod.decode(f, upright=True)
    assert up.shape == (w, h) and up[0, 0] == d[h - 1, 0]  # 90° clockwise
    m = depth_mod.to_metres(dd)
    assert np.isnan(m[0, 0]) and abs(m[0, 1] - 0.1) < 1e-6


def test_mcap_record_convert_replay(tmp_path):
    msgs = []
    for i in range(3):
        m = pb.DataMessage()
        m.imu.header.stream_id = "imu"
        m.imu.header.seq = i
        m.imu.header.device_time_ns = 1_000_000 * i
        m.imu.accel.z = -9.81
        msgs.append(m)
    v = pb.DataMessage()
    v.video.header.stream_id = "rgb"
    v.video.header.device_time_ns = 1_500_000
    v.video.data = b"\x00\x00\x00\x01"
    msgs.append(v)

    # phone-side recording file -> mcap
    rec_file = tmp_path / "r.imuninn"
    with open(rec_file, "wb") as f:
        f.write(b"IMUNINN1")
        for m in msgs:
            p = m.SerializeToString()
            f.write(len(p).to_bytes(4, "little") + p)
    assert len(list(read_phone_recording(rec_file))) == 4
    out = tmp_path / "r.mcap"
    assert convert(rec_file, out) == 4
    assert summary(out) == {"/imu": 3, "/rgb": 1}

    # live recorder with device info and config, then replay in order
    out2 = tmp_path / "live.mcap"
    with McapRecorder(out2, pb.DeviceInfo(model="iPhone18,1"), clock_offset_ns=10) as rec:
        rec.write_config(pb.DeviceConfig(config_version=3))
        for m in msgs:
            rec.write(m)
    seq = [(s, type(x).__name__) for s, x in replay(out2)]
    assert ("config", "ConfigChanged") in seq
    imu_seqs = [x.header.seq for s, x in replay(out2, topics=["/imu"])]
    assert imu_seqs == [0, 1, 2]  # replay is ordered by log_time = device_time + offset
    assert summary(out2)["/device"] == 1 and summary(out2)["/config"] == 1
