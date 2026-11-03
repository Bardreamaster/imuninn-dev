from imuninn.proto import imuninn_pb2 as pb


def test_welcome_roundtrip():
    m = pb.ControlMessage(request_id=1)
    m.welcome.device.model = "iPhone18,1"
    m.welcome.device.platform = pb.PLATFORM_IOS
    m.welcome.protocol_version = 2
    m.welcome.device.has_lidar = True
    m.welcome.client_id = 3
    raw = m.SerializeToString()
    back = pb.ControlMessage()
    back.ParseFromString(raw)
    assert back.WhichOneof("body") == "welcome"
    assert back.welcome.device.model == "iPhone18,1"
    assert back.welcome.device.has_lidar and back.welcome.client_id == 3


def test_header_on_imu():
    s = pb.ImuSample()
    s.header.stream_id = "imu"
    s.header.seq = 42
    s.header.device_time_ns = 123456789
    s.accel.z = -9.81
    d = pb.DataMessage(imu=s)
    assert pb.DataMessage.FromString(d.SerializeToString()).imu.header.seq == 42
