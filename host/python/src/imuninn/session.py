"""Synchronous facade for scripts: runs the asyncio client in a background thread.

    import imuninn

    for p in imuninn.discover():          # phones on the LAN
        print(p.name, p.address)

    with imuninn.connect("iPhone") as dev:   # name, host, host:port, or "" for the first one
        dev.set("imu.rate_hz", 100)
        dev.start()
        for pose in dev.iter("ar_pose"):
            print(pose.position, dev.to_pc_time(pose.header.device_time_ns))

Callbacks (`dev.on("imu", fn)`) run on the client thread; keep them short.
"""

from __future__ import annotations

import asyncio
import queue
import threading
from pathlib import Path
from typing import Any, Callable, Iterator

from .client import PhoneClient
from .discovery import resolve
from .proto import imuninn_pb2 as pb


class Device:
    def __init__(self, host: str, port: int, name: str | None = None):
        self._client = PhoneClient(host, port, name)
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._run, name="imuninn-client", daemon=True)
        self._callbacks: dict[str, list[Callable]] = {}
        self._queues: list[tuple[str | None, queue.Queue]] = []
        self._client.add_data_listener(self._on_data)
        self._client.add_event_listener(self._on_event)
        self._main: asyncio.Task | None = None

    # -- lifecycle ----------------------------------------------------------

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._main = self._loop.create_task(self._client.closed.wait())
        try:
            self._loop.run_until_complete(self._main)
        except asyncio.CancelledError:
            pass
        finally:
            pending = [t for t in asyncio.all_tasks(self._loop) if not t.done()]
            for t in pending:
                t.cancel()
            if pending:
                self._loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            self._loop.close()

    def open(self, timeout: float = 10.0) -> "Device":
        if self._thread.is_alive():
            return self
        self._thread.start()
        asyncio.run_coroutine_threadsafe(self._client.connect(), self._loop).result(timeout)
        return self

    def close(self) -> None:
        if self._loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self._client.close(), self._loop).result(5)
        except Exception:
            pass
        self._thread.join(5)

    def __enter__(self) -> "Device":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.close()

    def _call(self, coro, timeout: float = 10.0):
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(timeout)

    # -- info ---------------------------------------------------------------

    @property
    def info(self) -> pb.DeviceInfo | None:
        return self._client.info

    @property
    def capabilities(self) -> pb.Capabilities | None:
        return self._client.capabilities

    @property
    def config(self) -> pb.DeviceConfig | None:
        return self._client.config

    @property
    def stats(self):
        return self._client.stats

    @property
    def clock_offset_ns(self) -> int | None:
        return self._client.clock_offset_ns

    @property
    def connected(self) -> bool:
        return self._client.connected.is_set()

    def __repr__(self) -> str:
        return repr(self._client)

    # -- control ------------------------------------------------------------

    def set(self, key: str, value: Any) -> pb.ConfigResult:
        return self._call(self._client.set(key, value))

    def set_config(self, patch: pb.DeviceConfig) -> pb.ConfigResult:
        return self._call(self._client.set_config(patch))

    def get_config(self) -> pb.DeviceConfig:
        return self._call(self._client.fetch_config())

    def subscribe(self, stream_ids: list[str], unsubscribe: bool = False) -> None:
        self._call(self._client.subscribe(stream_ids, unsubscribe))

    def start(self) -> None:
        self._call(self._client.start())

    def stop(self) -> None:
        self._call(self._client.stop())

    def start_recording(self) -> None:
        self._call(self._client.start_recording())

    def stop_recording(self) -> None:
        self._call(self._client.stop_recording())

    def time_sync(self) -> int | None:
        return self._call(self._client.time_sync())

    @property
    def lease_holder(self) -> str:
        return self._client.lease_holder

    def acquire_lease(self) -> bool:
        return self._call(self._client.acquire_lease())

    def release_lease(self) -> None:
        self._call(self._client.release_lease())

    def apply_profile(self, name_or_path: str) -> pb.ConfigResult:
        """Apply a YAML profile (built-in name like "calibration", or a file path)."""
        return self._call(self._client.apply_profile(name_or_path))

    def save_profile(self, path: str, name: str | None = None) -> None:
        """Write the phone's current config as a YAML profile."""
        from .profiles import dump, from_config

        dump(from_config(self.get_config(), name or Path(path).stem), path)

    def to_pc_time_ns(self, device_time_ns: int) -> int:
        return self._client.to_pc_time_ns(device_time_ns)

    def to_pc_time(self, device_time_ns: int) -> float:
        """Device timestamp -> PC wall-clock seconds."""
        return self.to_pc_time_ns(device_time_ns) / 1e9

    # -- data ---------------------------------------------------------------

    def _on_event(self, event: str) -> None:
        for cb in self._callbacks.get("__event__", []):
            cb(event)

    def _on_data(self, msg: pb.DataMessage) -> None:
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
                    pass  # consumer is slow: drop, never block the client

    def on(self, stream: str, cb: Callable) -> None:
        """Callback for a stream id ("imu", "ar_pose", "rgb"), "*" for all
        (cb(stream, sample)), or "__event__" for connected/config/disconnected."""
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


def connect(target: str = "", name: str | None = None, timeout: float = 10.0) -> Device:
    """Connect to a phone by Bonjour name, host, host:port, or '' for the first one found.

    Returns an opened Device; use as a context manager or call close()."""
    host, port = resolve(target)
    return Device(host, port, name).open(timeout)
