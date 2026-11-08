// H.264 Annex-B -> canvas via WebCodecs. Without `description` the decoder expects Annex B,
// which is exactly what the phone sends (VideoToolbox AVCC converted to start codes).
import type { VideoFrame as MnVideoFrame } from "./proto";

export function webCodecsAvailable(): boolean {
  return typeof VideoDecoder !== "undefined" && typeof EncodedVideoChunk !== "undefined";
}

/** Find the SPS in an Annex-B buffer and build the avc1.PPCCLL codec string. */
function codecFromSps(data: Uint8Array): string | null {
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      const nal = data[i + 3] & 0x1f;
      if (nal === 7 && i + 6 < data.length) {
        const hex = (b: number) => b.toString(16).padStart(2, "0");
        return `avc1.${hex(data[i + 4])}${hex(data[i + 5])}${hex(data[i + 6])}`;
      }
    }
  }
  return null;
}

export class H264Canvas {
  private decoder: VideoDecoder | null = null;
  private codec: string | null = null;
  private waitingKeyframe = true;
  private ctx: CanvasRenderingContext2D;
  decoded = 0;
  errors = 0;
  skipped = 0;
  /** Playout buffer: frames arrive in ~100 ms bursts over Wi-Fi; presenting them paced by
   *  their capture timestamps (with a small adaptive delay) removes the visible stutter. */
  private queue: VideoFrame[] = [];
  private offsetUs: number | null = null;   // performance.now()*1000 - frame.timestamp, smoothed
  private delayUs = 120_000;                // target presentation delay, adapted to jitter
  latencyMs = 0;
  onError: ((e: string) => void) | null = null;
  rotation = 0;
  /** Extra clockwise display rotation on top of the frame's rotation_deg (orientation.ts). */
  extraRotation = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  private ensure(f: MnVideoFrame): boolean {
    const codec = codecFromSps(f.data) ?? this.codec;
    if (!codec) return false;
    if (this.decoder && this.decoder.state !== "closed" && codec === this.codec) return true;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.codec = codec;
    this.decoder = new VideoDecoder({
      output: (frame) => this.draw(frame),
      error: (e) => { this.errors++; this.onError?.(`${e.name}: ${e.message}`); this.waitingKeyframe = true; },
    });
    this.decoder.configure({ codec, optimizeForLatency: true });
    return true;
  }

  push(f: MnVideoFrame): void {
    if (f.format !== 1) return; // only H.264
    if (f.keyframe) this.waitingKeyframe = false;
    if (this.waitingKeyframe) return;
    if (!this.ensure(f)) return;
    this.rotation = f.rotation_deg;
    const d = this.decoder!;
    // Never skip delta frames on queue depth: waiting for the next keyframe freezes the
    // picture for a whole keyframe interval (the "stutter every 1-2 s" on the phone).
    // Hardware decoders keep up with 1920x1440@60; only a runaway queue is reset.
    if (d.decodeQueueSize > 120) { this.reset(); this.waitingKeyframe = true; this.skipped++; return; }
    try {
      d.decode(new EncodedVideoChunk({
        type: f.keyframe ? "key" : "delta",
        timestamp: Math.round(f.header.device_time_ns / 1000),
        data: f.data,
      }));
    } catch (e) {
      this.errors++; this.waitingKeyframe = true; this.onError?.(String(e));
    }
  }

  /** Decoder output: queue for paced presentation (see present()). */
  private draw(frame: VideoFrame): void {
    const nowUs = performance.now() * 1000;
    const off = nowUs - frame.timestamp;
    if (this.offsetUs === null) this.offsetUs = off;
    else {
      // follow the minimum offset (least-delayed arrivals) so clock drift does not grow latency
      if (off < this.offsetUs) this.offsetUs = off;
      else this.offsetUs += (off - this.offsetUs) * 0.002;
      const jitter = off - this.offsetUs;          // how late this frame is vs the fastest path
      const want = Math.min(250_000, Math.max(50_000, jitter * 1.2 + 25_000));
      this.delayUs = want > this.delayUs ? want : this.delayUs + (want - this.delayUs) * 0.01;
    }
    this.queue.push(frame);
    if (this.queue.length > 90) this.queue.shift()!.close();
  }

  /** Call once per animation frame: shows the newest frame whose presentation time has come. */
  present(): void {
    if (!this.queue.length || this.offsetUs === null) return;
    const dueUs = performance.now() * 1000 - this.offsetUs - this.delayUs;
    let pick: VideoFrame | null = null;
    while (this.queue.length && this.queue[0].timestamp <= dueUs) {
      pick?.close();
      pick = this.queue.shift()!;
    }
    if (pick) { this.latencyMs = (performance.now() * 1000 - this.offsetUs - pick.timestamp) / 1000; this.paint(pick); }
  }

  private paint(frame: VideoFrame): void {
    const w = frame.displayWidth, h = frame.displayHeight;
    const rot = (this.rotation + this.extraRotation) % 360;
    const swap = rot === 90 || rot === 270;
    const cw = swap ? h : w, ch = swap ? w : h;
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(frame, -w / 2, -h / 2);
    ctx.restore();
    frame.close();
    this.decoded++;
  }

  reset(): void {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.waitingKeyframe = true;
    for (const f of this.queue) f.close();
    this.queue = [];
    this.offsetUs = null;
  }
}
