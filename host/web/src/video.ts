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

  private draw(frame: VideoFrame): void {
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
  }
}
