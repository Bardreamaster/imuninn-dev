#!/usr/bin/env bash
# Generate language bindings from protocol/imuninn.proto.
# Python and C++ via protoc; Swift via protoc-gen-swift (brew install swift-protobuf);
# Android Java via protoc --java_out (built in). Missing plugins are skipped.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROTO_DIR="$ROOT/protocol"
PROTO="$PROTO_DIR/imuninn.proto"

command -v protoc >/dev/null || { echo "protoc not found (brew install protobuf)"; exit 1; }

# Python
PY_OUT="$ROOT/host/python/src/imuninn/proto"
mkdir -p "$PY_OUT"
protoc -I "$PROTO_DIR" --python_out="$PY_OUT" --pyi_out="$PY_OUT" "$PROTO"
echo "python  -> $PY_OUT"

# C++
CPP_OUT="$ROOT/host/cpp/gen"
mkdir -p "$CPP_OUT"
protoc -I "$PROTO_DIR" --cpp_out="$CPP_OUT" "$PROTO"
echo "cpp     -> $CPP_OUT"

# Swift
if command -v protoc-gen-swift >/dev/null; then
  SWIFT_OUT="$ROOT/mobile/modules/muninn-core/ios/Generated"
  mkdir -p "$SWIFT_OUT"
  protoc -I "$PROTO_DIR" --swift_out="$SWIFT_OUT" --swift_opt=Visibility=Public "$PROTO"
  echo "swift   -> $SWIFT_OUT"
else
  echo "swift   skipped (brew install swift-protobuf)"
fi

# Android: Java classes only (used from Kotlin through the builder API; the Kotlin
# DSL would need the protobuf-kotlin runtime as well).
KT_OUT="$ROOT/mobile/modules/muninn-core/android/src/main/java/generated"
mkdir -p "$KT_OUT"
protoc -I "$PROTO_DIR" --java_out="$KT_OUT" "$PROTO"
echo "android -> $KT_OUT"
