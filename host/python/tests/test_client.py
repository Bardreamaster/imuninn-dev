"""End-to-end test against a fake phone server: handshake, time sync, UDP + TCP data, config."""

import asyncio
import socket
import time

import pytest
from websockets.asyncio.server import serve

from imuninn.client import PhoneClient
from imuninn.proto import imuninn_pb2 as pb


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class FakePhone:
    """Minimal phone: WebSocket control server + TCP data server; pushes samples on START."""

    def __init__(self, control_port: int, tcp_port: int):
        self.control_port = control_port
        self.tcp_port = tcp_port
        self.got_config: list = []
        self.udp_target: tuple[str, int] | None = None
        self.tcp_writer: asyncio.StreamWriter | None = None
        self.version = 1

    async def __aenter__(self):
        self.ws_server = await serve(self._control, "127.0.0.1", self.control_port).__aenter__()
        self.tcp_server = await asyncio.start_server(self._tcp, "127.0.0.1", self.tcp_port)
        return self

    async def __aexit__(self, *exc):
        self.tcp_server.close()
        await self.ws_server.__aexit__(*exc)

    async def _tcp(self, reader, writer):
        cid = int.from_bytes(await reader.readexactly(4), "little")
        assert cid == 7
        self.tcp_writer = writer
        await asyncio.Future()

    async def _control(self, ws):
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        async for raw in ws:
            msg = pb.ControlMessage.FromString(raw)
            kind = msg.WhichOneof("body")
            reply = pb.ControlMessage(request_id=msg.request_id)
            if kind == "hello":
                self.udp_target = (ws.remote_address[0], msg.hello.udp_port)
                w = reply.welcome
                w.device.device_name = "fake"
                w.device.model = "iPhone18,1"
                w.device.has_lidar = True
                w.protocol_version = 2
                w.tcp_port = self.tcp_port
                w.client_id = 7
                sd = w.capabilities.streams.add()
                sd.stream_id = "imu"
                sd.kind = pb.STREAM_KIND_IMU
                w.capabilities.config.config_version = 1
                await ws.send(reply.SerializeToString())
            elif kind == "time_sync_ping":
                now = time.time_ns() + 5_000_000_000  # device clock 5 s ahead
                reply.time_sync_pong.client_send_ns = msg.time_sync_ping.client_send_ns
                reply.time_sync_pong.device_recv_ns = now
                reply.time_sync_pong.device_send_ns = now
                await ws.send(reply.SerializeToString())
            elif kind == "set_config":
                self.got_config.append(msg.set_config)
                self.version += 1
                reply.config_result.config_version = self.version
                fr = reply.config_result.fields.add()
                fr.key = "imu.rate_hz"
                fr.status = pb.ConfigResult.FieldResult.STATUS_APPLIED
                await ws.send(reply.SerializeToString())
                bc = pb.ControlMessage()
                bc.config_changed.config.config_version = self.version
                await ws.send(bc.SerializeToString())
            elif kind == "session_control" and msg.session_control.action == pb.SessionControl.ACTION_START:
                for seq in range(3):
                    d = pb.DataMessage()
                    d.imu.header.stream_id = "imu"
                    d.imu.header.seq = seq * 2  # every other one "dropped"
                    d.imu.header.device_time_ns = time.time_ns()
                    d.imu.accel.z = -9.81
                    udp.sendto(d.SerializeToString(), self.udp_target)
                v = pb.DataMessage()
                v.video.header.stream_id = "rgb"
                v.video.header.seq = 0
                v.video.keyframe = True
                v.video.data = b"\x00\x00\x00\x01\x65abc"
                payload = v.SerializeToString()
                assert self.tcp_writer is not None
                self.tcp_writer.write(len(payload).to_bytes(4, "little") + payload)
                await self.tcp_writer.drain()


@pytest.mark.asyncio
async def test_client_end_to_end():
    cport, tport = _free_port(), _free_port()
    async with FakePhone(cport, tport) as phone:
        received = []
        client = PhoneClient("127.0.0.1", cport, name="test")
        client.add_data_listener(lambda m: received.append(m))
        await client.connect()
        assert client.info is not None and client.info.model == "iPhone18,1"
        assert client.client_id == 7 and client.tcp_port == tport
        assert client.clock_offset_ns is not None
        assert abs(client.clock_offset_ns + 5_000_000_000) < 200_000_000

        res = await client.set("imu.rate_hz", 100)
        assert res.config_version == 2
        assert phone.got_config[0].patch.streams[0].params["rate_hz"].i == 100
        await asyncio.sleep(0.05)
        assert client.config.config_version == 2

        await client.start()
        for _ in range(50):
            if len(received) >= 4:
                break
            await asyncio.sleep(0.05)
        kinds = sorted(m.WhichOneof("body") for m in received)
        assert kinds == ["imu", "imu", "imu", "video"]
        assert client.stats["imu"].count == 3 and client.stats["imu"].dropped == 2
        assert client.stats["rgb"].count == 1
        await client.close()
