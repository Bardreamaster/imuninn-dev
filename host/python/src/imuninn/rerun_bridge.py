"""Rerun visualisation (§7.2): one replaceable sink on the PC client.

    imuninn rerun [phone ...]            # spawn the viewer, log everything live (several phones OK)
    imuninn rerun --mcap run1.mcap       # replay a recording
    imuninn rerun --save run1.rrd phone  # write a .rrd instead of opening the viewer

Entity layout, one subtree per device (`<dev>` = sanitised device name):

    world                        ViewCoordinates RIGHT_HAND_Y_UP (the ARKit / ARCore world frame)
    world/<dev>                  Transform3D: camera pose (ARKit camera frame: X right, Y up, Z back)
    world/<dev>/trajectory       LineStrips3D: decimated path of the camera
    world/<dev>/cam              Pinhole with the RGB intrinsics (sensor orientation)
    world/<dev>/cam/video        Image decoded by this client with PyAV (default, `--video decode`), or
                                 VideoStream: H.264 NAL units as sent, decoded by the viewer itself
                                 (`--video stream`; the native viewer runs an external ffmpeg for that
                                 and restarted it about once a second at 1920x1440@60 -> stutter)
    world/<dev>/depth            Pinhole with the depth intrinsics
    world/<dev>/depth/image      DepthImage in metres (the viewer back-projects it in the 3D view)
    world/<dev>/depth/confidence Image: ARKit confidence 0..2
    world/<dev>/points           Points3D: depth back-projected on the PC, coloured from the RGB
                                 frame (`--points`, needs `--video decode`; otherwise depth-coloured);
                                 points and the confidence image are capped at `--points-hz` (10 Hz)
    plots/<dev>/imu/{accel,gyro,mag}, plots/<dev>/pose/tracking, plots/<dev>/health/{thermal,battery,rates,video_kbps}
    events/<dev>                 TextLog: tracking / thermal / low-power changes, gaps, config changes

Timelines: `pc` (wall clock, from clock sync when live or MCAP log_time when replaying) and
`device` (device monotonic clock, as a duration). Sequence numbers are not a timeline: streams
would interleave out of order. With several devices each one gets its own `device:<dev>`
timeline; `pc` is the shared one.

Optional dependency: `pip install imuninn[rerun,video]`. `--video stream` additionally needs an
`ffmpeg` executable on PATH for the native viewer; the web viewer uses WebCodecs.
"""

from __future__ import annotations

import logging
import queue
import re
import threading
import time
from typing import Iterable

import numpy as np

from .proto import imuninn_pb2 as pb
from .session import Device

log = logging.getLogger("imuninn.rerun")

VIDEO_MODES = ("stream", "decode", "off")


def _init(app_id: str, spawn: bool, save: str | None = None, port: int | None = None):
    import os
    import sys

    import rerun as rr  # type: ignore

    # The viewer binary ships with rerun-sdk inside the venv's bin/, which is not
    # necessarily on PATH when the script runs from an activated-less shell.
    bindir = os.path.join(sys.prefix, "bin")
    if bindir not in os.environ.get("PATH", "").split(os.pathsep):
        os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
    rr.init(app_id, spawn=spawn and not save and port is None)
    if save:
        rr.save(save)  # .rrd file instead of the viewer
    elif port is not None:
        # Own viewer on a non-default port: keeps a live session apart from whatever
        # viewer already sits on 9876 (and from its memory).
        if spawn:
            rr.spawn(port=port, connect=False)
        rr.connect_grpc(f"rerun+http://127.0.0.1:{port}/proxy")
    rr.log("world", rr.ViewCoordinates.RIGHT_HAND_Y_UP, static=True)
    return rr


def device_entity_name(name: str | None, fallback: str = "phone") -> str:
    """Entity-path-safe device name: "Jinqi's iPhone" -> "jinqis_iphone"."""
    s = re.sub(r"[^A-Za-z0-9_\-]+", "_", (name or "").strip().replace("'", "")).strip("_").lower()
    return s or fallback


def _unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    out = []
    for n in names:
        if n in seen:
            seen[n] += 1
            out.append(f"{n}_{seen[n]}")
        else:
            seen[n] = 0
            out.append(n)
    return out


# ---------------------------------------------------------------------------
# Per-device sink
# ---------------------------------------------------------------------------


class RerunSink:
    """Logs the samples of one device under `world/<name>`, `plots/<name>`, `events/<name>`."""

    def __init__(
        self,
        rr,
        name: str = "phone",
        *,
        video: str = "decode",
        every_nth_video: int = 1,
        video_scale: float = 0.5,
        points: bool = False,
        point_stride: int = 2,
        points_hz: float = 10.0,
        trajectory: bool = True,
        device_timeline: str = "device",
        pc_offset_ns: int | None = None,
        recording=None,
    ):
        if video not in VIDEO_MODES:
            raise ValueError(f"video must be one of {VIDEO_MODES}")
        self.rr = rr
        self.recording = recording  # None = the global recording
        self.name = name
        self.video = video
        self.every_nth_video = max(1, every_nth_video)
        # decode mode: integer downscale of the decoded frame before JPEG (1920x1440 -> 960x720 at 0.5
        # keeps a 60 fps feed at ~4 MB/s instead of ~14 MB/s in the viewer); intrinsics are scaled with it
        self.video_step = 1 if video != "decode" else max(1, int(round(1 / video_scale))) if video_scale > 0 else 1
        self.points = points
        self.point_stride = max(1, point_stride)
        self.points_hz = points_hz  # point cloud + confidence image rate cap (depth itself is logged every frame)
        self._points_t = -1.0
        self.trajectory = trajectory
        self.device_timeline = device_timeline
        self.pc_offset_ns = pc_offset_ns
        self.counts = {"imu": 0, "ar_pose": 0, "rgb": 0, "depth": 0, "health": 0}

        self._decoder = None
        self._video_n = 0
        self._video_codec_logged = False
        self._last_rgb: np.ndarray | None = None  # sensor orientation, (H, W, 3)
        self._last_rgb_k: tuple | None = None
        self._cam_k: tuple | None = None
        self._depth_k: tuple | None = None
        self._series_logged: set[str] = set()
        self._tracking: int | None = None
        self._thermal: int | None = None
        self._low_power: bool | None = None
        self._battery_state: int | None = None
        self._last_t: float = 0.0
        self._traj: list[list[float]] = []
        self._traj_last_t = -1.0
        self._traj_logged_t = -1.0
        self._traj_dirty = False

    # -- paths ---------------------------------------------------------------

    @property
    def world(self) -> str:
        return f"world/{self.name}"

    def plot(self, sub: str) -> str:
        return f"plots/{self.name}/{sub}"

    @property
    def events(self) -> str:
        return f"events/{self.name}"

    def _log(self, path: str, *archetypes, static: bool = False) -> None:
        self.rr.log(path, *archetypes, static=static, recording=self.recording)

    def _set_time(self, timeline: str, **kw) -> None:
        self.rr.set_time(timeline, recording=self.recording, **kw)

    # -- entry point ----------------------------------------------------------

    def log(self, stream: str, sample, log_time_ns: int | None = None) -> None:
        rr = self.rr
        if hasattr(sample, "header"):
            h = sample.header
            t_dev = h.device_time_ns * 1e-9
            self._last_t = t_dev
            self._set_time(self.device_timeline, duration=t_dev)
            pc = log_time_ns
            if pc is None and self.pc_offset_ns is not None:
                pc = h.device_time_ns + self.pc_offset_ns
            if pc is not None:
                self._set_time("pc", timestamp=pc * 1e-9)
        if isinstance(sample, pb.PoseSample):
            self._pose(sample)
        elif isinstance(sample, pb.ImuSample):
            self._imu(sample)
        elif isinstance(sample, pb.VideoFrame):
            self._video(sample)
        elif isinstance(sample, pb.DepthFrame):
            self._depth(sample)
        elif isinstance(sample, pb.DeviceHealth):
            self._health(sample)
        elif isinstance(sample, pb.Gap):
            self._event(f"gap on {sample.header.stream_id}: {sample.reason or 'stream restarted'}", "WARN")
        elif isinstance(sample, pb.ConfigChanged):
            c = sample.config
            on = [s.stream_id for s in c.streams if s.enabled]
            self._event(f"config v{c.config_version}: mode={pb.SessionMode.Name(c.mode).removeprefix('SESSION_MODE_').lower()} "
                        f"streams={','.join(on) or '-'}", "INFO")

    # -- helpers --------------------------------------------------------------

    def _event(self, text: str, level: str = "INFO") -> None:
        self._log(self.events, self.rr.TextLog(f"[{self.name}] {text}", level=level))

    def _series(self, path: str, names: list[str]) -> None:
        if path not in self._series_logged:
            self._series_logged.add(path)
            self._log(path, self.rr.SeriesLines(names=names), static=True)

    def _scalars(self, sub: str, values, names: list[str]) -> None:
        path = self.plot(sub)
        self._series(path, names)
        self._log(path, self.rr.Scalars(values))

    @staticmethod
    def _k_tuple(k: pb.Intrinsics) -> tuple:
        return (k.width, k.height, round(k.fx, 2), round(k.fy, 2), round(k.cx, 2), round(k.cy, 2))

    def _pinhole(self, path: str, k: pb.Intrinsics, cached: tuple | None, plane: float, step: int = 1) -> tuple | None:
        """Log a Pinhole only when the intrinsics change (they are sent with every frame).
        `step` > 1: the image under it is subsampled by that factor, so scale the intrinsics too."""
        if not k.width:
            return cached
        kt = self._k_tuple(k)
        if kt == cached:
            return cached
        f = 1.0 / step
        self._log(
            path,
            self.rr.Pinhole(
                focal_length=[k.fx * f, k.fy * f],
                principal_point=[k.cx * f, k.cy * f],
                resolution=[k.width // step, k.height // step],
                camera_xyz=self.rr.ViewCoordinates.RUB,  # ARKit camera frame
                image_plane_distance=plane,
            ),
        )
        return kt

    # -- streams --------------------------------------------------------------

    def _pose(self, s: pb.PoseSample) -> None:
        rr = self.rr
        self.counts["ar_pose"] += 1
        p, q = s.position, s.orientation
        self._log(
            self.world,
            rr.Transform3D(translation=[p.x, p.y, p.z], rotation=rr.Quaternion(xyzw=[q.x, q.y, q.z, q.w])),
        )
        self._cam_k = self._pinhole(f"{self.world}/cam", s.intrinsics, self._cam_k, 0.2, self.video_step)
        self._scalars("pose/tracking", float(s.tracking), ["tracking (1 n/a, 2 limited, 3 normal)"])
        if s.tracking != self._tracking:
            name = pb.TrackingState.Name(s.tracking).removeprefix("TRACKING_STATE_").lower()
            self._event(f"tracking {name}", "INFO" if s.tracking == pb.TRACKING_STATE_NORMAL else "WARN")
            self._tracking = s.tracking
        if self.trajectory:
            self._trajectory(p, self._last_t)

    def _trajectory(self, p, t: float) -> None:
        """Decimated path: a point every 50 ms or 1 cm, re-logged at most twice a second."""
        if self._traj:
            last = self._traj[-1]
            dt = t - self._traj_last_t
            moved = (p.x - last[0]) ** 2 + (p.y - last[1]) ** 2 + (p.z - last[2]) ** 2 >= 1e-4
            if dt < 1.0 and (not moved or dt < 0.05):
                return
        self._traj.append([p.x, p.y, p.z])
        self._traj_last_t = t
        self._traj_dirty = True
        if len(self._traj) > 20000:  # keep memory bounded: thin the oldest half
            self._traj = self._traj[:10000:2] + self._traj[10000:]
        if len(self._traj) >= 2 and (t - self._traj_logged_t >= 0.5 or self._traj_logged_t < 0):
            self._log(
                f"{self.world}/trajectory",
                self.rr.LineStrips3D([self._traj], radii=0.004, colors=[[80, 200, 255]]),
            )
            self._traj_logged_t = t
            self._traj_dirty = False

    def _imu(self, s: pb.ImuSample) -> None:
        self.counts["imu"] += 1
        a, g, m = s.accel, s.gyro, s.mag
        self._scalars("imu/accel", [a.x, a.y, a.z], ["ax (m/s²)", "ay", "az"])
        self._scalars("imu/gyro", [g.x, g.y, g.z], ["gx (rad/s)", "gy", "gz"])
        if m.x or m.y or m.z:
            self._scalars("imu/mag", [m.x, m.y, m.z], ["mx (µT)", "my", "mz"])

    def _video(self, s: pb.VideoFrame) -> None:
        rr = self.rr
        self.counts["rgb"] += 1
        self._cam_k = self._pinhole(f"{self.world}/cam", s.intrinsics, self._cam_k, 0.2, self.video_step)
        if self.video == "off":
            return
        path = f"{self.world}/cam/video"
        if self.video == "stream":
            if s.format not in (pb.PIXEL_FORMAT_H264_NAL, pb.PIXEL_FORMAT_HEVC_NAL):
                return
            if not self._video_codec_logged:
                codec = rr.VideoCodec.H264 if s.format == pb.PIXEL_FORMAT_H264_NAL else rr.VideoCodec.H265
                self._log(path, rr.VideoStream(codec=codec), static=True)
                self._video_codec_logged = True
            # The viewer decodes; every frame must be logged (P-frames need their references).
            self._log(path, rr.VideoStream.from_fields(sample=bytes(s.data), is_keyframe=bool(s.keyframe)))
            return
        # decode on the PC (PyAV); optional frame skipping
        if self._decoder is None:
            from .video import H264Decoder

            self._decoder = H264Decoder()
        self._video_n += 1
        imgs = list(self._decoder.decode(s, upright=False))  # feed every frame, drop after decode
        if self._video_n % self.every_nth_video or not imgs:
            return
        img = imgs[-1]
        st = self.video_step
        if st > 1:
            img = np.ascontiguousarray(img[::st, ::st])
        k = s.intrinsics
        self._last_rgb = img
        self._last_rgb_k = (k.width // st, k.height // st, k.fx / st, k.fy / st, k.cx / st, k.cy / st)
        self._log(path, rr.Image(img).compress(jpeg_quality=80))

    def _depth(self, s: pb.DepthFrame) -> None:
        from .depth import decode as decode_depth

        rr = self.rr
        self.counts["depth"] += 1
        d_mm, conf = decode_depth(s, upright=False)
        self._depth_k = self._pinhole(f"{self.world}/depth", s.intrinsics, self._depth_k, 0.2)
        # uint16 millimetres as sent (half the size of float32 metres); meter=1000 keeps the viewer in metres
        self._log(f"{self.world}/depth/image", rr.DepthImage(d_mm, meter=1000.0, colormap="turbo"))
        if self.points_hz <= 0 or self._last_t - self._points_t >= 1.0 / self.points_hz or self._points_t < 0:
            self._points_t = self._last_t
            if conf is not None:
                self._log(f"{self.world}/depth/confidence", rr.Image(conf * 127, color_model="L"))
            if self.points:
                self._point_cloud(d_mm, conf, s.intrinsics)

    def _point_cloud(self, d_mm: np.ndarray, conf: np.ndarray | None, k: pb.Intrinsics) -> None:
        """Back-project depth into the ARKit camera frame (X right, Y up, Z back) on the PC."""
        if not k.width or not k.fx:
            return
        st = self.point_stride
        d = d_mm[::st, ::st].astype(np.float32) * 1e-3
        h, w = d.shape
        vs, us = np.mgrid[0:h, 0:w]
        us = us * st
        vs = vs * st
        valid = d > 0
        if conf is not None:
            valid &= conf[::st, ::st] >= 1  # drop ARKit "low" confidence
        d, us, vs = d[valid], us[valid], vs[valid]
        if d.size == 0:
            return
        x = (us - k.cx) / k.fx * d
        y = -(vs - k.cy) / k.fy * d
        z = -d
        pts = np.stack([x, y, z], axis=1)
        colors = None
        if self._last_rgb is not None and self._last_rgb_k is not None:
            rw, rh, rfx, rfy, rcx, rcy = self._last_rgb_k
            # ARKit depth is registered to the colour image: same optical axis, scaled intrinsics.
            u_rgb = np.clip(((us - k.cx) * rfx / k.fx + rcx).astype(np.int32), 0, rw - 1)
            v_rgb = np.clip(((vs - k.cy) * rfy / k.fy + rcy).astype(np.int32), 0, rh - 1)
            img = self._last_rgb
            if img.shape[0] == rh and img.shape[1] == rw:
                colors = img[v_rgb, u_rgb]
        if colors is None:
            # depth-coloured (turbo-ish ramp 0..5 m)
            t = np.clip(d / 5.0, 0, 1)
            colors = np.stack([255 * t, 255 * (1 - np.abs(2 * t - 1)), 255 * (1 - t)], axis=1).astype(np.uint8)
        self._log(f"{self.world}/points", self.rr.Points3D(pts, colors=colors, radii=0.004))

    def _health(self, s: pb.DeviceHealth) -> None:
        self.counts["health"] += 1
        self._scalars("health/thermal", float(s.thermal), ["thermal (1 nominal … 4 critical)"])
        self._scalars("health/battery", float(s.battery_level), ["battery (0..1)"])
        self._scalars("health/rates", [s.pose_hz, s.imu_hz, s.video_fps, s.depth_hz],
                      ["pose Hz", "imu Hz", "video fps", "depth Hz"])
        self._scalars("health/video_kbps", float(s.video_kbps), ["video kbps"])
        if s.thermal != self._thermal:
            name = pb.DeviceHealth.Thermal.Name(s.thermal).removeprefix("THERMAL_").lower()
            self._event(f"thermal {name}", "INFO" if s.thermal <= pb.DeviceHealth.THERMAL_FAIR else "WARN")
            self._thermal = s.thermal
        if s.low_power_mode != self._low_power:
            self._event(f"low power mode {'on' if s.low_power_mode else 'off'}", "WARN" if s.low_power_mode else "INFO")
            self._low_power = s.low_power_mode
        if s.battery_state != self._battery_state:
            name = pb.DeviceHealth.BatteryState.Name(s.battery_state).removeprefix("BATTERY_").lower()
            self._event(f"battery {name} {s.battery_level * 100:.0f}%", "INFO")
            self._battery_state = s.battery_state

    def flush(self) -> None:
        """Log the final trajectory segment (end of stream)."""
        if self.trajectory and self._traj_dirty and len(self._traj) >= 2:
            self._log(f"{self.world}/trajectory", self.rr.LineStrips3D([self._traj], radii=0.004, colors=[[80, 200, 255]]))
            self._traj_dirty = False


# ---------------------------------------------------------------------------
# Blueprint (default layout)
# ---------------------------------------------------------------------------


def blueprint(rr, names: list[str]):
    import rerun.blueprint as rrb  # type: ignore

    def per_device(make):
        views = [make(n) for n in names]
        return views[0] if len(views) == 1 else rrb.Tabs(*views)

    right = rrb.Vertical(
        rrb.Horizontal(
            per_device(lambda n: rrb.Spatial2DView(origin=f"world/{n}/cam", name=f"{n} RGB")),
            per_device(lambda n: rrb.Spatial2DView(origin=f"world/{n}/depth", name=f"{n} depth",
                                                   contents=[f"+ world/{n}/depth/image"])),
        ),
        rrb.Tabs(
            *[rrb.TimeSeriesView(origin=f"plots/{n}/imu", name=f"{n} IMU") for n in names],
            *[rrb.TimeSeriesView(origin=f"plots/{n}/health", name=f"{n} health") for n in names],
            *[rrb.TimeSeriesView(origin=f"plots/{n}/pose", name=f"{n} tracking") for n in names],
        ),
        rrb.TextLogView(origin="events", name="events"),
        row_shares=[3, 2, 1],
    )
    return rrb.Blueprint(
        rrb.Horizontal(rrb.Spatial3DView(origin="world", name="3D"), right, column_shares=[3, 2]),
        rrb.BlueprintPanel(state="collapsed"),
        rrb.SelectionPanel(state="collapsed"),
        collapse_panels=False,
    )


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------


def _sink_kwargs(kw: dict) -> dict:
    return {k: kw[k] for k in ("video", "every_nth_video", "video_scale", "points", "point_stride", "points_hz", "trajectory") if k in kw}


def run(dev: Device, app_id: str = "imuninn", spawn: bool = True, save: str | None = None,
        use_blueprint: bool = True, port: int | None = None, **sink_kw) -> dict:
    """Visualise one device live. Returns the per-stream sample counts."""
    return run_devices([dev], app_id=app_id, spawn=spawn, save=save, use_blueprint=use_blueprint, port=port, **sink_kw)


def run_devices(devs: list[Device], app_id: str = "imuninn", spawn: bool = True, save: str | None = None,
                use_blueprint: bool = True, stats_every: float = 5.0, port: int | None = None,
                buffer_ms: float = 0.0, **sink_kw) -> dict:
    """Visualise several devices in one viewer: `world/<name>` per device, shared `pc` timeline.

    `buffer_ms` > 0 adds a playout (jitter) buffer: samples are held and released in device-time
    order once they are that old, so bursty Wi-Fi delivery turns into a steady feed for the viewer
    (at the cost of that much extra latency). 0 logs every sample as it arrives."""
    import heapq

    from .client import pc_time_ns

    rr = _init(app_id, spawn, save, port)
    names = _unique([device_entity_name(d.info.device_name if d.info else None, f"phone{i}") for i, d in enumerate(devs)])
    multi = len(devs) > 1
    sinks = [
        RerunSink(rr, n, device_timeline=f"device:{n}" if multi else "device",
                  pc_offset_ns=d.clock_offset_ns, **_sink_kwargs(sink_kw))
        for n, d in zip(names, devs)
    ]
    if use_blueprint:
        rr.send_blueprint(blueprint(rr, names))
    for n, d in zip(names, devs):
        log.info("rerun: %s -> world/%s", d, n)

    q: queue.Queue = queue.Queue(maxsize=4096)
    for i, d in enumerate(devs):
        d.on("*", lambda stream, sample, i=i: _put(q, (i, stream, sample)))
        d.on("__event__", lambda e, i=i: _put(q, (i, "__event__", e)))

    t0 = time.time()
    heap: list = []  # (pc_time_ns, n, i, stream, sample) when buffering
    n = 0
    buffer_ns = int(buffer_ms * 1e6)
    try:
        while any(d.connected for d in devs) or not q.empty() or heap:
            try:
                i, stream, sample = q.get(timeout=0.02 if buffer_ns else 0.5)
            except queue.Empty:
                i = None
            if i is not None:
                if stream == "__event__":
                    if sample == "disconnected":
                        sinks[i]._event("disconnected", "WARN")
                    continue
                if not buffer_ns:
                    sinks[i].log(stream, sample)
                else:
                    off = devs[i].clock_offset_ns
                    t_pc = (sample.header.device_time_ns + off) if (off is not None and hasattr(sample, "header")) else pc_time_ns()
                    n += 1
                    heapq.heappush(heap, (t_pc, n, i, stream, sample))
            if buffer_ns:
                due = pc_time_ns() - buffer_ns
                while heap and (heap[0][0] <= due or not any(d.connected for d in devs)):
                    _, _, i, stream, sample = heapq.heappop(heap)
                    sinks[i].log(stream, sample)
            if time.time() - t0 > stats_every:
                dt = time.time() - t0
                for s in sinks:
                    log.info("rerun %s: %s", s.name, {k: f"{v / dt:.1f} Hz" for k, v in s.counts.items() if v})
                    s.counts = {k: 0 for k in s.counts}
                t0 = time.time()
    finally:
        for s in sinks:
            s.flush()
    return {s.name: s.counts for s in sinks}


def _put(q: queue.Queue, item) -> None:
    try:
        q.put_nowait(item)
    except queue.Full:
        pass  # viewer side is slow: drop rather than block the client thread


def run_mcap(path: str, app_id: str = "imuninn-replay", spawn: bool = True, save: str | None = None,
             use_blueprint: bool = True, port: int | None = None, **sink_kw) -> dict:
    """Replay an MCAP recording into the viewer (`pc` timeline = the file's log_time)."""
    from .mcap_io import read_device_info, replay_timed

    rr = _init(app_id, spawn, save, port)
    info = read_device_info(path)
    name = device_entity_name(info.device_name if info else None, "replay")
    sink = RerunSink(rr, name, **_sink_kwargs(sink_kw))
    if use_blueprint:
        rr.send_blueprint(blueprint(rr, [name]))
    try:
        for stream, sample, log_time_ns in replay_timed(path, realtime=False):
            sink.log(stream, sample, log_time_ns=log_time_ns)
    finally:
        sink.flush()
    return {name: sink.counts}


def log_samples(rr, samples: Iterable[tuple[str, object]], name: str = "phone", **sink_kw) -> RerunSink:
    """Library helper: push an iterable of (stream, sample) through a RerunSink."""
    sink = RerunSink(rr, name, **_sink_kwargs(sink_kw))
    for stream, sample in samples:
        sink.log(stream, sample)
    sink.flush()
    return sink
