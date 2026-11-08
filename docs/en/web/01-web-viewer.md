# Web viewer

See the phone's data in a browser: video, depth, pose trajectory, IMU plots, thermal state and battery. The page is static, connects straight to the phone (protocol v5) and can also replay an MCAP file offline.

## Online page

**<https://imuninn-webviewer.projects.weijinqi.com>**

- **Safari (macOS / iPadOS / iOS) works as is**: open the page, type the address shown in the app's Server card (e.g. `10.0.0.5`), press Connect.
- **Chrome / Edge cannot reach the phone** from a public page: their security policy blocks LAN addresses and withholds the video decoder. Use one of the two ways below.
- Offline MCAP replay works in every browser.

## Chrome / Edge: serve it locally

```bash
pip install imuninn
imuninn web                 # serves the same page at http://localhost:7430 and opens it
```

Opened from `localhost` the browser treats the page as trusted: video decodes and connections to the phone on the LAN are allowed. The page still talks to the phone directly; this computer only serves the files.

:::caution[Chrome / Edge alternative: a browser flag]
Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`, enter `http://imuninn-webviewer.projects.weijinqi.com`, restart the browser, then open the online page over **http://**. The site is then treated as a secure origin; connecting to the phone shows a one-time "allow local network access" prompt. This is a developer setting, only for your own machine.
:::

## Why

- Chrome / Edge Local Network Access: an http page from a public origin may not reach `10.x` / `192.168.x` addresses; an https page may ask for permission, but then mixed-content rules forbid `ws://`.
- WebCodecs (H.264 decoding) exists only in secure contexts: `https://` and `http://localhost`.
- Safari has neither restriction today; Firefox connects but has no WebCodecs, so the video panel stays empty.

## How the direct connection works

Browsers cannot open raw TCP / UDP, so protocol v5 gives the phone a browser path: the page performs the same control-WebSocket handshake (port 7420) as the Python client with `Hello.data_transport = WEBSOCKET`, then opens a second WebSocket to the same port, sends `"IMDATA01"` + the 4-byte `client_id`, and receives every stream as binary `DataMessage` frames. The data format is identical to Python / C++ (the page parses the same `imuninn.proto` at runtime with protobufjs).

## Browser requirements

- Video: WebCodecs (`VideoDecoder` fed with H.264 Annex‑B): Chrome / Edge 94+ (localhost or https), Safari 16.4+.
- Depth: Apple block LZ4, decoded by a small JS decoder; MCAP zstd chunks via `fzstd`.
- Pose is drawn as a top-down X–Z trajectory with heading (ARKit frame, Y up).

## Build it yourself

```bash
cd host/web && npm install && npm run build      # -> host/web/dist
imuninn web --static host/web/dist
```
