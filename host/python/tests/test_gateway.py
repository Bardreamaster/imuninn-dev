"""End-to-end test with a fake phone: control handshake, time sync, UDP data, config."""

import asyncio
import socket
import time

import pytest
from websockets.asyncio.client import connect

from imuninn.gateway import Gateway
from imuninn.proto import imuninn_pb2 as pb


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


async def fake_phone(control_port: int, got_config: list):
    """Minimal phone: hello, answer pings/caps/config, push a few UDP samples."""
    async with connect(f"ws://127.0.0.1:{control_port}") as ws:
        hello = pb.ControlMessage()
        hello.hello.device.device_name = "fake"
        hello.hello.device.model = "iPhone18,1"
        hello.hello.device.platform = pb.PLATFORM_IOS
        hello.hello.device.protocol_version = 1
        caps = hello.hello.capabilities
        caps.device.CopyFrom(hello.hello.device)
        sd = caps.streams.add()
        sd.stream_id = "imu"
        sd.kind = pb.STREAM_KIND_IMU
        sd.transport = pb.TRANSPORT_UDP
        caps.config.config_version = 1
        sc = caps.config.streams.add()
        sc.stream_id = "imu"
        sc.enabled = True
        await ws.send(hello.SerializeToString())

        welcome = pb.ControlMessage.FromString(await ws.recv())
        assert welcome.WhichOneof("body") == "welcome"
        udp_port = welcome.welcome.udp_port

        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        started = False
        version = 1
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.2)
            except asyncio.TimeoutError:
                raw = None
            if raw is not None:
                msg = pb.ControlMessage.FromString(raw)
                kind = msg.WhichOneof("body")
                reply = pb.ControlMessage(request_id=msg.request_id)
                if kind == "time_sync_ping":
                    now = time.time_ns() + 5_000_000_000  # device clock is 5 s ahead
                    reply.time_sync_pong.client_send_ns = msg.time_sync_ping.client_send_ns
                    reply.time_sync_pong.device_recv_ns = now
                    reply.time_sync_pong.device_send_ns = now
                    await ws.send(reply.SerializeToString())
                elif kind == "get_capabilities":
                    reply.capabilities.CopyFrom(caps)
                    await ws.send(reply.SerializeToString())
                elif kind == "subscribe":
                    pass
                elif kind == "session_control":
                    started = msg.session_control.action == pb.SessionControl.ACTION_START
                elif kind == "set_config":
                    got_config.append(msg.set_config)
                    version += 1
                    reply.config_result.config_version = version
                    fr = reply.config_result.fields.add()
                    fr.key = "imu.rate_hz"
                    fr.status = pb.ConfigResult.FieldResult.STATUS_APPLIED
                    await ws.send(reply.SerializeToString())
                    bc = pb.ControlMessage()
                    bc.config_changed.config.config_version = version
                    await ws.send(bc.SerializeToString())
            if started:
                for seq in range(3):
                    d = pb.DataMessage()
                    d.imu.header.stream_id = "imu"
                    d.imu.header.seq = seq * 2  # every other one "dropped"
                    d.imu.header.device_time_ns = time.time_ns()
                    d.imu.accel.z = -9.81
                    udp.sendto(d.SerializeToString(), ("127.0.0.1", udp_port))
                started = False
                await asyncio.sleep(0.3)
                return


@pytest.mark.asyncio
async def test_handshake_sync_data_and_config():
    cport, dport = _free_port(), _free_port()
    gw = Gateway("test", cport, dport, advertise=False)
    received = []
    ready = asyncio.Event()
    gw.add_data_listener(lambda dev, msg: received.append((dev, msg)))
    gw.add_device_listener(lambda dev, ev: ready.set() if ev == "ready" else None)

    gw_task = asyncio.create_task(gw.run())
    await gw.wait_ready()
    got_config: list = []
    phone = asyncio.create_task(fake_phone(cport, got_config))

    await asyncio.wait_for(ready.wait(), 5)
    dev = next(iter(gw.devices.values()))
    assert dev.capabilities is not None and dev.capabilities.streams[0].stream_id == "imu"
    assert dev.clock_offset_ns is not None
    assert abs(dev.clock_offset_ns + 5_000_000_000) < 200_000_000  # pc = device - 5 s

    res = await dev.set("imu.rate_hz", 100)
    assert res.config_version == 2
    assert got_config[0].patch.streams[0].params["rate_hz"].i == 100

    await dev.start()
    await asyncio.wait_for(phone, 10)
    await asyncio.sleep(0.1)
    assert len(received) == 3
    assert received[0][1].imu.accel.z == pytest.approx(-9.81)
    st = dev.stats["imu"]
    assert st.count == 3 and st.dropped == 2

    gw_task.cancel()
    try:
        await gw_task
    except asyncio.CancelledError:
        pass
