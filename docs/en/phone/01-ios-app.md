# iOS app

Get it on the App Store: <https://apps.apple.com/app/id6832343388>.

The phone is the server: when the app opens it advertises the Bonjour service `_imuninn._tcp` and listens on 7420 (control) and 7422 (data); PCs connect to it. Keep the app in the foreground: iOS stops the camera for apps in the background.

## Screen

| Area | Content |
| --- | --- |
| Status pill (top) | server state and number of connected PCs; tap it for the list of connected PCs (subscribed streams, drops, who is in control). While a PC controls the phone it shows "xxx in control · take over"; tap to take control back |
| Preview | camera image (with ARKit rendering in AR mode) in a fixed 3:4 frame; "Small / Large" and "Full screen" at the bottom right |
| Capture | start / stop capture, preview on / off, black screen; tracking state, live pose / IMU / video / depth rates, encoder drops |
| Server | Bonjour name (editable; empty = device name; changing it restarts the server and connected PCs must reconnect), the address of every interface (`en0` is Wi‑Fi; with USB there is also a `169.254.x.x` direct-link address; rows are selectable for copying) |
| Configuration | every parameter, the same configuration the PCs edit; shows the current profile or "unsaved profile"; numbers can be typed, parameters marked ↻ restart the session |
| Profiles | save / apply / long-press to delete profiles stored on the phone |
| Settings | appearance (system / light / dark), language (system / 中文 / English) |

## Black screen

For long pushes tap "Black screen": after 5 s without touches the screen goes pure black at minimum brightness while capture continues; tap the screen to wake it for a while. On OLED the display then draws almost nothing and the phone runs noticeably cooler. `dev.set("session.black_screen", True)` on the PC is the same switch.

## Common situations

- "Network error" at the top: iOS reclaims the listening sockets while the app is in the background; the app rebuilds them within 2 s of coming back. If it persists, check the Wi‑Fi.
- Changing mode, lens, resolution or depth on/off restarts capture for about a second; that is expected.
- Allow the "Local Network" permission on first launch, otherwise PCs cannot discover the phone.
