"""Microphone audio (stream ``"audio"``, protocol v6): decode ``AudioChunk`` messages and
write WAV files.

    import imuninn
    from imuninn.audio import to_numpy, frame_times_ns

    with imuninn.connect("10.0.0.5") as dev:
        dev.set("audio.enabled", True)
        dev.set("audio.sample_rate", "16000")
        dev.start()
        for chunk in dev.iter("audio"):
            x = to_numpy(chunk)                 # float32, shape (frames, channels), -1..1
            t = frame_times_ns(chunk)           # device clock, one entry per frame

    imuninn export-audio run1.mcap -o run1.wav  # from an MCAP or a phone .imuninn recording

Every chunk carries the device time of its first frame on the same clock as video, IMU and
pose, so frame ``i`` is at ``header.device_time_ns + i * 1e9 / sample_rate``.
"""

from __future__ import annotations

import wave
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np

from .proto import imuninn_pb2 as pb

__all__ = ["to_numpy", "frame_times_ns", "level_dbfs", "WavWriter", "export_wav", "iter_chunks"]


def to_numpy(chunk: pb.AudioChunk, dtype: str = "float32") -> np.ndarray:
    """Samples of one chunk as an array of shape ``(frame_count, channels)``.

    Args:
        chunk: An ``AudioChunk``.
        dtype: ``"float32"`` (default) scales to -1..1 whatever the wire format;
            ``"native"`` returns the samples as sent (int16 for PCM s16, float32 for PCM f32).
    """
    ch = max(1, chunk.channels)
    if chunk.encoding == pb.AUDIO_ENCODING_PCM_S16LE:
        x = np.frombuffer(chunk.data, dtype="<i2")
        out = x if dtype == "native" else x.astype(np.float32) / 32768.0
    elif chunk.encoding == pb.AUDIO_ENCODING_PCM_F32LE:
        out = np.frombuffer(chunk.data, dtype="<f4").astype(np.float32)
    else:
        raise ValueError(f"unsupported audio encoding {pb.AudioEncoding.Name(chunk.encoding)}")
    return out[: (out.size // ch) * ch].reshape(-1, ch)


def frame_times_ns(chunk: pb.AudioChunk) -> np.ndarray:
    """Device time (ns) of every frame in the chunk, int64."""
    n = chunk.frame_count or len(to_numpy(chunk))
    rate = chunk.sample_rate or 1
    return chunk.header.device_time_ns + (np.arange(n, dtype=np.int64) * 1_000_000_000) // rate


def level_dbfs(chunk: pb.AudioChunk) -> float:
    """RMS level of the chunk in dB full scale (``-inf`` for digital silence clipped to -120)."""
    x = to_numpy(chunk)
    if x.size == 0:
        return -120.0
    rms = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
    return max(-120.0, 20.0 * np.log10(rms)) if rms > 0 else -120.0


class WavWriter:
    """Append ``AudioChunk`` messages to a 16-bit or 32-bit-float WAV file.

    The format is taken from the first chunk; chunks with a different rate / channel count
    are rejected. Missing chunks (``header.seq`` gaps or time jumps) are filled with silence
    so the file stays aligned with the device clock, unless ``fill_gaps=False``.
    """

    def __init__(self, path: str | Path, fill_gaps: bool = True):
        self.path = Path(path)
        self.fill_gaps = fill_gaps
        self._w: wave.Wave_write | None = None
        self._f = None
        self._fmt: tuple[int, int, int] | None = None   # rate, channels, encoding
        self._next_ns: int | None = None
        self.first_time_ns: int | None = None
        self.frames = 0
        self.gaps = 0

    @property
    def sample_rate(self) -> int:
        """Sample rate of the file (0 before the first chunk)."""
        return self._fmt[0] if self._fmt else 0

    def write(self, chunk: pb.AudioChunk) -> None:
        fmt = (chunk.sample_rate, max(1, chunk.channels), chunk.encoding)
        if self._fmt is None:
            self._open(fmt)
            self.first_time_ns = chunk.header.device_time_ns
        elif fmt != self._fmt:
            raise ValueError(f"audio format changed mid-file: {self._fmt} -> {fmt}; split the recording")
        rate, ch, enc = fmt
        x = to_numpy(chunk, dtype="native")
        if self.fill_gaps and self._next_ns is not None:
            missing = round((chunk.header.device_time_ns - self._next_ns) * rate / 1e9)
            if missing > rate // 100:          # > 10 ms behind: a dropped chunk or restart
                self.gaps += 1
                self._frames(np.zeros((missing, ch), dtype=x.dtype))
        self._frames(x)
        self._next_ns = chunk.header.device_time_ns + len(x) * 1_000_000_000 // rate

    def _open(self, fmt: tuple[int, int, int]) -> None:
        rate, ch, enc = fmt
        if enc == pb.AUDIO_ENCODING_PCM_S16LE:
            self._w = wave.open(str(self.path), "wb")
            self._w.setnchannels(ch)
            self._w.setsampwidth(2)
            self._w.setframerate(rate)
        elif enc == pb.AUDIO_ENCODING_PCM_F32LE:
            # The wave module only writes integer PCM: write the float WAV header by hand.
            self._f = open(self.path, "wb")
            self._f.write(b"\0" * 44)
        else:
            raise ValueError(f"cannot write {pb.AudioEncoding.Name(enc)} to WAV")
        self._fmt = fmt

    def _frames(self, x: np.ndarray) -> None:
        data = np.ascontiguousarray(x).astype(x.dtype.newbyteorder("<"), copy=False).tobytes()
        if self._w is not None:
            self._w.writeframesraw(data)
        elif self._f is not None:
            self._f.write(data)
        self.frames += len(x)

    def close(self) -> None:
        if self._w is not None:
            self._w.close()
        elif self._f is not None and self._fmt is not None:
            import struct

            rate, ch, _ = self._fmt
            n = self.frames * ch * 4
            self._f.seek(0)
            self._f.write(b"RIFF" + struct.pack("<I", 36 + n) + b"WAVE"
                          + b"fmt " + struct.pack("<IHHIIHH", 16, 3, ch, rate, rate * ch * 4, ch * 4, 32)
                          + b"data" + struct.pack("<I", n))
            self._f.close()
        self._w = self._f = None

    def __enter__(self) -> "WavWriter":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def iter_chunks(path: str | Path) -> Iterator[pb.AudioChunk]:
    """``AudioChunk`` messages from an MCAP file or a phone-side ``.imuninn`` recording."""
    path = Path(path)
    with open(path, "rb") as f:
        head = f.read(8)
    from .mcap_io import MAGIC, read_phone_recording, replay

    if head == MAGIC:
        for msg in read_phone_recording(path):
            if msg.WhichOneof("body") == "audio":
                yield msg.audio
    else:
        for _, sample in replay(path, topics=["/audio"]):
            yield sample


def export_wav(src: str | Path, dst: str | Path, fill_gaps: bool = True,
               chunks: Iterable[pb.AudioChunk] | None = None) -> WavWriter:
    """Write the ``audio`` stream of a recording (MCAP or ``.imuninn``) to a WAV file.

    Returns the closed :class:`WavWriter` (``frames``, ``gaps``, ``first_time_ns`` = device
    time of the first sample, to line the WAV up with the other streams).
    """
    w = WavWriter(dst, fill_gaps=fill_gaps)
    with w:
        for c in chunks if chunks is not None else iter_chunks(src):
            w.write(c)
    return w
