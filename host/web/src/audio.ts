// Microphone stream ("audio", protocol v6): PCM chunks -> Web Audio playback with a small
// jitter buffer, plus an RMS level for the meter. Browsers only start an AudioContext after a
// user gesture, so playback is opt-in (the card's speaker button); the meter always works.
import type { AudioChunk } from "./proto";

const S16 = 1, F32 = 2;   // AudioEncoding

/** Samples of one chunk as float32 -1..1, interleaved when channels > 1. */
export function chunkSamples(c: AudioChunk): Float32Array {
  const d = c.data;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  if (c.encoding === S16) {
    const n = d.byteLength >> 1, out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true) / 32768;
    return out;
  }
  if (c.encoding === F32) {
    const n = d.byteLength >> 2, out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true);
    return out;
  }
  return new Float32Array(0);
}

/** RMS level in dBFS, clipped to -120. */
export function levelDbfs(x: Float32Array): number {
  if (!x.length) return -120;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / x.length);
  return rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private next = 0;                 // AudioContext time where the next chunk starts
  /** Jitter buffer: how far ahead of "now" playback is scheduled. */
  bufferS = 0.12;
  underruns = 0;

  get enabled(): boolean { return this.ctx !== null && this.ctx.state === "running"; }

  /** Call from a click handler (autoplay policy). */
  async enable(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    this.next = 0;
  }

  async disable(): Promise<void> { await this.ctx?.suspend(); }

  reset(): void { this.next = 0; }

  push(c: AudioChunk, samples: Float32Array): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.gain || !c.sample_rate) return;
    const ch = Math.max(1, c.channels), frames = Math.floor(samples.length / ch);
    if (!frames) return;
    // AudioBuffer accepts any rate in 3 k..768 kHz; the context resamples to the output device.
    const buf = ctx.createBuffer(ch, frames, c.sample_rate);
    for (let k = 0; k < ch; k++) {
      const dst = buf.getChannelData(k);
      for (let i = 0; i < frames; i++) dst[i] = samples[i * ch + k];
    }
    const now = ctx.currentTime;
    if (this.next < now + 0.01) {           // starved (start, Wi-Fi burst): rebuild the buffer
      if (this.next) this.underruns++;
      this.next = now + this.bufferS;
    } else if (this.next > now + this.bufferS * 3) {
      this.next = now + this.bufferS;       // drifted too far ahead: drop latency back down
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    src.start(this.next);
    this.next += frames / c.sample_rate;
  }
}
