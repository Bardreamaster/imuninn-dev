// Tiny canvas plots: rolling multi-line chart (IMU) and a top-down trajectory (pose).
// Colours are read from the design tokens (docs/design/tokens.css) so light / dark match the page.

const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class RollingPlot {
  private series: Float32Array[];
  private head = 0;
  private filled = 0;
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement, private n: number, private cap: number, private colors: string[], private title: string, private unit: string) {
    this.series = Array.from({ length: n }, () => new Float32Array(cap));
    this.ctx = canvas.getContext("2d")!;
  }
  push(values: number[]): void {
    for (let i = 0; i < this.n; i++) this.series[i][this.head] = values[i];
    this.head = (this.head + 1) % this.cap;
    this.filled = Math.min(this.filled + 1, this.cap);
  }
  draw(): void {
    const c = this.canvas, ctx = this.ctx;
    const w = c.clientWidth | 0, h = c.clientHeight | 0;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    let lo = Infinity, hi = -Infinity;
    for (let s = 0; s < this.n; s++) for (let i = 0; i < this.filled; i++) { const v = this.series[s][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    const y = (v: number) => h - ((v - lo) / (hi - lo)) * h;
    ctx.strokeStyle = cssVar("--im-border", "#333"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
    for (let s = 0; s < this.n; s++) {
      ctx.strokeStyle = this.colors[s]; ctx.beginPath();
      for (let i = 0; i < this.filled; i++) {
        const idx = (this.head - this.filled + i + this.cap) % this.cap;
        const x = (i / (this.cap - 1)) * w;
        const v = this.series[s][idx];
        if (i === 0) ctx.moveTo(x, y(v)); else ctx.lineTo(x, y(v));
      }
      ctx.stroke();
    }
    ctx.fillStyle = cssVar("--im-muted", "#aaa"); ctx.font = "11px system-ui";
    ctx.fillText(`${this.title}  [${lo.toFixed(2)}, ${hi.toFixed(2)}] ${this.unit}`, 6, 13);
  }
}

export class TrajectoryPlot {
  private pts: number[] = []; // x, z pairs
  private ctx: CanvasRenderingContext2D;
  private last: { x: number; z: number; yaw: number } | null = null;
  constructor(private canvas: HTMLCanvasElement, private max = 20000) {
    this.ctx = canvas.getContext("2d")!;
  }
  push(x: number, z: number, yaw: number): void {
    this.pts.push(x, z);
    if (this.pts.length > this.max * 2) this.pts.splice(0, 2000);
    this.last = { x, z, yaw };
  }
  clear(): void { this.pts = []; this.last = null; }
  draw(): void {
    const c = this.canvas, ctx = this.ctx;
    const w = c.clientWidth | 0, h = c.clientHeight | 0;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    if (!this.pts.length) return;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.pts.length; i += 2) {
      const x = this.pts[i], z = this.pts[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 0.5);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const scale = (Math.min(w, h) * 0.85) / span;
    const sx = (x: number) => w / 2 + (x - cx) * scale;
    const sy = (z: number) => h / 2 + (z - cz) * scale; // +Z down on screen (ARKit camera looks -Z = "forward" = up)
    // grid every 1 m
    ctx.strokeStyle = cssVar("--im-border", "#2a2a2a"); ctx.lineWidth = 1;
    for (let gx = Math.floor(cx - span); gx <= cx + span; gx++) { ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), h); ctx.stroke(); }
    for (let gz = Math.floor(cz - span); gz <= cz + span; gz++) { ctx.beginPath(); ctx.moveTo(0, sy(gz)); ctx.lineTo(w, sy(gz)); ctx.stroke(); }
    ctx.strokeStyle = cssVar("--im-accent", "#4fc3f7"); ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < this.pts.length; i += 2) { const X = sx(this.pts[i]), Y = sy(this.pts[i + 1]); if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
    ctx.stroke();
    if (this.last) {
      const X = sx(this.last.x), Y = sy(this.last.z);
      const head = cssVar("--im-warn", "#ffb300");
      ctx.fillStyle = head; ctx.beginPath(); ctx.arc(X, Y, 4, 0, Math.PI * 2); ctx.fill();
      // heading: camera looks -Z in ARKit, rotate by yaw around Y
      ctx.strokeStyle = head; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, Y);
      ctx.lineTo(X - Math.sin(this.last.yaw) * 18, Y - Math.cos(this.last.yaw) * 18); ctx.stroke();
    }
    ctx.fillStyle = cssVar("--im-muted", "#aaa"); ctx.font = "11px system-ui";
    ctx.fillText(`grid 1 m · ${(this.pts.length / 2).toLocaleString()} pts`, 6, 13);
  }
}
