"""MCAP recording / conversion / replay (§7.3): the phone's Protobuf messages are
written as-is, one topic per stream, so the dataset format *is* the protocol.

    imuninn record [phone] -o run1.mcap      # live from a phone
    imuninn convert rec.imuninn -o rec.mcap  # phone-side recording -> MCAP
    imuninn replay run1.mcap                 # iterate; `imuninn rerun --mcap run1.mcap` to view

Topics: /imu (ImuSample), /ar_pose (PoseSample), /rgb (VideoFrame), /depth (DepthFrame),
/gap (Gap), /config (ConfigChanged). log_time = PC wall clock (when recording live) or
device time (when converting); publish_time = device monotonic time, always.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Iterator

from .proto import imuninn_pb2 as pb

MAGIC = b"IMUNINN1"

_BODY_TO_TOPIC = {
    "imu": "/imu",
    "pose": "/ar_pose",
    "video": "/rgb",
    "depth": "/depth",
    "gap": "/gap",
    "config_changed": "/config",
}


class McapRecorder:
    def __init__(self, path: str | Path, device: pb.DeviceInfo | None = None,
                 capabilities: pb.Capabilities | None = None, clock_offset_ns: int | None = None):
        from mcap_protobuf.writer import Writer  # type: ignore

        self.path = Path(path)
        self._f = open(self.path, "wb")
        self._w = Writer(self._f)
        self.count = 0
        self.clock_offset_ns = clock_offset_ns
        if device is not None:
            self._w.write_message("/device", device, log_time=time.time_ns(), publish_time=0)
        if capabilities is not None:
            self._w.write_message("/capabilities", capabilities, log_time=time.time_ns(), publish_time=0)

    def write(self, msg: pb.DataMessage, log_time_ns: int | None = None) -> None:
        body = msg.WhichOneof("body")
        if body is None:
            return
        sample = getattr(msg, body)
        has_header = hasattr(sample, "header")
        publish = sample.header.device_time_ns if has_header else 0
        if log_time_ns is None:
            if self.clock_offset_ns is not None and has_header:
                log_time_ns = publish + self.clock_offset_ns
            else:
                log_time_ns = time.time_ns()
        self._w.write_message(_BODY_TO_TOPIC[body], sample, log_time=log_time_ns, publish_time=publish)
        self.count += 1

    def write_config(self, config: pb.DeviceConfig) -> None:
        self.write(pb.DataMessage(config_changed=pb.ConfigChanged(config=config)))

    def close(self) -> None:
        self._w.finish()
        self._f.close()

    def __enter__(self) -> "McapRecorder":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def read_phone_recording(path: str | Path) -> Iterator[pb.DataMessage]:
    """Iterate a phone-side `.imuninn` recording (magic + length-prefixed DataMessage)."""
    with open(path, "rb") as f:
        if f.read(8) != MAGIC:
            raise ValueError(f"{path}: not an iMuninn recording")
        while True:
            head = f.read(4)
            if len(head) < 4:
                return
            n = int.from_bytes(head, "little")
            payload = f.read(n)
            if len(payload) < n:
                return
            msg = pb.DataMessage()
            msg.ParseFromString(payload)
            yield msg


def convert(src: str | Path, dst: str | Path) -> int:
    """Phone recording -> MCAP. log_time = device time (no PC clock available)."""
    with McapRecorder(dst) as rec:
        for msg in read_phone_recording(src):
            body = msg.WhichOneof("body")
            sample = getattr(msg, body)
            t = sample.header.device_time_ns if hasattr(sample, "header") else 0
            rec.write(msg, log_time_ns=t)
        return rec.count


def replay(path: str | Path, realtime: bool = False, topics: list[str] | None = None) -> Iterator[tuple[str, object]]:
    """Yield (stream_id, sample) from an MCAP file. `realtime=True` sleeps to reproduce timing."""
    from mcap_protobuf.decoder import DecoderFactory  # type: ignore
    from mcap.reader import make_reader  # type: ignore

    with open(path, "rb") as f:
        reader = make_reader(f, decoder_factories=[DecoderFactory()])
        t_first = None
        wall0 = time.monotonic()
        for schema, channel, message, decoded in reader.iter_decoded_messages(topics=topics):
            if channel.topic in ("/device", "/capabilities"):
                continue
            if realtime:
                if t_first is None:
                    t_first = message.log_time
                target = wall0 + (message.log_time - t_first) / 1e9
                delay = target - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
            stream = getattr(decoded, "header", None).stream_id if hasattr(decoded, "header") else channel.topic.strip("/")
            yield stream, decoded


def summary(path: str | Path) -> dict[str, int]:
    from mcap.reader import make_reader  # type: ignore

    with open(path, "rb") as f:
        reader = make_reader(f)
        s = reader.get_summary()
        if s is None:
            return {}
        counts: dict[str, int] = {}
        for cid, st in s.statistics.channel_message_counts.items():
            counts[s.channels[cid].topic] = st
        return counts
