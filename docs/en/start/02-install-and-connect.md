# Install and connect

Install the app on the phone and a receiver on the PC, then put both on the same LAN or connect them with a USB cable.

## Phone

There is no App Store release yet, so build the app with Xcode and install it on your phone (see the developer docs: [Setup](../dev/01-setup.md), [Build and run](../dev/02-build-run.md)). For Android see [Phone apps · Android](../phone/02-android.md). Then:

1. Open iMuninn. The "Server" card at the top shows **listening** and the phone's addresses (`en0` is Wi‑Fi; with a USB cable plugged in there is an extra `169.254.x.x` direct-link address).
2. Allow the "Local Network" permission the first time it asks.
3. Keep the app in the foreground: iOS stops the camera for apps in the background.

## PC

```bash
pip install "imuninn[all]"              # or just imuninn; extras are listed under Python package · Install
imuninn list                            # phones on the LAN / over USB
```

```
iPhone                         10.0.0.23:7420         proto v5  (also 169.254.83.240)
```

Three ways to connect:

```bash
imuninn watch --start                   # the first phone found
imuninn watch iPhone --start            # by Bonjour name
imuninn watch 10.0.0.23:7420 --start    # by address (when the Wi‑Fi blocks mDNS, use the address shown on the phone)
```

Nothing to install? Use the [Web viewer](../web/01-web-viewer.md) and type the phone's address in the browser.

## Wi‑Fi or USB

| | Wi‑Fi | USB direct link |
| --- | --- | --- |
| Round trip | ≈ 8 ms | ≈ 1.5 ms |
| Bandwidth | depends on the router; 4 Mbps video is fine | plenty |
| How | same LAN | plug in the cable, use the 169.254 address |

`imuninn list` puts the Wi‑Fi address first; to go over USB pass the 169.254 address to `connect()` or to the command line.

## Several PCs

Several PCs can connect to one phone at the same time, each subscribing to the streams it needs. Parameters are global: when one PC changes something every client receives `ConfigChanged`, and the phone shows that it is being controlled remotely.
