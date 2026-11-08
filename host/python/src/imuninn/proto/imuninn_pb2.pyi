from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Platform(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PLATFORM_UNSPECIFIED: _ClassVar[Platform]
    PLATFORM_IOS: _ClassVar[Platform]
    PLATFORM_ANDROID: _ClassVar[Platform]

class StreamKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    STREAM_KIND_UNSPECIFIED: _ClassVar[StreamKind]
    STREAM_KIND_IMU: _ClassVar[StreamKind]
    STREAM_KIND_POSE: _ClassVar[StreamKind]
    STREAM_KIND_VIDEO: _ClassVar[StreamKind]
    STREAM_KIND_DEPTH: _ClassVar[StreamKind]
    STREAM_KIND_CONFIG: _ClassVar[StreamKind]
    STREAM_KIND_HEALTH: _ClassVar[StreamKind]

class Transport(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TRANSPORT_UNSPECIFIED: _ClassVar[Transport]
    TRANSPORT_UDP: _ClassVar[Transport]
    TRANSPORT_TCP: _ClassVar[Transport]
    TRANSPORT_WEBSOCKET: _ClassVar[Transport]

class SessionMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SESSION_MODE_UNSPECIFIED: _ClassVar[SessionMode]
    SESSION_MODE_AR: _ClassVar[SessionMode]
    SESSION_MODE_CAMERA: _ClassVar[SessionMode]

class TrackingState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TRACKING_STATE_UNSPECIFIED: _ClassVar[TrackingState]
    TRACKING_STATE_NOT_AVAILABLE: _ClassVar[TrackingState]
    TRACKING_STATE_LIMITED: _ClassVar[TrackingState]
    TRACKING_STATE_NORMAL: _ClassVar[TrackingState]

class PixelFormat(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PIXEL_FORMAT_UNSPECIFIED: _ClassVar[PixelFormat]
    PIXEL_FORMAT_H264_NAL: _ClassVar[PixelFormat]
    PIXEL_FORMAT_HEVC_NAL: _ClassVar[PixelFormat]
    PIXEL_FORMAT_NV12: _ClassVar[PixelFormat]

class DepthCompression(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DEPTH_COMPRESSION_NONE: _ClassVar[DepthCompression]
    DEPTH_COMPRESSION_LZ4: _ClassVar[DepthCompression]
    DEPTH_COMPRESSION_ZSTD: _ClassVar[DepthCompression]
PLATFORM_UNSPECIFIED: Platform
PLATFORM_IOS: Platform
PLATFORM_ANDROID: Platform
STREAM_KIND_UNSPECIFIED: StreamKind
STREAM_KIND_IMU: StreamKind
STREAM_KIND_POSE: StreamKind
STREAM_KIND_VIDEO: StreamKind
STREAM_KIND_DEPTH: StreamKind
STREAM_KIND_CONFIG: StreamKind
STREAM_KIND_HEALTH: StreamKind
TRANSPORT_UNSPECIFIED: Transport
TRANSPORT_UDP: Transport
TRANSPORT_TCP: Transport
TRANSPORT_WEBSOCKET: Transport
SESSION_MODE_UNSPECIFIED: SessionMode
SESSION_MODE_AR: SessionMode
SESSION_MODE_CAMERA: SessionMode
TRACKING_STATE_UNSPECIFIED: TrackingState
TRACKING_STATE_NOT_AVAILABLE: TrackingState
TRACKING_STATE_LIMITED: TrackingState
TRACKING_STATE_NORMAL: TrackingState
PIXEL_FORMAT_UNSPECIFIED: PixelFormat
PIXEL_FORMAT_H264_NAL: PixelFormat
PIXEL_FORMAT_HEVC_NAL: PixelFormat
PIXEL_FORMAT_NV12: PixelFormat
DEPTH_COMPRESSION_NONE: DepthCompression
DEPTH_COMPRESSION_LZ4: DepthCompression
DEPTH_COMPRESSION_ZSTD: DepthCompression

class Header(_message.Message):
    __slots__ = ("stream_id", "seq", "device_time_ns", "protocol_version", "config_version")
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    SEQ_FIELD_NUMBER: _ClassVar[int]
    DEVICE_TIME_NS_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    stream_id: str
    seq: int
    device_time_ns: int
    protocol_version: int
    config_version: int
    def __init__(self, stream_id: _Optional[str] = ..., seq: _Optional[int] = ..., device_time_ns: _Optional[int] = ..., protocol_version: _Optional[int] = ..., config_version: _Optional[int] = ...) -> None: ...

class DeviceInfo(_message.Message):
    __slots__ = ("device_id", "device_name", "model", "platform", "os_version", "protocol_version", "app_version", "has_lidar")
    DEVICE_ID_FIELD_NUMBER: _ClassVar[int]
    DEVICE_NAME_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PLATFORM_FIELD_NUMBER: _ClassVar[int]
    OS_VERSION_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    APP_VERSION_FIELD_NUMBER: _ClassVar[int]
    HAS_LIDAR_FIELD_NUMBER: _ClassVar[int]
    device_id: str
    device_name: str
    model: str
    platform: Platform
    os_version: str
    protocol_version: int
    app_version: str
    has_lidar: bool
    def __init__(self, device_id: _Optional[str] = ..., device_name: _Optional[str] = ..., model: _Optional[str] = ..., platform: _Optional[_Union[Platform, str]] = ..., os_version: _Optional[str] = ..., protocol_version: _Optional[int] = ..., app_version: _Optional[str] = ..., has_lidar: _Optional[bool] = ...) -> None: ...

class ParamSpec(_message.Message):
    __slots__ = ("key", "label", "unit", "kind", "apply", "min", "max", "step", "choices", "current", "default", "read_only")
    class Kind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        KIND_UNSPECIFIED: _ClassVar[ParamSpec.Kind]
        KIND_BOOL: _ClassVar[ParamSpec.Kind]
        KIND_INT: _ClassVar[ParamSpec.Kind]
        KIND_FLOAT: _ClassVar[ParamSpec.Kind]
        KIND_ENUM: _ClassVar[ParamSpec.Kind]
        KIND_STRING: _ClassVar[ParamSpec.Kind]
    KIND_UNSPECIFIED: ParamSpec.Kind
    KIND_BOOL: ParamSpec.Kind
    KIND_INT: ParamSpec.Kind
    KIND_FLOAT: ParamSpec.Kind
    KIND_ENUM: ParamSpec.Kind
    KIND_STRING: ParamSpec.Kind
    class Apply(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        APPLY_UNSPECIFIED: _ClassVar[ParamSpec.Apply]
        APPLY_IMMEDIATE: _ClassVar[ParamSpec.Apply]
        APPLY_RESTART_SESSION: _ClassVar[ParamSpec.Apply]
    APPLY_UNSPECIFIED: ParamSpec.Apply
    APPLY_IMMEDIATE: ParamSpec.Apply
    APPLY_RESTART_SESSION: ParamSpec.Apply
    KEY_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    UNIT_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    APPLY_FIELD_NUMBER: _ClassVar[int]
    MIN_FIELD_NUMBER: _ClassVar[int]
    MAX_FIELD_NUMBER: _ClassVar[int]
    STEP_FIELD_NUMBER: _ClassVar[int]
    CHOICES_FIELD_NUMBER: _ClassVar[int]
    CURRENT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_FIELD_NUMBER: _ClassVar[int]
    READ_ONLY_FIELD_NUMBER: _ClassVar[int]
    key: str
    label: str
    unit: str
    kind: ParamSpec.Kind
    apply: ParamSpec.Apply
    min: float
    max: float
    step: float
    choices: _containers.RepeatedScalarFieldContainer[str]
    current: Value
    default: Value
    read_only: bool
    def __init__(self, key: _Optional[str] = ..., label: _Optional[str] = ..., unit: _Optional[str] = ..., kind: _Optional[_Union[ParamSpec.Kind, str]] = ..., apply: _Optional[_Union[ParamSpec.Apply, str]] = ..., min: _Optional[float] = ..., max: _Optional[float] = ..., step: _Optional[float] = ..., choices: _Optional[_Iterable[str]] = ..., current: _Optional[_Union[Value, _Mapping]] = ..., default: _Optional[_Union[Value, _Mapping]] = ..., read_only: _Optional[bool] = ...) -> None: ...

class Value(_message.Message):
    __slots__ = ("b", "i", "f", "s")
    B_FIELD_NUMBER: _ClassVar[int]
    I_FIELD_NUMBER: _ClassVar[int]
    F_FIELD_NUMBER: _ClassVar[int]
    S_FIELD_NUMBER: _ClassVar[int]
    b: bool
    i: int
    f: float
    s: str
    def __init__(self, b: _Optional[bool] = ..., i: _Optional[int] = ..., f: _Optional[float] = ..., s: _Optional[str] = ...) -> None: ...

class StreamDescriptor(_message.Message):
    __slots__ = ("stream_id", "kind", "transport", "params")
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    TRANSPORT_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    stream_id: str
    kind: StreamKind
    transport: Transport
    params: _containers.RepeatedCompositeFieldContainer[ParamSpec]
    def __init__(self, stream_id: _Optional[str] = ..., kind: _Optional[_Union[StreamKind, str]] = ..., transport: _Optional[_Union[Transport, str]] = ..., params: _Optional[_Iterable[_Union[ParamSpec, _Mapping]]] = ...) -> None: ...

class Capabilities(_message.Message):
    __slots__ = ("device", "streams", "session_params", "config")
    DEVICE_FIELD_NUMBER: _ClassVar[int]
    STREAMS_FIELD_NUMBER: _ClassVar[int]
    SESSION_PARAMS_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    device: DeviceInfo
    streams: _containers.RepeatedCompositeFieldContainer[StreamDescriptor]
    session_params: _containers.RepeatedCompositeFieldContainer[ParamSpec]
    config: DeviceConfig
    def __init__(self, device: _Optional[_Union[DeviceInfo, _Mapping]] = ..., streams: _Optional[_Iterable[_Union[StreamDescriptor, _Mapping]]] = ..., session_params: _Optional[_Iterable[_Union[ParamSpec, _Mapping]]] = ..., config: _Optional[_Union[DeviceConfig, _Mapping]] = ...) -> None: ...

class DeviceConfig(_message.Message):
    __slots__ = ("config_version", "mode", "streams", "network", "session_params")
    class SessionParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: Value
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[Value, _Mapping]] = ...) -> None: ...
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    STREAMS_FIELD_NUMBER: _ClassVar[int]
    NETWORK_FIELD_NUMBER: _ClassVar[int]
    SESSION_PARAMS_FIELD_NUMBER: _ClassVar[int]
    config_version: int
    mode: SessionMode
    streams: _containers.RepeatedCompositeFieldContainer[StreamConfig]
    network: NetworkConfig
    session_params: _containers.MessageMap[str, Value]
    def __init__(self, config_version: _Optional[int] = ..., mode: _Optional[_Union[SessionMode, str]] = ..., streams: _Optional[_Iterable[_Union[StreamConfig, _Mapping]]] = ..., network: _Optional[_Union[NetworkConfig, _Mapping]] = ..., session_params: _Optional[_Mapping[str, Value]] = ...) -> None: ...

class StreamConfig(_message.Message):
    __slots__ = ("stream_id", "enabled", "params", "encoder", "delivery")
    class ParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: Value
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[Value, _Mapping]] = ...) -> None: ...
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    PARAMS_FIELD_NUMBER: _ClassVar[int]
    ENCODER_FIELD_NUMBER: _ClassVar[int]
    DELIVERY_FIELD_NUMBER: _ClassVar[int]
    stream_id: str
    enabled: bool
    params: _containers.MessageMap[str, Value]
    encoder: EncoderConfig
    delivery: DeliveryConfig
    def __init__(self, stream_id: _Optional[str] = ..., enabled: _Optional[bool] = ..., params: _Optional[_Mapping[str, Value]] = ..., encoder: _Optional[_Union[EncoderConfig, _Mapping]] = ..., delivery: _Optional[_Union[DeliveryConfig, _Mapping]] = ...) -> None: ...

class EncoderConfig(_message.Message):
    __slots__ = ("codec", "bitrate_bps", "keyframe_interval")
    CODEC_FIELD_NUMBER: _ClassVar[int]
    BITRATE_BPS_FIELD_NUMBER: _ClassVar[int]
    KEYFRAME_INTERVAL_FIELD_NUMBER: _ClassVar[int]
    codec: str
    bitrate_bps: int
    keyframe_interval: int
    def __init__(self, codec: _Optional[str] = ..., bitrate_bps: _Optional[int] = ..., keyframe_interval: _Optional[int] = ...) -> None: ...

class DeliveryConfig(_message.Message):
    __slots__ = ("transport", "drop_policy", "max_rate_hz", "priority")
    class DropPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        DROP_POLICY_UNSPECIFIED: _ClassVar[DeliveryConfig.DropPolicy]
        DROP_POLICY_LATEST_ONLY: _ClassVar[DeliveryConfig.DropPolicy]
        DROP_POLICY_NONE: _ClassVar[DeliveryConfig.DropPolicy]
    DROP_POLICY_UNSPECIFIED: DeliveryConfig.DropPolicy
    DROP_POLICY_LATEST_ONLY: DeliveryConfig.DropPolicy
    DROP_POLICY_NONE: DeliveryConfig.DropPolicy
    TRANSPORT_FIELD_NUMBER: _ClassVar[int]
    DROP_POLICY_FIELD_NUMBER: _ClassVar[int]
    MAX_RATE_HZ_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    transport: Transport
    drop_policy: DeliveryConfig.DropPolicy
    max_rate_hz: int
    priority: int
    def __init__(self, transport: _Optional[_Union[Transport, str]] = ..., drop_policy: _Optional[_Union[DeliveryConfig.DropPolicy, str]] = ..., max_rate_hz: _Optional[int] = ..., priority: _Optional[int] = ...) -> None: ...

class NetworkConfig(_message.Message):
    __slots__ = ("host", "control_port", "data_port", "bandwidth_limit_bps")
    HOST_FIELD_NUMBER: _ClassVar[int]
    CONTROL_PORT_FIELD_NUMBER: _ClassVar[int]
    DATA_PORT_FIELD_NUMBER: _ClassVar[int]
    BANDWIDTH_LIMIT_BPS_FIELD_NUMBER: _ClassVar[int]
    host: str
    control_port: int
    data_port: int
    bandwidth_limit_bps: int
    def __init__(self, host: _Optional[str] = ..., control_port: _Optional[int] = ..., data_port: _Optional[int] = ..., bandwidth_limit_bps: _Optional[int] = ...) -> None: ...

class ControlMessage(_message.Message):
    __slots__ = ("request_id", "hello", "welcome", "get_capabilities", "capabilities", "get_config", "config", "set_config", "config_result", "config_changed", "subscribe", "session_control", "time_sync_ping", "time_sync_pong", "lease", "error")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    HELLO_FIELD_NUMBER: _ClassVar[int]
    WELCOME_FIELD_NUMBER: _ClassVar[int]
    GET_CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    GET_CONFIG_FIELD_NUMBER: _ClassVar[int]
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    SET_CONFIG_FIELD_NUMBER: _ClassVar[int]
    CONFIG_RESULT_FIELD_NUMBER: _ClassVar[int]
    CONFIG_CHANGED_FIELD_NUMBER: _ClassVar[int]
    SUBSCRIBE_FIELD_NUMBER: _ClassVar[int]
    SESSION_CONTROL_FIELD_NUMBER: _ClassVar[int]
    TIME_SYNC_PING_FIELD_NUMBER: _ClassVar[int]
    TIME_SYNC_PONG_FIELD_NUMBER: _ClassVar[int]
    LEASE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    request_id: int
    hello: Hello
    welcome: Welcome
    get_capabilities: GetCapabilities
    capabilities: Capabilities
    get_config: GetConfig
    config: DeviceConfig
    set_config: SetConfig
    config_result: ConfigResult
    config_changed: ConfigChanged
    subscribe: Subscribe
    session_control: SessionControl
    time_sync_ping: TimeSyncPing
    time_sync_pong: TimeSyncPong
    lease: Lease
    error: Error
    def __init__(self, request_id: _Optional[int] = ..., hello: _Optional[_Union[Hello, _Mapping]] = ..., welcome: _Optional[_Union[Welcome, _Mapping]] = ..., get_capabilities: _Optional[_Union[GetCapabilities, _Mapping]] = ..., capabilities: _Optional[_Union[Capabilities, _Mapping]] = ..., get_config: _Optional[_Union[GetConfig, _Mapping]] = ..., config: _Optional[_Union[DeviceConfig, _Mapping]] = ..., set_config: _Optional[_Union[SetConfig, _Mapping]] = ..., config_result: _Optional[_Union[ConfigResult, _Mapping]] = ..., config_changed: _Optional[_Union[ConfigChanged, _Mapping]] = ..., subscribe: _Optional[_Union[Subscribe, _Mapping]] = ..., session_control: _Optional[_Union[SessionControl, _Mapping]] = ..., time_sync_ping: _Optional[_Union[TimeSyncPing, _Mapping]] = ..., time_sync_pong: _Optional[_Union[TimeSyncPong, _Mapping]] = ..., lease: _Optional[_Union[Lease, _Mapping]] = ..., error: _Optional[_Union[Error, _Mapping]] = ...) -> None: ...

class ClientInfo(_message.Message):
    __slots__ = ("name", "version")
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    name: str
    version: str
    def __init__(self, name: _Optional[str] = ..., version: _Optional[str] = ...) -> None: ...

class Hello(_message.Message):
    __slots__ = ("client", "udp_port", "protocol_version", "data_transport")
    CLIENT_FIELD_NUMBER: _ClassVar[int]
    UDP_PORT_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    DATA_TRANSPORT_FIELD_NUMBER: _ClassVar[int]
    client: ClientInfo
    udp_port: int
    protocol_version: int
    data_transport: Transport
    def __init__(self, client: _Optional[_Union[ClientInfo, _Mapping]] = ..., udp_port: _Optional[int] = ..., protocol_version: _Optional[int] = ..., data_transport: _Optional[_Union[Transport, str]] = ...) -> None: ...

class Welcome(_message.Message):
    __slots__ = ("device", "capabilities", "protocol_version", "tcp_port", "client_id")
    DEVICE_FIELD_NUMBER: _ClassVar[int]
    CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_VERSION_FIELD_NUMBER: _ClassVar[int]
    TCP_PORT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    device: DeviceInfo
    capabilities: Capabilities
    protocol_version: int
    tcp_port: int
    client_id: int
    def __init__(self, device: _Optional[_Union[DeviceInfo, _Mapping]] = ..., capabilities: _Optional[_Union[Capabilities, _Mapping]] = ..., protocol_version: _Optional[int] = ..., tcp_port: _Optional[int] = ..., client_id: _Optional[int] = ...) -> None: ...

class GetCapabilities(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetConfig(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class SetConfig(_message.Message):
    __slots__ = ("base_config_version", "patch")
    BASE_CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    PATCH_FIELD_NUMBER: _ClassVar[int]
    base_config_version: int
    patch: DeviceConfig
    def __init__(self, base_config_version: _Optional[int] = ..., patch: _Optional[_Union[DeviceConfig, _Mapping]] = ...) -> None: ...

class ConfigResult(_message.Message):
    __slots__ = ("config_version", "fields", "session_restarted")
    class FieldResult(_message.Message):
        __slots__ = ("key", "status", "effective", "reason")
        class Status(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
            __slots__ = ()
            STATUS_UNSPECIFIED: _ClassVar[ConfigResult.FieldResult.Status]
            STATUS_APPLIED: _ClassVar[ConfigResult.FieldResult.Status]
            STATUS_CLAMPED: _ClassVar[ConfigResult.FieldResult.Status]
            STATUS_REJECTED: _ClassVar[ConfigResult.FieldResult.Status]
        STATUS_UNSPECIFIED: ConfigResult.FieldResult.Status
        STATUS_APPLIED: ConfigResult.FieldResult.Status
        STATUS_CLAMPED: ConfigResult.FieldResult.Status
        STATUS_REJECTED: ConfigResult.FieldResult.Status
        KEY_FIELD_NUMBER: _ClassVar[int]
        STATUS_FIELD_NUMBER: _ClassVar[int]
        EFFECTIVE_FIELD_NUMBER: _ClassVar[int]
        REASON_FIELD_NUMBER: _ClassVar[int]
        key: str
        status: ConfigResult.FieldResult.Status
        effective: Value
        reason: str
        def __init__(self, key: _Optional[str] = ..., status: _Optional[_Union[ConfigResult.FieldResult.Status, str]] = ..., effective: _Optional[_Union[Value, _Mapping]] = ..., reason: _Optional[str] = ...) -> None: ...
    CONFIG_VERSION_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    SESSION_RESTARTED_FIELD_NUMBER: _ClassVar[int]
    config_version: int
    fields: _containers.RepeatedCompositeFieldContainer[ConfigResult.FieldResult]
    session_restarted: bool
    def __init__(self, config_version: _Optional[int] = ..., fields: _Optional[_Iterable[_Union[ConfigResult.FieldResult, _Mapping]]] = ..., session_restarted: _Optional[bool] = ...) -> None: ...

class ConfigChanged(_message.Message):
    __slots__ = ("config",)
    CONFIG_FIELD_NUMBER: _ClassVar[int]
    config: DeviceConfig
    def __init__(self, config: _Optional[_Union[DeviceConfig, _Mapping]] = ...) -> None: ...

class Subscribe(_message.Message):
    __slots__ = ("stream_ids", "unsubscribe")
    STREAM_IDS_FIELD_NUMBER: _ClassVar[int]
    UNSUBSCRIBE_FIELD_NUMBER: _ClassVar[int]
    stream_ids: _containers.RepeatedScalarFieldContainer[str]
    unsubscribe: bool
    def __init__(self, stream_ids: _Optional[_Iterable[str]] = ..., unsubscribe: _Optional[bool] = ...) -> None: ...

class SessionControl(_message.Message):
    __slots__ = ("action",)
    class Action(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        ACTION_UNSPECIFIED: _ClassVar[SessionControl.Action]
        ACTION_START: _ClassVar[SessionControl.Action]
        ACTION_STOP: _ClassVar[SessionControl.Action]
        ACTION_START_RECORDING: _ClassVar[SessionControl.Action]
        ACTION_STOP_RECORDING: _ClassVar[SessionControl.Action]
    ACTION_UNSPECIFIED: SessionControl.Action
    ACTION_START: SessionControl.Action
    ACTION_STOP: SessionControl.Action
    ACTION_START_RECORDING: SessionControl.Action
    ACTION_STOP_RECORDING: SessionControl.Action
    ACTION_FIELD_NUMBER: _ClassVar[int]
    action: SessionControl.Action
    def __init__(self, action: _Optional[_Union[SessionControl.Action, str]] = ...) -> None: ...

class TimeSyncPing(_message.Message):
    __slots__ = ("client_send_ns",)
    CLIENT_SEND_NS_FIELD_NUMBER: _ClassVar[int]
    client_send_ns: int
    def __init__(self, client_send_ns: _Optional[int] = ...) -> None: ...

class TimeSyncPong(_message.Message):
    __slots__ = ("client_send_ns", "device_recv_ns", "device_send_ns")
    CLIENT_SEND_NS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_RECV_NS_FIELD_NUMBER: _ClassVar[int]
    DEVICE_SEND_NS_FIELD_NUMBER: _ClassVar[int]
    client_send_ns: int
    device_recv_ns: int
    device_send_ns: int
    def __init__(self, client_send_ns: _Optional[int] = ..., device_recv_ns: _Optional[int] = ..., device_send_ns: _Optional[int] = ...) -> None: ...

class Lease(_message.Message):
    __slots__ = ("action", "holder")
    class Action(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        ACTION_UNSPECIFIED: _ClassVar[Lease.Action]
        ACTION_REQUEST: _ClassVar[Lease.Action]
        ACTION_RELEASE: _ClassVar[Lease.Action]
        ACTION_GRANTED: _ClassVar[Lease.Action]
        ACTION_DENIED: _ClassVar[Lease.Action]
        ACTION_REVOKED: _ClassVar[Lease.Action]
    ACTION_UNSPECIFIED: Lease.Action
    ACTION_REQUEST: Lease.Action
    ACTION_RELEASE: Lease.Action
    ACTION_GRANTED: Lease.Action
    ACTION_DENIED: Lease.Action
    ACTION_REVOKED: Lease.Action
    ACTION_FIELD_NUMBER: _ClassVar[int]
    HOLDER_FIELD_NUMBER: _ClassVar[int]
    action: Lease.Action
    holder: str
    def __init__(self, action: _Optional[_Union[Lease.Action, str]] = ..., holder: _Optional[str] = ...) -> None: ...

class Error(_message.Message):
    __slots__ = ("code", "message")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    code: int
    message: str
    def __init__(self, code: _Optional[int] = ..., message: _Optional[str] = ...) -> None: ...

class DeviceHealth(_message.Message):
    __slots__ = ("header", "thermal", "battery_level", "battery_state", "low_power_mode", "pose_hz", "imu_hz", "video_fps", "depth_hz", "video_kbps", "encoder_dropped", "uptime_s")
    class Thermal(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        THERMAL_UNSPECIFIED: _ClassVar[DeviceHealth.Thermal]
        THERMAL_NOMINAL: _ClassVar[DeviceHealth.Thermal]
        THERMAL_FAIR: _ClassVar[DeviceHealth.Thermal]
        THERMAL_SERIOUS: _ClassVar[DeviceHealth.Thermal]
        THERMAL_CRITICAL: _ClassVar[DeviceHealth.Thermal]
    THERMAL_UNSPECIFIED: DeviceHealth.Thermal
    THERMAL_NOMINAL: DeviceHealth.Thermal
    THERMAL_FAIR: DeviceHealth.Thermal
    THERMAL_SERIOUS: DeviceHealth.Thermal
    THERMAL_CRITICAL: DeviceHealth.Thermal
    class BatteryState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        BATTERY_UNSPECIFIED: _ClassVar[DeviceHealth.BatteryState]
        BATTERY_UNPLUGGED: _ClassVar[DeviceHealth.BatteryState]
        BATTERY_CHARGING: _ClassVar[DeviceHealth.BatteryState]
        BATTERY_FULL: _ClassVar[DeviceHealth.BatteryState]
    BATTERY_UNSPECIFIED: DeviceHealth.BatteryState
    BATTERY_UNPLUGGED: DeviceHealth.BatteryState
    BATTERY_CHARGING: DeviceHealth.BatteryState
    BATTERY_FULL: DeviceHealth.BatteryState
    HEADER_FIELD_NUMBER: _ClassVar[int]
    THERMAL_FIELD_NUMBER: _ClassVar[int]
    BATTERY_LEVEL_FIELD_NUMBER: _ClassVar[int]
    BATTERY_STATE_FIELD_NUMBER: _ClassVar[int]
    LOW_POWER_MODE_FIELD_NUMBER: _ClassVar[int]
    POSE_HZ_FIELD_NUMBER: _ClassVar[int]
    IMU_HZ_FIELD_NUMBER: _ClassVar[int]
    VIDEO_FPS_FIELD_NUMBER: _ClassVar[int]
    DEPTH_HZ_FIELD_NUMBER: _ClassVar[int]
    VIDEO_KBPS_FIELD_NUMBER: _ClassVar[int]
    ENCODER_DROPPED_FIELD_NUMBER: _ClassVar[int]
    UPTIME_S_FIELD_NUMBER: _ClassVar[int]
    header: Header
    thermal: DeviceHealth.Thermal
    battery_level: float
    battery_state: DeviceHealth.BatteryState
    low_power_mode: bool
    pose_hz: float
    imu_hz: float
    video_fps: float
    depth_hz: float
    video_kbps: float
    encoder_dropped: int
    uptime_s: float
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., thermal: _Optional[_Union[DeviceHealth.Thermal, str]] = ..., battery_level: _Optional[float] = ..., battery_state: _Optional[_Union[DeviceHealth.BatteryState, str]] = ..., low_power_mode: _Optional[bool] = ..., pose_hz: _Optional[float] = ..., imu_hz: _Optional[float] = ..., video_fps: _Optional[float] = ..., depth_hz: _Optional[float] = ..., video_kbps: _Optional[float] = ..., encoder_dropped: _Optional[int] = ..., uptime_s: _Optional[float] = ...) -> None: ...

class Vec3(_message.Message):
    __slots__ = ("x", "y", "z")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    z: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ..., z: _Optional[float] = ...) -> None: ...

class Quat(_message.Message):
    __slots__ = ("x", "y", "z", "w")
    X_FIELD_NUMBER: _ClassVar[int]
    Y_FIELD_NUMBER: _ClassVar[int]
    Z_FIELD_NUMBER: _ClassVar[int]
    W_FIELD_NUMBER: _ClassVar[int]
    x: float
    y: float
    z: float
    w: float
    def __init__(self, x: _Optional[float] = ..., y: _Optional[float] = ..., z: _Optional[float] = ..., w: _Optional[float] = ...) -> None: ...

class ImuSample(_message.Message):
    __slots__ = ("header", "accel", "gyro", "mag")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    ACCEL_FIELD_NUMBER: _ClassVar[int]
    GYRO_FIELD_NUMBER: _ClassVar[int]
    MAG_FIELD_NUMBER: _ClassVar[int]
    header: Header
    accel: Vec3
    gyro: Vec3
    mag: Vec3
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., accel: _Optional[_Union[Vec3, _Mapping]] = ..., gyro: _Optional[_Union[Vec3, _Mapping]] = ..., mag: _Optional[_Union[Vec3, _Mapping]] = ...) -> None: ...

class Intrinsics(_message.Message):
    __slots__ = ("width", "height", "fx", "fy", "cx", "cy", "distortion")
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    FX_FIELD_NUMBER: _ClassVar[int]
    FY_FIELD_NUMBER: _ClassVar[int]
    CX_FIELD_NUMBER: _ClassVar[int]
    CY_FIELD_NUMBER: _ClassVar[int]
    DISTORTION_FIELD_NUMBER: _ClassVar[int]
    width: int
    height: int
    fx: float
    fy: float
    cx: float
    cy: float
    distortion: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, width: _Optional[int] = ..., height: _Optional[int] = ..., fx: _Optional[float] = ..., fy: _Optional[float] = ..., cx: _Optional[float] = ..., cy: _Optional[float] = ..., distortion: _Optional[_Iterable[float]] = ...) -> None: ...

class PoseSample(_message.Message):
    __slots__ = ("header", "position", "orientation", "tracking", "intrinsics")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    POSITION_FIELD_NUMBER: _ClassVar[int]
    ORIENTATION_FIELD_NUMBER: _ClassVar[int]
    TRACKING_FIELD_NUMBER: _ClassVar[int]
    INTRINSICS_FIELD_NUMBER: _ClassVar[int]
    header: Header
    position: Vec3
    orientation: Quat
    tracking: TrackingState
    intrinsics: Intrinsics
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., position: _Optional[_Union[Vec3, _Mapping]] = ..., orientation: _Optional[_Union[Quat, _Mapping]] = ..., tracking: _Optional[_Union[TrackingState, str]] = ..., intrinsics: _Optional[_Union[Intrinsics, _Mapping]] = ...) -> None: ...

class VideoFrame(_message.Message):
    __slots__ = ("header", "format", "width", "height", "keyframe", "data", "intrinsics", "rotation_deg")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    KEYFRAME_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    INTRINSICS_FIELD_NUMBER: _ClassVar[int]
    ROTATION_DEG_FIELD_NUMBER: _ClassVar[int]
    header: Header
    format: PixelFormat
    width: int
    height: int
    keyframe: bool
    data: bytes
    intrinsics: Intrinsics
    rotation_deg: int
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., format: _Optional[_Union[PixelFormat, str]] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., keyframe: _Optional[bool] = ..., data: _Optional[bytes] = ..., intrinsics: _Optional[_Union[Intrinsics, _Mapping]] = ..., rotation_deg: _Optional[int] = ...) -> None: ...

class DepthFrame(_message.Message):
    __slots__ = ("header", "width", "height", "compression", "depth_mm", "confidence", "intrinsics", "rotation_deg")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    WIDTH_FIELD_NUMBER: _ClassVar[int]
    HEIGHT_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_FIELD_NUMBER: _ClassVar[int]
    DEPTH_MM_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    INTRINSICS_FIELD_NUMBER: _ClassVar[int]
    ROTATION_DEG_FIELD_NUMBER: _ClassVar[int]
    header: Header
    width: int
    height: int
    compression: DepthCompression
    depth_mm: bytes
    confidence: bytes
    intrinsics: Intrinsics
    rotation_deg: int
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., width: _Optional[int] = ..., height: _Optional[int] = ..., compression: _Optional[_Union[DepthCompression, str]] = ..., depth_mm: _Optional[bytes] = ..., confidence: _Optional[bytes] = ..., intrinsics: _Optional[_Union[Intrinsics, _Mapping]] = ..., rotation_deg: _Optional[int] = ...) -> None: ...

class Gap(_message.Message):
    __slots__ = ("header", "reason")
    HEADER_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    header: Header
    reason: str
    def __init__(self, header: _Optional[_Union[Header, _Mapping]] = ..., reason: _Optional[str] = ...) -> None: ...

class DataMessage(_message.Message):
    __slots__ = ("imu", "pose", "video", "depth", "gap", "config_changed", "health")
    IMU_FIELD_NUMBER: _ClassVar[int]
    POSE_FIELD_NUMBER: _ClassVar[int]
    VIDEO_FIELD_NUMBER: _ClassVar[int]
    DEPTH_FIELD_NUMBER: _ClassVar[int]
    GAP_FIELD_NUMBER: _ClassVar[int]
    CONFIG_CHANGED_FIELD_NUMBER: _ClassVar[int]
    HEALTH_FIELD_NUMBER: _ClassVar[int]
    imu: ImuSample
    pose: PoseSample
    video: VideoFrame
    depth: DepthFrame
    gap: Gap
    config_changed: ConfigChanged
    health: DeviceHealth
    def __init__(self, imu: _Optional[_Union[ImuSample, _Mapping]] = ..., pose: _Optional[_Union[PoseSample, _Mapping]] = ..., video: _Optional[_Union[VideoFrame, _Mapping]] = ..., depth: _Optional[_Union[DepthFrame, _Mapping]] = ..., gap: _Optional[_Union[Gap, _Mapping]] = ..., config_changed: _Optional[_Union[ConfigChanged, _Mapping]] = ..., health: _Optional[_Union[DeviceHealth, _Mapping]] = ...) -> None: ...
