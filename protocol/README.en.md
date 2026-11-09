# iMuninn protocol

[中文](README.md)

`imuninn.proto` is the single source of truth for the phone, the PC and every language binding. A protocol change updates all sides in one commit and bumps `VERSION`.

Field reference (generated): `docs/protocol/messages.md`.

## Versions

- `VERSION` holds the integer protocol version, carried in every message header as `Header.protocol_version`.
- Add, never change: removed fields become `reserved`; field numbers are never reused.
- A change of meaning bumps the version too, even when field numbers stay the same.

## Channels

| channel | transport | messages | loss policy |
| --- | --- | --- | --- |
| control | WebSocket | `ControlMessage` | reliable |
| IMU / pose / health | UDP (phone → each client's port), one `DataMessage` per datagram | `ImuSample`, `PoseSample`, `DeviceHealth` | may drop |
| video | TCP | `VideoFrame` (H.264 Annex-B) | sender keeps only the newest frame |
| depth | TCP | `DepthFrame` (uint16 mm + LZ4; zstd reserved) | never drops |
| all data (browsers) | WebSocket (v5, `Hello.data_transport = WEBSOCKET`) | as above, one `DataMessage` per frame | like TCP: a video backlog drops non-key frames |

Framing on TCP: `uint32 little-endian length` + `DataMessage` bytes. On UDP each datagram is one `DataMessage`, never fragmented (anything larger than the MTU goes over TCP).

## Connection flow (the phone is the server)

1. The phone advertises the Bonjour service `_imuninn._tcp` (name = device name, TXT `proto=<version>`) and listens on control port 7420 (WebSocket) and data port 7422 (TCP).
2. The PC discovers the phone or is given its address, opens the control WebSocket and sends `Hello` (client name, the port it receives UDP on); the phone answers `Welcome` (device info, capabilities + current configuration, TCP port, `client_id`).
3. The PC connects to the phone's TCP data port, writes the 4-byte LE `client_id`, then receives video / depth. Pose / IMU / health are sent by the phone to the PC's UDP port.
   Browsers have no raw TCP / UDP: with `Hello.data_transport = TRANSPORT_WEBSOCKET` the client opens a second WebSocket to the control port, sends binary `"IMDATA01"` + the 4-byte LE `client_id` as its first frame, and then receives every subscribed stream as binary `DataMessage` frames on that connection.
4. `Subscribe` picks streams; `SessionControl START` starts capture. Several PCs can connect at once, each with its own subscriptions.
5. Configuration changes use `SetConfig` (partial update + `base_config_version`) → `ConfigResult` → `ConfigChanged` broadcast to every client. Only the client holding the lease (`Lease`) may change the configuration at a time.

## Coordinate frames

Poses keep the native ARKit / ARCore convention: right-handed, Y up, the camera looks down −Z. To get the OpenCV camera frame (X right, Y down, Z forward), negate the camera's Y and Z axes; the SDK does not convert for you.

Images are sent in sensor orientation; `rotation_deg` says how far to rotate clockwise for display. Intrinsics are in the same orientation as the image.

## Code generation

```bash
tools/gen-proto.sh
```

Generates Python, C++, Swift and Java bindings and copies `imuninn.proto` into the Python package. The Python bindings are committed (installs need no protoc; CI checks them against the `.proto`); generated code for the other languages is not.
