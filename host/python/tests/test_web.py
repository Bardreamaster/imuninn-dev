"""`imuninn web` relay: static serving + welcome + DataMessage fan-out, no phone needed."""

import asyncio
import json
import socket

import pytest
from websockets.asyncio.client import connect

from imuninn.proto import imuninn_pb2 as pb
from imuninn.web import Relay


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.asyncio
async def test_relay_welcome_fanout_and_filter(tmp_path):
    static = tmp_path / "dist"
    static.mkdir()
    (static / "index.html").write_text("<html>viewer</html>")
    relay = Relay(static)
    relay.mode = "replay"
    relay.device = pb.DeviceInfo(device_name="test", model="x")
    relay.streams = [("imu", pb.STREAM_KIND_IMU), ("rgb", pb.STREAM_KIND_VIDEO)]
    port = _free_port()
    server = asyncio.create_task(relay.serve("127.0.0.1", port))
    await asyncio.sleep(0.2)
    try:
        # static page over plain HTTP on the same port
        r, w = await asyncio.open_connection("127.0.0.1", port)
        w.write(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
        await w.drain()
        head = await r.read(4096)
        w.close()
        assert b"200 OK" in head and b"viewer" in head

        async with connect(f"ws://127.0.0.1:{port}/ws") as ws:
            welcome = json.loads(await ws.recv())
            assert welcome["type"] == "welcome" and welcome["mode"] == "replay"
            assert welcome["device"]["device_name"] == "test"
            assert sorted(welcome["subscribed"]) == ["imu", "rgb"]

            m = pb.DataMessage()
            m.imu.header.stream_id = "imu"
            m.imu.header.seq = 7
            relay.publish(m)
            raw = await asyncio.wait_for(ws.recv(), 2)
            back = pb.DataMessage()
            back.ParseFromString(raw)
            assert back.imu.header.seq == 7

            # unsubscribe imu: nothing arrives for it any more, rgb still does
            await ws.send(json.dumps({"type": "subscribe", "streams": ["imu"], "unsubscribe": True}))
            await asyncio.sleep(0.1)
            relay.publish(m)
            v = pb.DataMessage()
            v.video.header.stream_id = "rgb"
            v.video.header.seq = 1
            relay.publish(v)
            raw = await asyncio.wait_for(ws.recv(), 2)
            back.ParseFromString(raw)
            assert back.WhichOneof("body") == "video"

            # control that needs a phone is answered with an error, not a crash
            await ws.send(json.dumps({"type": "start"}))
            err = json.loads(await asyncio.wait_for(ws.recv(), 2))
            assert err["type"] == "error" and "live" in err["message"]
    finally:
        server.cancel()
