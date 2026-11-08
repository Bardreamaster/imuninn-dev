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
