"""H.264 decoding for VideoFrame payloads (Annex-B NAL units) via PyAV.

PyAV wheels ship an LGPL FFmpeg build without x264, which keeps the GPL out (§9).
Optional dependency: `pip install imuninn[video]`.
"""

from __future__ import annotations

from typing import Iterator

try:
    import av  # type: ignore
    import numpy as np  # type: ignore
except ImportError as e:  # pragma: no cover
    raise ImportError("video decoding needs PyAV and numpy: pip install 'imuninn[video]'") from e

from .proto import imuninn_pb2 as pb


class H264Decoder:
    """Feed VideoFrame messages, get RGB numpy arrays (H, W, 3) in sensor orientation."""

    def __init__(self) -> None:
        self._codec = av.CodecContext.create("h264", "r")
        self._codec.thread_type = "AUTO"
        self.decoded = 0
        self.waiting_for_keyframe = True

    def decode(self, frame: pb.VideoFrame, upright: bool = True) -> Iterator["np.ndarray"]:
        """Decode one ``VideoFrame``; yields zero or more RGB arrays.

        Frames before the first keyframe are skipped. With ``upright=True`` the image
        is rotated by ``frame.rotation_deg`` so it matches how the phone was held.
        """
        if frame.format != pb.PIXEL_FORMAT_H264_NAL:
            return
        if self.waiting_for_keyframe and not frame.keyframe:
            return
        self.waiting_for_keyframe = False
        for packet in self._codec.parse(bytes(frame.data)):
            for f in self._codec.decode(packet):
                img = f.to_ndarray(format="rgb24")
                if upright and frame.rotation_deg:
                    img = np.rot90(img, k=-(frame.rotation_deg // 90))  # clockwise
                self.decoded += 1
                yield img

    def reset(self) -> None:
        """Drop decoder state and wait for the next keyframe (after a gap or format change)."""
        self._codec = av.CodecContext.create("h264", "r")
        self.waiting_for_keyframe = True
