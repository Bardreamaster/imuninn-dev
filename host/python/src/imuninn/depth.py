"""Decode DepthFrame payloads: uint16 millimetres (+ uint8 confidence), LZ4 via
Apple's Compression framing ("bv41" blocks)."""

from __future__ import annotations

import struct

import numpy as np

from .proto import imuninn_pb2 as pb


def _apple_lz4_decode(buf: bytes) -> bytes:
    """Apple COMPRESSION_LZ4 stream: repeated blocks
    - b'bv41' + u32 decompressed_size + u32 compressed_size + lz4 block
    - b'bv4-' + u32 size + raw bytes (incompressible block)
    terminated by b'bv4$'. Little-endian sizes."""
    import lz4.block  # type: ignore

    out = bytearray()
    i = 0
    n = len(buf)
    while i + 4 <= n:
        magic = buf[i:i + 4]
        if magic == b"bv4$":
            break
        if magic == b"bv41":
            dsize, csize = struct.unpack_from("<II", buf, i + 4)
            i += 12
            out += lz4.block.decompress(buf[i:i + csize], uncompressed_size=dsize)
            i += csize
        elif magic == b"bv4-":
            (size,) = struct.unpack_from("<I", buf, i + 4)
            i += 8
            out += buf[i:i + size]
            i += size
        else:
            raise ValueError(f"unexpected Apple LZ4 block magic {magic!r} at {i}")
    return bytes(out)


def decode(frame: pb.DepthFrame, upright: bool = True) -> tuple[np.ndarray, np.ndarray | None]:
    """-> (depth_mm uint16 (H, W), confidence uint8 (H, W) or None).
    0 mm means invalid. ARKit confidence: 0 = low, 1 = medium, 2 = high."""
    w, h = frame.width, frame.height
    raw_d = bytes(frame.depth_mm)
    raw_c = bytes(frame.confidence)
    if frame.compression == pb.DEPTH_COMPRESSION_LZ4:
        raw_d = _apple_lz4_decode(raw_d)
        if raw_c:
            raw_c = _apple_lz4_decode(raw_c)
    elif frame.compression == pb.DEPTH_COMPRESSION_ZSTD:
        import zstandard  # type: ignore

        d = zstandard.ZstdDecompressor()
        raw_d = d.decompress(raw_d)
        if raw_c:
            raw_c = d.decompress(raw_c)
    depth = np.frombuffer(raw_d, dtype="<u2").reshape(h, w)
    conf = np.frombuffer(raw_c, dtype=np.uint8).reshape(h, w) if raw_c else None
    if upright and frame.rotation_deg:
        k = -(frame.rotation_deg // 90)
        depth = np.rot90(depth, k=k)
        conf = np.rot90(conf, k=k) if conf is not None else None
    return depth, conf


def to_metres(depth_mm: np.ndarray) -> np.ndarray:
    """uint16 mm -> float32 m with NaN for invalid (0)."""
    m = depth_mm.astype(np.float32) / 1000.0
    m[depth_mm == 0] = np.nan
    return m
