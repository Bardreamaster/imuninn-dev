# iMuninn Web Viewer

Static browser viewer for iMuninn phone data: H.264 video (WebCodecs), LiDAR depth, pose
trajectory, IMU plots and device health — live through the `imuninn web` relay, or offline
by dropping an MCAP recording onto the page. User docs: `docs/user/06-Web查看器.md`.

```bash
npm install
npm run build        # -> dist/, served by `imuninn web`
npm run dev          # Vite dev server on :5173 (set the ws:// URL to the relay, e.g. ws://localhost:7430/ws)
```

Layout: `src/proto.ts` parses `protocol/imuninn.proto` at runtime (protobufjs), `video.ts`
(WebCodecs), `lz4.ts` + `depth.ts` (Apple block LZ4), `mcap.ts` (`@mcap/core`), `live.ts`
(relay WebSocket), `plots.ts`, `main.ts` (UI).
