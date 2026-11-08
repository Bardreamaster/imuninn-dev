#!/usr/bin/env bash
# Build the browser viewer (host/web, Vite) and copy it into the Python package as
# imuninn/web_static so `imuninn web` can serve it. Needs Node 20+.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/host/web"
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
DEST="$ROOT/host/python/src/imuninn/web_static"
rm -rf "$DEST" && mkdir -p "$DEST" && cp -R dist/. "$DEST/"
echo "web viewer -> $DEST ($(find "$DEST" -type f | wc -l | tr -d ' ') files)"
