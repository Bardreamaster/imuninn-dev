from __future__ import annotations

import argparse

from . import DEFAULT_CONTROL_PORT, PROTOCOL_VERSION, __version__


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="imuninn", description="iMuninn PC gateway")
    p.add_argument("--version", action="version", version=f"imuninn {__version__} (protocol v{PROTOCOL_VERSION})")
    sub = p.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gateway", help="run the gateway (mDNS + control channel)")
    g.add_argument("--name", help="service name shown to phones (default: hostname)")
    g.add_argument("--port", type=int, default=DEFAULT_CONTROL_PORT)

    args = p.parse_args(argv)
    if args.cmd == "gateway":
        from .gateway import run_gateway

        run_gateway(args.name, args.port)
