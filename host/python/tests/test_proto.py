from imuninn.proto import imuninn_pb2 as pb


def test_hello_roundtrip():
    m = pb.ControlMessage(request_id=1)
    m.hello.device.model = "iPhone17,1"
    m.hello.device.platform = pb.PLATFORM_IOS
    m.hello.device.protocol_version = 1
    m.hello.device.has_lidar = True
    raw = m.SerializeToString()
    back = pb.ControlMessage()
    back.ParseFromString(raw)
    assert back.WhichOneof("body") == "hello"
    assert back.hello.device.model == "iPhone17,1"
    assert back.hello.device.has_lidar


def test_header_on_imu():
    s = pb.ImuSample()
    s.header.stream_id = "imu"
    s.header.seq = 42
    s.header.device_time_ns = 123456789
    s.accel.z = -9.81
    d = pb.DataMessage(imu=s)
    assert pb.DataMessage.FromString(d.SerializeToString()).imu.header.seq == 42
