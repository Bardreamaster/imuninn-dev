"""Find phones advertising `_imuninn._tcp` on the local network (Bonjour / mDNS)."""

from __future__ import annotations

import socket
import time
from dataclasses import dataclass

from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

from . import SERVICE_TYPE


@dataclass(frozen=True)
class Phone:
    """A phone found on the LAN: Bonjour name, preferred address and control port."""

    name: str
    host: str
    port: int
    protocol_version: int
    addresses: tuple[str, ...] = ()

    @property
    def address(self) -> str:
        """``host:port`` of the control channel."""
        return f"{self.host}:{self.port}"


class _Listener(ServiceListener):
    def __init__(self) -> None:
        self.found: dict[str, Phone] = {}

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name, timeout=1500)
        if info is None:
            return
        addrs = info.parsed_addresses()
        if not addrs:
            return
        # Prefer IPv4 LAN addresses, then IPv4 link-local (169.254.x = the USB link),
        # then IPv6 (link-local IPv6 needs a scope id and is awkward to connect to).
        addrs = sorted(addrs, key=lambda a: (":" in a, a.startswith("169.254."), a.lower().startswith("fe80")))
        props = {k.decode(): v.decode() if isinstance(v, bytes) else v for k, v in (info.properties or {}).items()}
        short = name.removesuffix("." + type_)
        self.found[name] = Phone(short, addrs[0], info.port, int(props.get("proto", "0") or 0), tuple(addrs))

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.add_service(zc, type_, name)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.found.pop(name, None)


def discover(timeout: float = 2.0, first: bool = False) -> list[Phone]:
    """Browse for `timeout` seconds (or until the first phone when `first=True`)."""
    zc = Zeroconf()
    listener = _Listener()
    browser = ServiceBrowser(zc, SERVICE_TYPE, listener)
    try:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if first and listener.found:
                break
            time.sleep(0.1)
        return sorted(listener.found.values(), key=lambda p: p.name)
    finally:
        browser.cancel()
        zc.close()


def resolve(target: str, timeout: float = 3.0) -> tuple[str, int]:
    """'host', 'host:port', a Bonjour service name, or '' (first phone found) -> (host, port)."""
    from . import DEFAULT_CONTROL_PORT

    if not target:
        phones = discover(timeout, first=True)
        if not phones:
            raise RuntimeError("no iMuninn phone found on the local network")
        return phones[0].host, phones[0].port
    host, _, port = target.rpartition(":") if ":" in target and not target.endswith("]") else (target, "", "")
    if port.isdigit():
        return host, int(port)
    try:
        socket.getaddrinfo(target, None)
        return target, DEFAULT_CONTROL_PORT
    except socket.gaierror:
        pass
    for p in discover(timeout):
        if p.name.lower() == target.lower():
            return p.host, p.port
    raise RuntimeError(f"cannot resolve '{target}': not a hostname and no phone with that name found")
