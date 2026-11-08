"""`imuninn web`: serve the browser viewer from this machine.

The viewer is a static page (built from `host/web`, shipped in the package as
``imuninn/web_static``) that connects straight to the phone over WebSocket. It has to be
opened from a *secure, local* origin: on ``http://localhost`` browsers expose WebCodecs
(H.264 decoding) and allow connections to LAN addresses; the same page on a public
http host is blocked by Chrome / Edge (no WebCodecs, Local Network Access denied) and on
a public https host the ``ws://`` connection is refused as mixed content.

    imuninn web                 # http://localhost:7430 and open it in the default browser
    imuninn web --port 8000 --no-open
"""

from __future__ import annotations

import functools
import http.server
import importlib.resources
import logging
import os
import threading
import webbrowser
from pathlib import Path

log = logging.getLogger("imuninn.web")

DEFAULT_PORT = 7430


def static_dir() -> Path:
    """Directory holding the built viewer (package data, or ``host/web/dist`` in a checkout)."""
    packaged = Path(str(importlib.resources.files("imuninn") / "web_static"))
    if (packaged / "index.html").exists():
        return packaged
    checkout = Path(__file__).resolve().parents[3] / "web" / "dist"
    if (checkout / "index.html").exists():
        return checkout
    raise FileNotFoundError(
        "the web viewer is not built: run tools/build-web.sh in a source checkout "
        "(needs Node), or install a release wheel from PyPI which ships it"
    )


class _Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter than the default
        log.debug(fmt, *args)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def serve(host: str = "127.0.0.1", port: int = DEFAULT_PORT, open_browser: bool = True, directory: str | Path | None = None) -> None:
    """Serve the viewer until Ctrl-C.

    Keep ``host`` at ``127.0.0.1`` for normal use: only a localhost origin gives other
    browsers WebCodecs and LAN access. Binding to ``0.0.0.0`` lets other devices load the
    page, but for them it is an insecure remote origin with the limits described above.
    """
    directory = Path(directory) if directory else static_dir()
    handler = functools.partial(_Handler, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer((host, port), handler)
    url = f"http://{'localhost' if host in ('127.0.0.1', '0.0.0.0', '::') else host}:{port}/"
    print(f"iMuninn web viewer: {url}   (serving {directory}; Ctrl-C to stop)")
    if open_browser and not os.environ.get("IMUNINN_NO_BROWSER"):
        threading.Timer(0.3, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
