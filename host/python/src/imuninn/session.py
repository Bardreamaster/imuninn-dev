"""Synchronous facade for scripts: runs the gateway in a background thread.

    import imuninn

    with imuninn.open() as s:
        dev = s.wait_for_device()
        dev.set("imu.rate_hz", 100)
        dev.start()
        for pose in s.iter("ar_pose"):
            print(pose.position, s.to_pc_time(dev, pose.header.device_time_ns))

Callbacks (`s.on("imu", fn)`) run on the gateway thread; keep them short.
"""

from __future__ import annotations

import asyncio
import queue
import threading
import time
from typing import Any, Callable, Iterator

from . import DEFAULT_CONTROL_PORT, DEFAULT_DATA_PORT
from .gateway import Device, Gateway
from .proto import imuninn_pb2 as pb

_BODY_TO_STREAM = {"imu": "imu", "pose": "ar_pose", "video": "rgb", "depth": "depth"}


class DeviceHandle:
    """Thread-safe wrapper around a gateway Device."""

    def __init__(self, session: "Session", dev: Device):
        self._s = session
        self._dev = dev

    @property
    def info(self) -> pb.DeviceInfo:
        return self._dev.info

    @property
    def capabilities(self) -> pb.Capabilities | None:
        return self._dev.capabilities

    @property
    def config(self) -> pb.DeviceConfig | None:
        return self._dev.config

    @property
    def stats(self):
        return self._dev.stats

    @property
    def clock_offset_ns(self) -> int | None:
        return self._dev.clock_offset_ns

    def set(self, key: str, value: Any) -> pb.ConfigResult:
        return self._s._call(self._dev.set(key, value))

    def set_config(self, patch: pb.DeviceConfig) -> pb.ConfigResult:
        return self._s._call(self._dev.set_config(patch))

    def get_config(self) -> pb.DeviceConfig:
        return self._s._call(self._dev.fetch_config())

    def start(self) -> None:
        self._s._call(self._dev.start())

    def stop(self) -> None:
        self._s._call(self._dev.stop())

    def subscribe(self, stream_ids: list[str]) -> None:
        self._s._call(self._dev.subscribe(stream_ids))

    def time_sync(self) -> int | None:
        return self._s._call(self._dev.time_sync())

    def to_pc_time_ns(self, device_time_ns: int) -> int:
        return self._dev.to_pc_time_ns(device_time_ns)

    def __repr__(self) -> str:
        return repr(self._dev)


class Session:
    def __init__(
        self,
        name: str | None = None,
        control_port: int = DEFAULT_CONTROL_PORT,
        data_port: int = DEFAULT_DATA_PORT,
        advertise: bool = True,
    ):
        self.gateway = Gateway(name, control_port, data_port, advertise=advertise)
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, name="imuninn-gateway", daemon=True)
        self._callbacks: dict[str, list[Callable]] = {}
        self._queues: list[tuple[str | None, queue.Queue]] = []
        self._devices: dict[int, DeviceHandle] = {}
        self._device_event = threading.Event()
        self.gateway.add_data_listener(self._on_data)
        self.gateway.add_device_listener(self._on_device)

    # -- lifecycle ----------------------------------------------------------

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self.gateway.run())

    def start(self) -> "Session":
        self._thread.start()
        fut = asyncio.run_coroutine_threadsafe(self.gateway.wait_ready(), self._loop)
        fut.result(10)
        return self

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)

    def __enter__(self) -> "Session":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.close()

    def _call(self, coro, timeout: float = 10.0):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)

    # -- devices ------------------------------------------------------------

    def _on_device(self, dev: Device, event: str) -> None:
        if event == "ready":
            self._devices[id(dev)] = DeviceHandle(self, dev)
            self._device_event.set()
        elif event == "disconnected":
            self._devices.pop(id(dev), None)
        for cb in self._callbacks.get("__device__", []):
            cb(DeviceHandle(self, dev), event)

    @property
    def devices(self) -> list[DeviceHandle]:
        return list(self._devices.values())

    def wait_for_device(self, timeout: float | None = None) -> DeviceHandle:
        deadline = None if timeout is None else time.monotonic() + timeout
        while not self._devices:
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            if remaining == 0.0:
                raise TimeoutError("no device connected")
            self._device_event.wait(remaining if remaining is not None else 1.0)
            self._device_event.clear()
        return next(iter(self._devices.values()))

    # -- data ---------------------------------------------------------------

    def _on_data(self, dev: Device, msg: pb.DataMessage) -> None:
        body = msg.WhichOneof("body")
        if body is None:
            return
        sample = getattr(msg, body)
        stream = sample.header.stream_id if hasattr(sample, "header") else body
        for cb in self._callbacks.get(stream, []):
            cb(sample)
        for cb in self._callbacks.get("*", []):
            cb(stream, sample)
        for want, q in self._queues:
            if want is None or want == stream:
                try:
                    q.put_nowait((stream, sample))
                except queue.Full:
                    pass  # consumer is slow: drop, never block the gateway

    def on(self, stream: str, cb: Callable) -> None:
        """Register a callback for a stream id ("imu", "ar_pose", "*" for all,
        "__device__" for device connect/ready/disconnect events)."""
        self._callbacks.setdefault(stream, []).append(cb)

    def iter(self, stream: str | None = None, maxsize: int = 1024, timeout: float | None = None) -> Iterator:
        """Yield samples (for one stream) or (stream, sample) tuples (for all)."""
        q: queue.Queue = queue.Queue(maxsize=maxsize)
        self._queues.append((stream, q))
        try:
            while True:
                try:
                    s, sample = q.get(timeout=timeout)
                except queue.Empty:
                    return
                yield sample if stream is not None else (s, sample)
        finally:
            self._queues.remove((stream, q))

    def to_pc_time(self, dev: DeviceHandle, device_time_ns: int) -> float:
        """Device timestamp -> PC wall-clock seconds."""
        return dev.to_pc_time_ns(device_time_ns) / 1e9


def open(**kwargs) -> Session:  # noqa: A001 - mirrors builtins.open on purpose
    return Session(**kwargs)
