// Live source: WebSocket to the `imuninn web` relay (or, later, straight to a phone that
// sends DataMessage frames over its control WebSocket).
//   text frames  = JSON control (both directions)
//   binary frames = DataMessage protobuf (relay -> browser)
import { decodeDataMessage, type Body } from "./proto";

export interface Welcome {
  type: "welcome";
  mode: "live" | "replay";
  device: { device_name?: string; model?: string; platform?: number; has_lidar?: boolean };
  streams: { stream_id: string; kind: number }[];
  subscribed: string[];
  depth_enabled?: boolean;
}

export class LiveSource {
  private ws: WebSocket | null = null;
  onBody: ((b: Body) => void) | null = null;
  onWelcome: ((w: Welcome) => void) | null = null;
  onStatus: ((s: string) => void) | null = null;
  onClose: (() => void) | null = null;

  connect(url: string): void {
    this.close();
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.onStatus?.(`connecting ${url}`);
    ws.onopen = () => this.onStatus?.("connected");
    ws.onerror = () => this.onStatus?.("websocket error");
    ws.onclose = (e) => { this.onStatus?.(`closed (${e.code})`); this.onClose?.(); };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const j = JSON.parse(ev.data);
        if (j.type === "welcome") this.onWelcome?.(j as Welcome);
        else if (j.type === "status") this.onStatus?.(j.message);
        else if (j.type === "error") this.onStatus?.(`error: ${j.message}`);
      } else {
        const body = decodeDataMessage(new Uint8Array(ev.data));
        if (body) this.onBody?.(body);
      }
    };
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  subscribe(streams: string[], unsubscribe = false): void { this.send({ type: "subscribe", streams, unsubscribe }); }
  start(): void { this.send({ type: "start" }); }
  stop(): void { this.send({ type: "stop" }); }
  set(key: string, value: unknown): void { this.send({ type: "set", key, value }); }

  get open(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.close(); }
  }
}
