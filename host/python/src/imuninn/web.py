"""Browser viewer relay (`imuninn web`): bridges a phone's TCP / UDP data channels to a
WebSocket that a browser can open, and serves the static viewer from host/web/dist.

    imuninn web [phone] [--start]        # live: connect to a phone, open http://localhost:7430
    imuninn web --mcap run1.mcap         # replay a recording to the browser (loops)

Why a relay: browsers cannot open raw TCP / UDP sockets or browse Bonjour, and a page
hosted over https cannot connect to a LAN ws:// endpoint. The relay is tiny and reuses
PhoneClient, so the browser needs nothing but WebCodecs.

Wire format on /ws:
    browser -> relay, text (JSON): {"type": "subscribe", "streams": [...], "unsubscribe": bool}
                                   {"type": "start"} | {"type": "stop"} | {"type": "set", "key", "value"}
    relay -> browser, text (JSON): {"type": "welcome", "mode": "live"|"replay", "device": {...},
                                    "streams": [{"stream_id", "kind"}], "subscribed": [...]}
                                   {"type": "status", "message"} | {"type": "error", "message"}
    relay -> browser, binary:      DataMessage protobuf, one per frame (same bytes the phone sends)
"""

from __future__ import annotations

import asyncio
import http
import json
import logging
import mimetypes
import threading
from pathlib import Path

from google.protobuf.json_format import MessageToDict
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Request, Response

from .proto import imuninn_pb2 as pb

log = logging.getLogger("imuninn.web")

DEFAULT_PORT = 7430
STATIC_DIR = Path(__file__).resolve().parents[3] / "web" / "dist"

_BODY_FIELD = {pb.ImuSample: "imu", pb.PoseSample: "pose", pb.VideoFrame: "video",
               pb.DepthFrame: "depth", pb.Gap: "gap", pb.DeviceHealth: "health"}
_KIND_FOR_STREAM = {"imu": pb.STREAM_KIND_IMU, "ar_pose": pb.STREAM_KIND_POSE, "rgb": pb.STREAM_KIND_VIDEO,
                    "depth": pb.STREAM_KIND_DEPTH, "health": pb.STREAM_KIND_HEALTH}


def _stream_of(msg: pb.DataMessage) -> str:
    body = msg.WhichOneof("body")
    sample = getattr(msg, body) if body else None
    return sample.header.stream_id if sample is not None and hasattr(sample, "header") else ""


class _Browser:
    """One connected browser tab: its own filter and a bounded queue (slow tabs drop video)."""

    def __init__(self, ws: ServerConnection, streams: set[str]):
        self.ws = ws
        self.streams = set(streams)
        self.queue: asyncio.Queue[bytes | str] = asyncio.Queue(maxsize=64)
        self.dropped = 0

    def offer(self, data: bytes | str, stream: str) -> None:
        if stream and stream not in self.streams:
            return
        try:
            self.queue.put_nowait(data)
        except asyncio.QueueFull:
            self.dropped += 1

    async def sender(self) -> None:
        while True:
            item = await self.queue.get()
            await self.ws.send(item)


class Relay:
    def __init__(self, static_dir: Path = STATIC_DIR):
        self.static_dir = static_dir
        self.browsers: set[_Browser] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.mode = "replay"
        self.device = pb.DeviceInfo()
        self.streams: list[tuple[str, int]] = []
        self.phone = None  # PhoneClient in live mode

    # -- fan-out ---------------------------------------------------------

    def publish(self, msg: pb.DataMessage) -> None:
        """Thread-safe: forward one DataMessage to every browser."""
        data = msg.SerializeToString()
        stream = _stream_of(msg)
        if self.loop is None:
            return
        if threading.current_thread() is threading.main_thread() and self.loop.is_running():
            self._fanout(data, stream)
        else:
            self.loop.call_soon_threadsafe(self._fanout, data, stream)

    def _fanout(self, data: bytes, stream: str) -> None:
        for b in list(self.browsers):
            b.offer(data, stream)

    def _status(self, message: str) -> None:
        text = json.dumps({"type": "status", "message": message})
        for b in list(self.browsers):
            b.offer(text, "")

    # -- HTTP: static viewer --------------------------------------------

    def process_request(self, conn: ServerConnection, request: Request) -> Response | None:
        path = request.path.split("?", 1)[0]
        if path == "/ws":
            return None  # proceed with the WebSocket handshake
        if path == "/":
            path = "/index.html"
        f = (self.static_dir / path.lstrip("/")).resolve()
        if not str(f).startswith(str(self.static_dir.resolve())) or not f.is_file():
            if not (self.static_dir / "index.html").is_file():
                return conn.respond(http.HTTPStatus.NOT_FOUND,
                                    f"viewer not built: run `npm install && npm run build` in {self.static_dir.parent}\n")
            return conn.respond(http.HTTPStatus.NOT_FOUND, "not found\n")
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        body = f.read_bytes()
        headers = Headers([("Content-Type", ctype), ("Content-Length", str(len(body))),
                           ("Cache-Control", "no-cache"), ("Connection", "close")])
        return Response(http.HTTPStatus.OK, "OK", headers, body)

    # -- WebSocket: one browser ------------------------------------------

    async def handle(self, ws: ServerConnection) -> None:
        b = _Browser(ws, {s for s, _ in self.streams})
        self.browsers.add(b)
        welcome = {
            "type": "welcome", "mode": self.mode,
            "device": MessageToDict(self.device, preserving_proto_field_name=True),
            "streams": [{"stream_id": s, "kind": k} for s, k in self.streams],
            "subscribed": sorted(b.streams),
            "depth_enabled": self._depth_enabled(),
        }
        await ws.send(json.dumps(welcome))
        sender = asyncio.create_task(b.sender())
        log.info("browser connected (%d total)", len(self.browsers))
        try:
            async for raw in ws:
                if isinstance(raw, bytes):
                    continue
                try:
                    await self._control(b, json.loads(raw))
                except Exception as e:
                    await ws.send(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass
        finally:
            sender.cancel()
            self.browsers.discard(b)
            log.info("browser disconnected (%d left, %d frames dropped for it)", len(self.browsers), b.dropped)

    def _depth_enabled(self) -> bool:
        cfg = self.phone.config if self.phone is not None else None
        return any(s.stream_id == "depth" and s.enabled for s in cfg.streams) if cfg is not None else False

    async def _control(self, b: _Browser, msg: dict) -> None:
        t = msg.get("type")
        if t == "subscribe":
            ids = set(msg.get("streams", []))
            if msg.get("unsubscribe"):
                b.streams -= ids
            else:
                b.streams |= ids
            return
        if self.phone is None:
            raise RuntimeError(f"'{t}' needs a live phone (relay is in {self.mode} mode)")
        if t == "start":
            await self.phone.start()
        elif t == "stop":
            await self.phone.stop()
        elif t == "set":
            r = await self.phone.set(msg["key"], msg["value"])
            await b.ws.send(json.dumps({"type": "status", "message": f"config v{r.config_version}"}))
        else:
            raise ValueError(f"unknown message type {t!r}")

    # -- sources ---------------------------------------------------------

    async def serve(self, host: str, port: int) -> None:
        self.loop = asyncio.get_running_loop()
        async with serve(self.handle, host, port, process_request=self.process_request,
                         compression=None, max_size=16 * 1024 * 1024):
            print(f"iMuninn web viewer: http://localhost:{port}/   (ws://localhost:{port}/ws)")
            await asyncio.Future()

    async def run_live(self, target: str, host: str, port: int, start: bool) -> None:
        from .client import PhoneClient
        from .discovery import resolve

        phone_host, phone_port = resolve(target)
        self.phone = PhoneClient(phone_host, phone_port, name="imuninn-web")
        await self.phone.connect()
        self.mode = "live"
        self.device = self.phone.info
        self.streams = [(s.stream_id, s.kind) for s in self.phone.capabilities.streams]
        self.phone.add_data_listener(self.publish)
        self.phone.add_event_listener(lambda e: self._status(e))
        if start:
            await self.phone.start()
        await self.serve(host, port)

    async def run_mcap(self, path: str, host: str, port: int, loop_file: bool = True) -> None:
        from .mcap_io import replay, summary

        topics = summary(path)
        self.mode = "replay"
        self.device = pb.DeviceInfo(device_name=Path(path).name, model="mcap replay")
        self.streams = [(t.strip("/"), _KIND_FOR_STREAM.get(t.strip("/"), 0)) for t in topics
                        if t not in ("/device", "/capabilities", "/config", "/gap")]
        self.loop = asyncio.get_running_loop()

        def worker() -> None:
            while True:
                for _stream, sample in replay(path, realtime=True):
                    field = _BODY_FIELD.get(type(sample))
                    if field is None:
                        continue
                    self.publish(pb.DataMessage(**{field: sample}))
                if not loop_file:
                    return

        threading.Thread(target=worker, daemon=True).start()
        await self.serve(host, port)


def main_live(target: str, host: str, port: int, start: bool, static_dir: str | None) -> None:
    r = Relay(Path(static_dir) if static_dir else STATIC_DIR)
    asyncio.run(r.run_live(target, host, port, start))


def main_mcap(path: str, host: str, port: int, static_dir: str | None) -> None:
    r = Relay(Path(static_dir) if static_dir else STATIC_DIR)
    asyncio.run(r.run_mcap(path, host, port))
