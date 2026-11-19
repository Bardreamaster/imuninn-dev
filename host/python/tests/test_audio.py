import struct
import wave

import numpy as np
import pytest

from imuninn import audio
from imuninn.mcap_io import MAGIC, McapRecorder, summary
from imuninn.proto import imuninn_pb2 as pb


def _chunk(seq: int, x: np.ndarray, rate: int = 16000, f32: bool = False, t0_ns: int = 5_000_000_000) -> pb.AudioChunk:
    c = pb.AudioChunk(sample_rate=rate, channels=1, frame_count=len(x),
                      encoding=pb.AUDIO_ENCODING_PCM_F32LE if f32 else pb.AUDIO_ENCODING_PCM_S16LE)
    c.header.stream_id = "audio"
    c.header.seq = seq
    c.header.device_time_ns = t0_ns + seq * len(x) * 1_000_000_000 // rate
    c.data = x.astype("<f4").tobytes() if f32 else (x * 32767).astype("<i2").tobytes()
    return c


def test_to_numpy_times_and_level():
    x = np.sin(np.linspace(0, 2 * np.pi, 320, endpoint=False)).astype(np.float32)
    c = _chunk(0, x)
    y = audio.to_numpy(c)
    assert y.shape == (320, 1) and y.dtype == np.float32
    assert np.allclose(y[:, 0], x, atol=1e-4)
    assert audio.to_numpy(c, dtype="native").dtype == np.int16
    t = audio.frame_times_ns(c)
    assert t[0] == c.header.device_time_ns and t[1] - t[0] == 62_500  # 1/16 kHz
    assert abs(audio.level_dbfs(c) - 20 * np.log10(1 / np.sqrt(2))) < 0.1   # sine RMS = -3 dBFS
    f = _chunk(0, x, f32=True)
    assert np.allclose(audio.to_numpy(f)[:, 0], x)


def test_wav_export_fills_gaps(tmp_path):
    x = np.full(320, 0.25, dtype=np.float32)
    chunks = [_chunk(i, x) for i in (0, 1, 3)]          # chunk 2 lost
    w = audio.export_wav(None, tmp_path / "a.wav", chunks=chunks)
    assert w.gaps == 1 and w.frames == 4 * 320
    with wave.open(str(tmp_path / "a.wav")) as r:
        assert r.getframerate() == 16000 and r.getnchannels() == 1 and r.getsampwidth() == 2
        y = np.frombuffer(r.readframes(r.getnframes()), dtype="<i2")
    assert len(y) == 4 * 320 and np.all(y[640:960] == 0) and y[0] == int(0.25 * 32767)


def test_wav_float32(tmp_path):
    x = np.linspace(-1, 1, 480, dtype=np.float32)
    w = audio.export_wav(None, tmp_path / "f.wav", chunks=[_chunk(0, x, rate=48000, f32=True)])
    raw = (tmp_path / "f.wav").read_bytes()
    assert raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    fmt_tag, ch, rate = struct.unpack("<HHI", raw[20:28])
    assert (fmt_tag, ch, rate) == (3, 1, 48000) and w.frames == 480
    assert np.allclose(np.frombuffer(raw[44:], dtype="<f4"), x)


def test_format_change_rejected(tmp_path):
    w = audio.WavWriter(tmp_path / "x.wav")
    w.write(_chunk(0, np.zeros(160, np.float32)))
    with pytest.raises(ValueError):
        w.write(_chunk(1, np.zeros(160, np.float32), rate=48000))
    w.close()


def test_audio_through_mcap_and_phone_recording(tmp_path):
    pytest.importorskip("mcap_protobuf")
    x = np.full(320, 0.5, dtype=np.float32)
    msgs = [pb.DataMessage(audio=_chunk(i, x)) for i in range(3)]
    with McapRecorder(tmp_path / "a.mcap") as rec:
        for m in msgs:
            rec.write(m)
    assert summary(tmp_path / "a.mcap")["/audio"] == 3
    got = list(audio.iter_chunks(tmp_path / "a.mcap"))
    assert [c.header.seq for c in got] == [0, 1, 2] and isinstance(got[0], pb.AudioChunk)

    phone = tmp_path / "p.imuninn"
    with open(phone, "wb") as f:
        f.write(MAGIC)
        for m in msgs:
            b = m.SerializeToString()
            f.write(len(b).to_bytes(4, "little") + b)
    w = audio.export_wav(phone, tmp_path / "p.wav")
    assert w.frames == 960 and w.first_time_ns == 5_000_000_000
