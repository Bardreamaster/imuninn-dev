"""iMuninn PC-side gateway and client API."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("imuninn")
except PackageNotFoundError:  # editable / source checkout
    __version__ = "0.0.0"

PROTOCOL_VERSION = 1
SERVICE_TYPE = "_imuninn._tcp.local."
DEFAULT_CONTROL_PORT = 7420
DEFAULT_DATA_PORT = 7421

from .session import DeviceHandle, Session, open  # noqa: E402

__all__ = [
    "PROTOCOL_VERSION",
    "SERVICE_TYPE",
    "DEFAULT_CONTROL_PORT",
    "DEFAULT_DATA_PORT",
    "Session",
    "DeviceHandle",
    "open",
]
