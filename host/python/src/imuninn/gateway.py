"""M0 gateway: advertise on mDNS, accept the control WebSocket, complete Hello/Welcome.

Data channels (UDP / TCP) are added in M1+.
"""

from __future__ import annotations

import asyncio
import logging
import socket

from websockets.asyncio.server import ServerConnection, serve
from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf

from . import DEFAULT_CONTROL_PORT, PROTOCOL_VERSION, SERVICE_TYPE
from .proto import imuninn_pb2 as pb

log = logging.getLogger("imuninn.gateway")


def _local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


class Gateway:
    def __init__(self, name: str | None = None, port: int = DEFAULT_CONTROL_PORT):
        self.name = name or socket.gethostname().split(".")[0]
        self.port = port
        self.devices: dict[ServerConnection, pb.DeviceInfo] = {}

    async def _handle(self, ws: ServerConnection) -> None:
        peer = ws.remote_address
        log.info("control connection from %s", peer)
        try:
            async for raw in ws:
                if not isinstance(raw, bytes):
                    log.warning("ignoring text frame from %s", peer)
                    continue
                msg = pb.ControlMessage()
                msg.ParseFromString(raw)
                await self._dispatch(ws, msg)
        finally:
            info = self.devices.pop(ws, None)
            log.info("disconnected %s (%s)", peer, info.model if info else "no hello")

    async def _dispatch(self, ws: ServerConnection, msg: pb.ControlMessage) -> None:
        kind = msg.WhichOneof("body")
        if kind == "hello":
            dev = msg.hello.device
            self.devices[ws] = dev
            log.info(
                "hello: %s (%s, %s %s, proto v%d, lidar=%s)",
                dev.device_name, dev.model, pb.Platform.Name(dev.platform),
                dev.os_version, dev.protocol_version, dev.has_lidar,
            )
            reply = pb.ControlMessage(request_id=msg.request_id)
            reply.welcome.gateway_name = self.name
            reply.welcome.protocol_version = PROTOCOL_VERSION
            await ws.send(reply.SerializeToString())
        elif kind == "time_sync_ping":
            # Placeholder: real estimation lands in M1 with the pong path.
            log.debug("time sync ping")
        else:
            log.info("unhandled control message: %s", kind)

    async def run(self) -> None:
        ip = _local_ip()
        info = ServiceInfo(
            SERVICE_TYPE,
            f"{self.name}.{SERVICE_TYPE}",
            addresses=[socket.inet_aton(ip)],
            port=self.port,
            properties={"proto": str(PROTOCOL_VERSION)},
            server=f"{self.name}.local.",
        )
        azc = AsyncZeroconf(ip_version=IPVersion.V4Only, interfaces=[ip])
        await azc.async_register_service(info)
        log.info("advertising %s at %s:%d", info.name, ip, self.port)
        try:
            async with serve(self._handle, "0.0.0.0", self.port, max_size=16 * 1024 * 1024):
                await asyncio.Future()
        finally:
            await azc.async_unregister_service(info)
            await azc.async_close()


def run_gateway(name: str | None = None, port: int = DEFAULT_CONTROL_PORT) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    try:
        asyncio.run(Gateway(name, port).run())
    except KeyboardInterrupt:
        pass
