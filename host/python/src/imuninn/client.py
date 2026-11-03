"""Asyncio client for one phone (the phone is the server, §6.7).

Opens the control WebSocket, sends Hello with our UDP receive port, receives
Welcome (device info + capabilities + TCP data port), then connects the TCP data
stream and writes our client_id. Pose / IMU arrive on UDP, video / depth on TCP.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

from websockets.asyncio.client import ClientConnection, connect

from . import DEFAULT_CONTROL_PORT, PROTOCOL_VERSION, __version__
from .proto import imuninn_pb2 as pb

log = logging.getLogger("imuninn.client")

DataListener = Callable[[pb.DataMessage], None]


def pc_time_ns() -> int:
    """PC-side timestamp used for clock alignment: wall clock, nanoseconds."""
    return time.time_ns()


@dataclass
class StreamStats:
    count: int = 0
    dropped: int = 0
    last_seq: int | None = None
    last_device_time_ns: int = 0
    _window_t0: float = field(default_factory=time.monotonic)
    _window_n: int = 0
    rate_hz: float = 0.0

    def observe(self, header: pb.Header) -> None:
        self.count += 1
        if self.last_seq is not None and header.seq > self.last_seq + 1:
            self.dropped += header.seq - self.last_seq - 1
        self.last_seq = header.seq
        self.last_device_time_ns = header.device_time_ns
        self._window_n += 1
        now = time.monotonic()
        dt = now - self._window_t0
        if dt >= 1.0:
            self.rate_hz = self._window_n / dt
            self._window_n = 0
            self._window_t0 = now


class _UdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, client: "PhoneClient"):
        self.client = client

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        self.client._on_data(data)


class LeaseError(RuntimeError):
    """Another client holds the config lease (§6.8 控制权)."""


class PhoneClient:
    """One connection to one phone. Create, `await connect()`, use, `await close()`."""

    def __init__(self, host: str, port: int = DEFAULT_CONTROL_PORT, name: str | None = None):
        self.host = host
        self.port = port
        self.client_name = name or socket.gethostname().split(".")[0]
        self.ws: ClientConnection | None = None
        self.info: pb.DeviceInfo | None = None
        self.capabilities: pb.Capabilities | None = None
        self.config: pb.DeviceConfig | None = None
        self.client_id = 0
        self.tcp_port = 0
        self.clock_offset_ns: int | None = None  # pc_time_ns - device_time_ns
        self.lease_holder: str = ""               # "" = free; set from Lease broadcasts
        self.health: pb.DeviceHealth | None = None  # latest periodic health report
        self.clock_rtt_ns: int | None = None
        self.stats: dict[str, StreamStats] = defaultdict(StreamStats)
        self.connected = asyncio.Event()
        self.closed = asyncio.Event()
        self._listeners: list[DataListener] = []
        self._event_listeners: list[Callable[[str], None]] = []
        self._next_request_id = 1
        self._pending: dict[int, asyncio.Future] = {}
        self._udp_transport: asyncio.DatagramTransport | None = None
        self._tcp_writer: asyncio.StreamWriter | None = None
        self._tasks: list[asyncio.Task] = []

    def __repr__(self) -> str:
        if self.info is None:
            return f"<PhoneClient {self.host}:{self.port} (not connected)>"
        return f"<PhoneClient {self.info.device_name} {self.info.model} @ {self.host}>"

    @property
    def name(self) -> str:
        return self.info.device_name if self.info else self.host

    # -- listeners ----------------------------------------------------------

    def add_data_listener(self, cb: DataListener) -> None:
        self._listeners.append(cb)

    def add_event_listener(self, cb: Callable[[str], None]) -> None:
        """Events: "connected", "config", "disconnected"."""
        self._event_listeners.append(cb)

    def _emit(self, event: str) -> None:
        for cb in list(self._event_listeners):
            try:
                cb(event)
            except Exception:
                log.exception("event listener failed")

    # -- lifecycle ----------------------------------------------------------

    async def connect(self, subscribe_all: bool = True, time_sync: bool = True) -> "PhoneClient":
        loop = asyncio.get_running_loop()
        self._udp_transport, _ = await loop.create_datagram_endpoint(
            lambda: _UdpProtocol(self), local_addr=("0.0.0.0", 0)
        )
        udp_port = self._udp_transport.get_extra_info("sockname")[1]

        host_part = f"[{self.host}]" if ":" in self.host and not self.host.startswith("[") else self.host
        self.ws = await connect(f"ws://{host_part}:{self.port}/", max_size=16 * 1024 * 1024)
        hello = pb.ControlMessage(request_id=self._take_request_id())
        hello.hello.client.name = self.client_name
        hello.hello.client.version = __version__
        hello.hello.udp_port = udp_port
        hello.hello.protocol_version = PROTOCOL_VERSION
        fut: asyncio.Future = loop.create_future()
        self._pending[hello.request_id] = fut
        self._tasks.append(asyncio.create_task(self._control_loop()))
        await self.ws.send(hello.SerializeToString())
        welcome = await asyncio.wait_for(fut, 5.0)
        if welcome.WhichOneof("body") != "welcome":
            raise RuntimeError(f"expected welcome, got {welcome.WhichOneof('body')}")
        w = welcome.welcome
        self.info = w.device
        self.capabilities = w.capabilities
        self.config = w.capabilities.config
        self.client_id = w.client_id
        self.tcp_port = w.tcp_port
        if w.protocol_version != PROTOCOL_VERSION:
            log.warning("protocol mismatch: phone v%d, client v%d", w.protocol_version, PROTOCOL_VERSION)
        log.info("connected to %r (lidar=%s, tcp port %d)", self, w.device.has_lidar, w.tcp_port)

        if self.tcp_port:
            reader, writer = await asyncio.open_connection(self.host, self.tcp_port, limit=64 * 1024 * 1024)
            writer.write(self.client_id.to_bytes(4, "little"))
            await writer.drain()
            self._tcp_writer = writer
            self._tasks.append(asyncio.create_task(self._tcp_loop(reader)))

        if time_sync:
            await self.time_sync()
        if subscribe_all and self.capabilities is not None:
            await self.subscribe([s.stream_id for s in self.capabilities.streams])
        self.connected.set()
        self._emit("connected")
        return self

    async def close(self) -> None:
        for t in self._tasks:
            t.cancel()
        if self._tcp_writer is not None:
            self._tcp_writer.close()
        if self._udp_transport is not None:
            self._udp_transport.close()
        if self.ws is not None:
            await self.ws.close()
        self.closed.set()

    # -- control channel ----------------------------------------------------

    def _take_request_id(self) -> int:
        rid = self._next_request_id
        self._next_request_id += 1
        return rid

    async def send(self, msg: pb.ControlMessage) -> None:
        assert self.ws is not None
        await self.ws.send(msg.SerializeToString())

    async def request(self, msg: pb.ControlMessage, timeout: float = 5.0) -> pb.ControlMessage:
        msg.request_id = self._take_request_id()
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[msg.request_id] = fut
        try:
            await self.send(msg)
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(msg.request_id, None)

    async def _control_loop(self) -> None:
        assert self.ws is not None
        try:
            async for raw in self.ws:
                if not isinstance(raw, bytes):
                    continue
                msg = pb.ControlMessage()
                msg.ParseFromString(raw)
                fut = self._pending.get(msg.request_id) if msg.request_id else None
                if fut is not None and not fut.done():
                    fut.set_result(msg)
                    continue
                kind = msg.WhichOneof("body")
                if kind == "config_changed":
                    self.config = msg.config_changed.config
                    log.info("config v%d changed on %s", self.config.config_version, self.name)
                    self._emit("config")
                elif kind == "lease":
                    action = msg.lease.action
                    if action in (pb.Lease.ACTION_GRANTED,):
                        self.lease_holder = msg.lease.holder
                    elif action in (pb.Lease.ACTION_RELEASE, pb.Lease.ACTION_REVOKED):
                        if action == pb.Lease.ACTION_REVOKED and msg.lease.holder == self.client_name:
                            log.warning("config lease revoked by the phone")
                        self.lease_holder = ""
                    self._emit("lease")
                elif kind == "error":
                    log.warning("phone error %d: %s", msg.error.code, msg.error.message)
        except Exception as e:  # connection closed
            log.info("control channel closed: %s", e)
        finally:
            self.connected.clear()
            self.closed.set()
            self._emit("disconnected")

    # -- data channels ------------------------------------------------------

    async def _tcp_loop(self, reader: asyncio.StreamReader) -> None:
        try:
            while True:
                head = await reader.readexactly(4)
                n = int.from_bytes(head, "little")
                payload = await reader.readexactly(n)
                self._on_data(payload)
        except (asyncio.IncompleteReadError, ConnectionResetError, asyncio.CancelledError):
            pass

    def _on_data(self, payload: bytes) -> None:
        msg = pb.DataMessage()
        try:
            msg.ParseFromString(payload)
        except Exception:
            log.warning("bad data message (%d bytes)", len(payload))
            return
        body = msg.WhichOneof("body")
        if body in ("imu", "pose", "video", "depth", "gap", "health"):
            self.stats[getattr(msg, body).header.stream_id].observe(getattr(msg, body).header)
        if body == "health":
            self.health = msg.health
        for cb in list(self._listeners):
            try:
                cb(msg)
            except Exception:
                log.exception("data listener failed")

    # -- high level ---------------------------------------------------------

    async def fetch_capabilities(self) -> pb.Capabilities:
        reply = await self.request(pb.ControlMessage(get_capabilities=pb.GetCapabilities()))
        self.capabilities = reply.capabilities
        self.config = reply.capabilities.config
        return self.capabilities

    async def fetch_config(self) -> pb.DeviceConfig:
        reply = await self.request(pb.ControlMessage(get_config=pb.GetConfig()))
        self.config = reply.config
        return self.config

    async def set_config(self, patch: pb.DeviceConfig) -> pb.ConfigResult:
        base = self.config.config_version if self.config else 0
        msg = pb.ControlMessage()
        msg.set_config.base_config_version = base
        msg.set_config.patch.CopyFrom(patch)
        reply = await self.request(msg)
        if reply.WhichOneof("body") == "error":
            if reply.error.code == 409:
                raise LeaseError(reply.error.message)
            raise RuntimeError(reply.error.message)
        # The ConfigChanged broadcast follows asynchronously; bump the version now so
        # a back-to-back set() does not race it and get rejected as stale.
        if self.config is not None and reply.config_result.config_version:
            self.config.config_version = reply.config_result.config_version
        return reply.config_result

    async def set(self, key: str, value: bool | int | float | str) -> pb.ConfigResult:
        """Set one parameter by dotted key.

        "session.mode" -> DeviceConfig.mode ("ar" | "camera")
        "<stream>.enabled" -> StreamConfig.enabled
        "<stream>.<param>" -> StreamConfig.params[param]
        """
        patch = pb.DeviceConfig()
        head, _, rest = key.partition(".")
        if head == "session" and rest == "mode":
            patch.mode = {"ar": pb.SESSION_MODE_AR, "camera": pb.SESSION_MODE_CAMERA}[str(value)]
        else:
            sc = patch.streams.add()
            sc.stream_id = head
            if rest == "enabled":
                sc.enabled = bool(value)
            else:
                v = sc.params[rest]
                if isinstance(value, bool):
                    v.b = value
                elif isinstance(value, int):
                    v.i = value
                elif isinstance(value, float):
                    v.f = value
                else:
                    v.s = str(value)
        return await self.set_config(patch)

    async def acquire_lease(self) -> bool:
        msg = pb.ControlMessage()
        msg.lease.action = pb.Lease.ACTION_REQUEST
        msg.lease.holder = self.client_name
        reply = await self.request(msg)
        granted = reply.lease.action == pb.Lease.ACTION_GRANTED
        self.lease_holder = reply.lease.holder
        return granted

    async def release_lease(self) -> None:
        msg = pb.ControlMessage()
        msg.lease.action = pb.Lease.ACTION_RELEASE
        msg.lease.holder = self.client_name
        await self.request(msg)
        self.lease_holder = ""

    async def apply_profile(self, name_or_path: str) -> pb.ConfigResult:
        from .profiles import load, to_patch

        return await self.set_config(to_patch(load(name_or_path)))

    async def subscribe(self, stream_ids: list[str], unsubscribe: bool = False) -> None:
        msg = pb.ControlMessage()
        msg.subscribe.stream_ids.extend(stream_ids)
        msg.subscribe.unsubscribe = unsubscribe
        await self.send(msg)

    async def _session(self, action) -> None:
        msg = pb.ControlMessage()
        msg.session_control.action = action
        await self.send(msg)

    async def start(self) -> None:
        await self._session(pb.SessionControl.ACTION_START)

    async def stop(self) -> None:
        await self._session(pb.SessionControl.ACTION_STOP)

    async def start_recording(self) -> None:
        await self._session(pb.SessionControl.ACTION_START_RECORDING)

    async def stop_recording(self) -> None:
        await self._session(pb.SessionControl.ACTION_STOP_RECORDING)

    async def time_sync(self, rounds: int = 8) -> int | None:
        """NTP-style offset estimate; keeps the lowest-RTT sample."""
        best_rtt = None
        best_offset = None
        for _ in range(rounds):
            t1 = pc_time_ns()
            try:
                reply = await self.request(
                    pb.ControlMessage(time_sync_ping=pb.TimeSyncPing(client_send_ns=t1)), timeout=2.0
                )
            except asyncio.TimeoutError:
                continue
            t4 = pc_time_ns()
            pong = reply.time_sync_pong
            t2, t3 = pong.device_recv_ns, pong.device_send_ns
            rtt = (t4 - t1) - (t3 - t2)
            offset = ((t2 - t1) + (t3 - t4)) // 2  # device - pc
            if best_rtt is None or rtt < best_rtt:
                best_rtt, best_offset = rtt, -offset
            await asyncio.sleep(0.05)
        if best_offset is not None:
            self.clock_offset_ns = best_offset
            self.clock_rtt_ns = best_rtt
            log.info("clock sync %s: offset %.3f ms, rtt %.2f ms", self.name, best_offset / 1e6, (best_rtt or 0) / 1e6)
        return best_offset

    def to_pc_time_ns(self, device_time_ns: int) -> int:
        if self.clock_offset_ns is None:
            raise RuntimeError("clock not synced yet")
        return device_time_ns + self.clock_offset_ns
