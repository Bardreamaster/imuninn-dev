"""Asyncio gateway: mDNS advertisement, control WebSocket, UDP data channel.

Phones discover `_imuninn._tcp`, open the control WebSocket, send Hello (with
Capabilities) and receive Welcome (with the UDP port). Data (IMU / pose) then
arrives as DataMessage datagrams on the UDP port. See protocol/README.md.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from websockets.asyncio.server import ServerConnection, serve
from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

from . import DEFAULT_CONTROL_PORT, DEFAULT_DATA_PORT, PROTOCOL_VERSION, SERVICE_TYPE
from .proto import imuninn_pb2 as pb

log = logging.getLogger("imuninn.gateway")

DataListener = Callable[["Device", pb.DataMessage], None]
DeviceListener = Callable[["Device", str], None]  # event: "connected" | "ready" | "disconnected"


def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


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


class Device:
    """A connected phone: control channel, capabilities, config, clock offset."""

    def __init__(self, gateway: "Gateway", ws: ServerConnection, info: pb.DeviceInfo):
        self.gateway = gateway
        self.ws = ws
        self.info = info
        self.capabilities: pb.Capabilities | None = None
        self.config: pb.DeviceConfig | None = None
        self.clock_offset_ns: int | None = None  # pc_time_ns - device_time_ns
        self.clock_rtt_ns: int | None = None
        self.stats: dict[str, StreamStats] = defaultdict(StreamStats)
        self.udp_addr: tuple[str, int] | None = None
        self._next_request_id = 1
        self._pending: dict[int, asyncio.Future] = {}

    # -- identity -----------------------------------------------------------

    @property
    def name(self) -> str:
        return self.info.device_name or self.info.model

    def __repr__(self) -> str:
        return f"<Device {self.name} {self.info.model} proto v{self.info.protocol_version}>"

    # -- control channel ----------------------------------------------------

    async def send(self, msg: pb.ControlMessage) -> None:
        await self.ws.send(msg.SerializeToString())

    async def request(self, msg: pb.ControlMessage, timeout: float = 5.0) -> pb.ControlMessage:
        msg.request_id = self._next_request_id
        self._next_request_id += 1
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[msg.request_id] = fut
        try:
            await self.send(msg)
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(msg.request_id, None)

    def _resolve(self, msg: pb.ControlMessage) -> bool:
        fut = self._pending.get(msg.request_id)
        if fut is not None and not fut.done():
            fut.set_result(msg)
            return True
        return False

    # -- high level ---------------------------------------------------------

    async def fetch_capabilities(self) -> pb.Capabilities:
        reply = await self.request(pb.ControlMessage(get_capabilities=pb.GetCapabilities()))
        if reply.WhichOneof("body") != "capabilities":
            raise RuntimeError(f"unexpected reply {reply.WhichOneof('body')}")
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

    async def subscribe(self, stream_ids: list[str], unsubscribe: bool = False) -> None:
        msg = pb.ControlMessage()
        msg.subscribe.stream_ids.extend(stream_ids)
        msg.subscribe.unsubscribe = unsubscribe
        await self.send(msg)

    async def start(self) -> None:
        msg = pb.ControlMessage()
        msg.session_control.action = pb.SessionControl.ACTION_START
        await self.send(msg)

    async def stop(self) -> None:
        msg = pb.ControlMessage()
        msg.session_control.action = pb.SessionControl.ACTION_STOP
        await self.send(msg)

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
        return best_offset

    def to_pc_time_ns(self, device_time_ns: int) -> int:
        if self.clock_offset_ns is None:
            raise RuntimeError("clock not synced yet")
        return device_time_ns + self.clock_offset_ns


class _UdpProtocol(asyncio.DatagramProtocol):
    def __init__(self, gateway: "Gateway"):
        self.gateway = gateway

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        self.gateway._on_datagram(data, addr)


class Gateway:
    def __init__(
        self,
        name: str | None = None,
        control_port: int = DEFAULT_CONTROL_PORT,
        data_port: int = DEFAULT_DATA_PORT,
        advertise: bool = True,
        auto_subscribe: bool = True,
    ):
        self.name = name or socket.gethostname().split(".")[0]
        self.control_port = control_port
        self.data_port = data_port
        self.advertise = advertise
        self.auto_subscribe = auto_subscribe
        self.devices: dict[ServerConnection, Device] = {}
        self._data_listeners: list[DataListener] = []
        self._device_listeners: list[DeviceListener] = []
        self._ready = asyncio.Event()
        self.ip = local_ip()

    # -- listeners ----------------------------------------------------------

    def add_data_listener(self, cb: DataListener) -> None:
        self._data_listeners.append(cb)

    def remove_data_listener(self, cb: DataListener) -> None:
        self._data_listeners.remove(cb)

    def add_device_listener(self, cb: DeviceListener) -> None:
        self._device_listeners.append(cb)

    def _emit_device(self, dev: Device, event: str) -> None:
        for cb in list(self._device_listeners):
            try:
                cb(dev, event)
            except Exception:  # listener bugs must not kill the gateway
                log.exception("device listener failed")

    # -- control ------------------------------------------------------------

    async def _handle_ws(self, ws: ServerConnection) -> None:
        peer = ws.remote_address
        log.info("control connection from %s", peer)
        dev: Device | None = None
        try:
            async for raw in ws:
                if not isinstance(raw, bytes):
                    continue
                msg = pb.ControlMessage()
                msg.ParseFromString(raw)
                kind = msg.WhichOneof("body")
                if kind == "hello":
                    dev = Device(self, ws, msg.hello.device)
                    if msg.hello.HasField("capabilities"):
                        dev.capabilities = msg.hello.capabilities
                        dev.config = msg.hello.capabilities.config
                    self.devices[ws] = dev
                    log.info("hello from %r (lidar=%s)", dev, dev.info.has_lidar)
                    reply = pb.ControlMessage(request_id=msg.request_id)
                    reply.welcome.gateway_name = self.name
                    reply.welcome.protocol_version = PROTOCOL_VERSION
                    reply.welcome.udp_port = self.data_port
                    await ws.send(reply.SerializeToString())
                    self._emit_device(dev, "connected")
                    asyncio.create_task(self._post_hello(dev))
                elif dev is None:
                    log.warning("message %s before hello from %s", kind, peer)
                elif msg.request_id and dev._resolve(msg):
                    pass
                elif kind == "config_changed":
                    dev.config = msg.config_changed.config
                    log.info("config v%d changed on %s", dev.config.config_version, dev.name)
                    self._emit_device(dev, "config")
                elif kind == "lease":
                    log.info("lease %s from %s", pb.Lease.Action.Name(msg.lease.action), dev.name)
                elif kind == "error":
                    log.warning("device error %d: %s", msg.error.code, msg.error.message)
                else:
                    log.debug("unhandled control message %s", kind)
        finally:
            if dev is not None:
                self.devices.pop(ws, None)
                log.info("disconnected %r", dev)
                self._emit_device(dev, "disconnected")

    async def _post_hello(self, dev: Device) -> None:
        try:
            if dev.capabilities is None:
                await dev.fetch_capabilities()
            await dev.time_sync()
            if dev.clock_offset_ns is not None:
                log.info(
                    "clock sync %s: offset %.3f ms, rtt %.2f ms",
                    dev.name, dev.clock_offset_ns / 1e6, (dev.clock_rtt_ns or 0) / 1e6,
                )
            if self.auto_subscribe and dev.capabilities is not None:
                await dev.subscribe([s.stream_id for s in dev.capabilities.streams])
            self._emit_device(dev, "ready")
        except Exception:
            log.exception("post-hello setup failed for %s", dev.name)

    # -- data ---------------------------------------------------------------

    def _on_datagram(self, data: bytes, addr: tuple[str, int]) -> None:
        msg = pb.DataMessage()
        try:
            msg.ParseFromString(data)
        except Exception:
            log.warning("bad datagram from %s (%d bytes)", addr, len(data))
            return
        dev = self._device_for(addr)
        if dev is None:
            return
        body = msg.WhichOneof("body")
        if body in ("imu", "pose", "video", "depth", "gap"):
            header = getattr(msg, body).header
            dev.stats[header.stream_id].observe(header)
        for cb in list(self._data_listeners):
            try:
                cb(dev, msg)
            except Exception:
                log.exception("data listener failed")

    def _device_for(self, addr: tuple[str, int]) -> Device | None:
        for dev in self.devices.values():
            if dev.udp_addr == addr:
                return dev
        # first datagram from a known control peer: bind by IP
        for dev in self.devices.values():
            if dev.ws.remote_address and dev.ws.remote_address[0] == addr[0]:
                dev.udp_addr = addr
                return dev
        return None

    # -- lifecycle ----------------------------------------------------------

    async def run(self) -> None:
        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _UdpProtocol(self), local_addr=("0.0.0.0", self.data_port)
        )
        azc = None
        info = None
        if self.advertise:
            info = ServiceInfo(
                SERVICE_TYPE,
                f"{self.name}.{SERVICE_TYPE}",
                addresses=[socket.inet_aton(self.ip)],
                port=self.control_port,
                properties={"proto": str(PROTOCOL_VERSION), "udp": str(self.data_port)},
                server=f"{self.name}.local.",
            )
            azc = AsyncZeroconf(ip_version=IPVersion.V4Only, interfaces=[self.ip])
            await azc.async_register_service(info)
            log.info("advertising %s at %s (control %d, udp %d)", info.name, self.ip, self.control_port, self.data_port)
        try:
            async with serve(self._handle_ws, "0.0.0.0", self.control_port, max_size=16 * 1024 * 1024):
                self._ready.set()
                await asyncio.Future()
        finally:
            transport.close()
            if azc is not None and info is not None:
                await azc.async_unregister_service(info)
                await azc.async_close()

    async def wait_ready(self) -> None:
        await self._ready.wait()


def run_gateway(name: str | None = None, port: int = DEFAULT_CONTROL_PORT, data_port: int = DEFAULT_DATA_PORT) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    gw = Gateway(name, port, data_port)

    async def main() -> None:
        async def stats_loop() -> None:
            while True:
                await asyncio.sleep(2.0)
                for dev in gw.devices.values():
                    parts = [f"{sid}: {st.rate_hz:5.1f} Hz drop={st.dropped}" for sid, st in dev.stats.items()]
                    if parts:
                        log.info("%s | %s", dev.name, " | ".join(parts))

        asyncio.create_task(stats_loop())
        await gw.run()

    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
