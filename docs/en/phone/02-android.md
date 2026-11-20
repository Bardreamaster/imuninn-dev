# Android

The Android app has the same features as the iOS app and speaks exactly the same protocol; `imuninn list` finds it the same way (NsdManager advertises the same service). For now it is built from source (`npx expo run:android`); it is not on Google Play yet.

Differences from iOS:

- **AR mode** uses ARCore, so the phone must support ARCore and have Google Play Services for AR installed. Phones without it offer camera mode only.
- **Depth** comes from the ARCore Depth API (estimated from motion on most phones; there is no LiDAR). After you turn it on, move the phone for a second or two before the first frame arrives; range and accuracy are below LiDAR. `depth.smoothed` is on by default (a filled, filtered depth image without confidence); turn it off for sparse raw depth with confidence.
- **Camera controls in AR mode** are limited to focus (auto / fixed) and the torch; ARCore manages the rest. In camera mode every control is available.
- **Camera parameters** map to Camera2: manual exposure, manual white balance and manual focus need `MANUAL_SENSOR`, `MANUAL_POST_PROCESSING` and a focusable lens respectively, and fall back to locked / preset / auto when the device lacks them.
- **Entering or leaving the full-screen preview, or turning the preview off, in camera mode** interrupts the video briefly (Camera2 has to rebuild the capture session). IMU and audio are not affected.
