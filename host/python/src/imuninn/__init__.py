"""iMuninn PC-side client API. The phone is the server; PCs connect to it."""

from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("imuninn")
except PackageNotFoundError:  # editable / source checkout
    __version__ = "0.0.0"

PROTOCOL_VERSION = 5
SERVICE_TYPE = "_imuninn._tcp.local."
DEFAULT_CONTROL_PORT = 7420

from .discovery import Phone, discover  # noqa: E402
from .client import LeaseError  # noqa: E402
from .session import Device, connect  # noqa: E402

__all__ = ["PROTOCOL_VERSION", "SERVICE_TYPE", "DEFAULT_CONTROL_PORT", "Phone", "discover", "Device", "connect", "LeaseError"]
