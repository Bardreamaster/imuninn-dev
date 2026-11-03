"""Rerun visualisation (§7.2): one replaceable sink on the gateway.

    imuninn rerun            # spawn the viewer, log pose / IMU / video live

Optional dependency: `pip install imuninn[rerun,video]`.
"""

from __future__ import annotations

import logging
import time

import numpy as np

from .proto import imuninn_pb2 as pb
from .session import Session

log = logging.getLogger("imuninn.rerun")

# ARKit camera: right-handed, Y up, looks down -Z. Rerun's pinhole convention is
# RDF (X right, Y down, Z forward); this rotation maps one onto the other.
_ARKIT_TO_RDF = np.array([[1, 0, 0], [0, -1, 0], [0, 0, -1]], dtype=np.float64)


def run(session: Session, app_id: str = "imuninn", spawn: bool = True, every_nth_video: int = 1) -> None:
    import os
    import sys

    import rerun as rr  # type: ignore

    from .video import H264Decoder

    # The viewer binary ships with rerun-sdk inside the venv's bin/, which is not
    # necessarily on PATH when the script runs from an activated-less shell.
    bindir = os.path.join(sys.prefix, "bin")
    if bindir not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
    rr.init(app_id, spawn=spawn)
    rr.log("world", rr.ViewCoordinates.RIGHT_HAND_Y_UP, static=True)

    decoder = H264Decoder()
    video_n = 0
    t0 = time.time()
    counts = {"imu": 0, "ar_pose": 0, "rgb": 0}

    for stream, sample in session.iter(None):
        t = sample.header.device_time_ns * 1e-9
        rr.set_time("device", timestamp=t)
        rr.set_time("seq", sequence=sample.header.seq)
        if isinstance(sample, pb.PoseSample):
            counts["ar_pose"] += 1
            p, q = sample.position, sample.orientation
            rr.log(
                "world/phone",
                rr.Transform3D(
                    translation=[p.x, p.y, p.z],
                    rotation=rr.Quaternion(xyzw=[q.x, q.y, q.z, q.w]),
                ),
            )
            k = sample.intrinsics
            if k.width:
                rr.log(
                    "world/phone/cam",
                    rr.Pinhole(
                        focal_length=[k.fx, k.fy],
                        principal_point=[k.cx, k.cy],
                        resolution=[k.width, k.height],
                        camera_xyz=rr.ViewCoordinates.RUB,  # ARKit camera frame
                        image_plane_distance=0.2,
                    ),
                )
            rr.log("plots/tracking", rr.Scalars(float(sample.tracking)))
        elif isinstance(sample, pb.ImuSample):
            counts["imu"] += 1
            a, g = sample.accel, sample.gyro
            rr.log("plots/accel", rr.Scalars([a.x, a.y, a.z]))
            rr.log("plots/gyro", rr.Scalars([g.x, g.y, g.z]))
        elif isinstance(sample, pb.VideoFrame):
            counts["rgb"] += 1
            video_n += 1
            if video_n % every_nth_video:
                continue
            for img in decoder.decode(sample, upright=False):
                rr.log("world/phone/cam/image", rr.Image(img).compress(jpeg_quality=80))
        if time.time() - t0 > 5:
            log.info("rerun: %s", {k: f"{v / (time.time() - t0):.1f} Hz" for k, v in counts.items()})
            t0 = time.time()
            counts = {k: 0 for k in counts}
