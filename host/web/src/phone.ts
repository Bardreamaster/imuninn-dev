// Direct source (protocol v5): the browser talks to the phone itself, exactly like the
// Python client — control WebSocket with protobuf ControlMessage, then a second WebSocket
// to the same port announced with "IMDATA01" + uint32 LE client_id, on which every
// subscribed stream arrives as binary DataMessage frames.
import protobuf from "protobufjs";
import { decodeDataMessage, T, type Body } from "./proto";

const PROTOCOL_VERSION = 5;
const TRANSPORT_WEBSOCKET = 3;
const MAGIC = new TextEncoder().encode("IMDATA01");

export interface PhoneWelcome {
  device: Record<string, unknown>;
  streams: { stream_id: string; kind: number }[];
  config: any;
  client_id: number;
}

export class PhoneSource {
  private control: WebSocket | null = null;
  private data: WebSocket | null = null;
  private nextRequest = 1;
  private pending = new Map<number, (m: any) => void>();
  onBody: ((b: Body) => void) | null = null;
  onWelcome: ((w: PhoneWelcome) => void) | null = null;
  onStatus: ((s: string) => void) | null = null;
  onConfig: ((cfg: any) => void) | null = null;
  onClose: (() => void) | null = null;

  /** `target`: "host" or "host:port" (default port 7420). */
  connect(target: string): void {
    this.close();
    const [host, port] = target.includes(":") && !target.startsWith("[") ? target.split(":") : [target, "7420"];
    const url = `ws://${host}:${port}/`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.control = ws;
    this.onStatus?.(`connecting ${url}`);
    ws.onerror = () => this.onStatus?.("websocket error (is the app open and on the same Wi-Fi?)");
    ws.onclose = (e) => { this.onStatus?.(`closed (${e.code})`); this.data?.close(); this.data = null; this.onClose?.(); };
    ws.onopen = async () => {
      try {
        const w = await this.request({ hello: { client: { name: "web-viewer", version: "0.1" }, udp_port: 0, protocol_version: PROTOCOL_VERSION, data_transport: TRANSPORT_WEBSOCKET } });
        if (!w.welcome) throw new Error(`expected welcome, got ${Object.keys(w).join(",")}`);
        const welcome = w.welcome;
        if (welcome.protocol_version !== PROTOCOL_VERSION) this.onStatus?.(`protocol mismatch: phone v${welcome.protocol_version}, page v${PROTOCOL_VERSION}`);
        this.openData(url, welcome.client_id);
        const streams = (welcome.capabilities?.streams ?? []).map((s: any) => ({ stream_id: s.stream_id, kind: s.kind }));
        this.onWelcome?.({ device: welcome.device, streams, config: welcome.capabilities?.config, client_id: welcome.client_id });
        this.subscribe(streams.map((s: { stream_id: string }) => s.stream_id));
        this.onStatus?.("connected");
      } catch (e) { this.onStatus?.(`handshake failed: ${e}`); ws.close(); }
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") return;
      const m = T.ControlMessage.toObject(T.ControlMessage.decode(new Uint8Array(ev.data)), { longs: Number, enums: Number, defaults: false });
      const cb = m.request_id ? this.pending.get(m.request_id) : undefined;
      if (cb) { this.pending.delete(m.request_id); cb(m); return; }
      if (m.config_changed) this.onConfig?.(m.config_changed.config);
      else if (m.error) this.onStatus?.(`phone error ${m.error.code}: ${m.error.message}`);
      else if (m.lease) this.onStatus?.(`lease ${["", "request", "release", "granted", "denied", "revoked"][m.lease.action] ?? m.lease.action} ${m.lease.holder ?? ""}`);
    };
  }

  private openData(url: string, clientId: number): void {
    const d = new WebSocket(url);
    d.binaryType = "arraybuffer";
    this.data = d;
    d.onopen = () => {
      const hello = new Uint8Array(MAGIC.length + 4);
      hello.set(MAGIC);
      new DataView(hello.buffer).setUint32(MAGIC.length, clientId, true);
      d.send(hello);
    };
    d.onmessage = (ev) => {
      if (typeof ev.data === "string") return;
      const body = decodeDataMessage(new Uint8Array(ev.data));
      if (body) this.onBody?.(body);
    };
    d.onclose = () => { if (this.data === d) { this.data = null; this.onStatus?.("data channel closed"); } };
  }

  private sendControl(msg: object): number {
    const id = this.nextRequest++;
    const payload = T.ControlMessage.encode(T.ControlMessage.fromObject({ request_id: id, ...msg })).finish();
    this.control?.send(payload);
    return id;
  }

  private request(msg: object, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.sendControl(msg);
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error("timeout")); }, timeoutMs);
      this.pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    });
  }

  subscribe(streams: string[], unsubscribe = false): void { this.sendControl({ subscribe: { stream_ids: streams, unsubscribe } }); }
  start(): void { this.sendControl({ session_control: { action: 1 } }); }
  stop(): void { this.sendControl({ session_control: { action: 2 } }); }

  /** Partial config update by dotted key ("depth.enabled"), like PhoneClient.set(). */
  async set(key: string, value: boolean | number | string, baseVersion: number): Promise<any> {
    const [stream, ...rest] = key.split(".");
    const param = rest.join(".");
    const v: any = typeof value === "boolean" ? { b: value } : typeof value === "number" ? (Number.isInteger(value) ? { i: value } : { f: value }) : { s: value };
    let patch: any;
    if (stream === "session") patch = { session_params: { [param]: v } };
    else if (param === "enabled") patch = { streams: [{ stream_id: stream, enabled: value as boolean }] };
    else patch = { streams: [{ stream_id: stream, params: { [param]: v } }] };
    const r = await this.request({ set_config: { base_config_version: baseVersion, patch } });
    if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
    return r.config_result;
  }

  get open(): boolean { return this.control?.readyState === WebSocket.OPEN; }

  close(): void {
    const c = this.control, d = this.data;
    this.control = null; this.data = null;
    if (c) { c.onclose = null; c.close(); }
    if (d) { d.onclose = null; d.close(); }
  }
}

// keep protobufjs' Long handling consistent with proto.ts
void protobuf;
