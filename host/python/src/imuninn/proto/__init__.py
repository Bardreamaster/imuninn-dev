"""Generated protobuf bindings. Run tools/gen-proto.sh to populate."""

try:
    from .imuninn_pb2 import *  # noqa: F401,F403
except ImportError as e:  # pragma: no cover
    raise ImportError(
        "imuninn protobuf bindings missing; run tools/gen-proto.sh from the repo root"
    ) from e
