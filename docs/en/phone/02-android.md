# Android

The Android app supports **camera mode only** (Camera2 + MediaCodec H.264, IMU, health, configuration / profiles / lease); there is no ARCore pose or depth. It speaks exactly the same protocol, and `imuninn list` finds it the same way (NsdManager advertises the same service).

Camera parameters map to Camera2: manual exposure, manual white balance and manual focus need `MANUAL_SENSOR`, `MANUAL_POST_PROCESSING` and a focusable lens respectively, and fall back to locked / preset / auto when the device lacks them.

Build it like the iOS app (`npx expo run:android`).
