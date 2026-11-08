// 3D pose view on a 2D canvas: orbit camera (drag), zoom (wheel), ground grid, axes,
// trajectory and the phone's camera frustum from the pose quaternion. ARKit world: Y up.

type V3 = [number, number, number];
const cssVar = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function rotate(q: { x: number; y: number; z: number; w: number }, v: V3): V3 {
  const { x, y, z, w } = q;
  const [vx, vy, vz] = v;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const cx = y * vz - z * vy, cy = z * vx - x * vz, cz = x * vy - y * vx;
  const dx = y * cz - z * cy, dy = z * cx - x * cz, dz = x * cy - y * cx;
  return [vx + 2 * (w * cx + dx), vy + 2 * (w * cy + dy), vz + 2 * (w * cz + dz)];
}

export class Pose3D {
  private pts: number[] = [];               // x,y,z triples
  private last: { p: V3; q: { x: number; y: number; z: number; w: number } } | null = null;
  private ctx: CanvasRenderingContext2D;
  private yaw = -0.6; private pitch = 0.45; private dist = 0;   // 0 = auto
  private center: V3 = [0, 0, 0];
  private dragging: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private max = 30000) {
    this.ctx = canvas.getContext("2d")!;
    canvas.addEventListener("mousedown", (e) => { this.dragging = { x: e.clientX, y: e.clientY }; });
    window.addEventListener("mouseup", () => { this.dragging = null; });
    window.addEventListener("mousemove", (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.dragging.x) * 0.01;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + (e.clientY - this.dragging.y) * 0.01));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const d = this.dist || this.autoDist();
      this.dist = Math.max(0.3, Math.min(200, d * (e.deltaY > 0 ? 1.15 : 0.87)));
    }, { passive: false });
    canvas.addEventListener("dblclick", () => { this.dist = 0; });
    canvas.style.cursor = "grab";
  }

  push(p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number; w: number }): void {
    this.pts.push(p.x, p.y, p.z);
    if (this.pts.length > this.max * 3) this.pts.splice(0, 3000);
    this.last = { p: [p.x, p.y, p.z], q };
  }
  clear(): void { this.pts = []; this.last = null; this.dist = 0; }

  private bounds(): { min: V3; max: V3 } {
    const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pts.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = this.pts[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v;
    }
    if (!isFinite(min[0])) return { min: [-1, -1, -1], max: [1, 1, 1] };
    return { min, max };
  }
  private autoDist(): number {
    const { min, max } = this.bounds();
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
    return span * 1.8;
  }

  draw(): void {
    const c = this.canvas, ctx = this.ctx;
    const w = c.clientWidth | 0, h = c.clientHeight | 0;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    ctx.clearRect(0, 0, w, h);
    const { min, max } = this.bounds();
    this.center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const dist = this.dist || this.autoDist();
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const f = Math.min(w, h) * 1.1;
    const project = (p: V3): [number, number, number] => {
      const x = p[0] - this.center[0], y = p[1] - this.center[1], z = p[2] - this.center[2];
      // yaw around Y, then pitch around X, camera at +Z looking at the origin
      const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
      const y2 = cp * y - sp * z1, z2 = sp * y + cp * z1;
      const depth = dist - z2;
      const s = f / Math.max(0.1, depth);
      return [w / 2 + x1 * s, h / 2 - y2 * s, depth];
    };
    const line = (a: V3, b: V3, color: string, width = 1) => {
      const pa = project(a), pb = project(b);
      if (pa[2] <= 0.1 || pb[2] <= 0.1) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
    };
    // ground grid at the lowest point, 1 m cells
    const gridColor = cssVar("--im-border", "#333");
    const gy = Math.floor(min[1] * 10) / 10 - 0.05;
    const half = Math.max(2, Math.ceil(Math.max(max[0] - min[0], max[2] - min[2]) / 2) + 1);
    const gx0 = Math.round(this.center[0]), gz0 = Math.round(this.center[2]);
    for (let i = -half; i <= half; i++) {
      line([gx0 + i, gy, gz0 - half], [gx0 + i, gy, gz0 + half], gridColor);
      line([gx0 - half, gy, gz0 + i], [gx0 + half, gy, gz0 + i], gridColor);
    }
    // axes at the first pose (world origin = ARKit session start)
    line([0, 0, 0], [0.3, 0, 0], "#ef5350", 2); line([0, 0, 0], [0, 0.3, 0], "#66bb6a", 2); line([0, 0, 0], [0, 0, 0.3], "#42a5f5", 2);
    // trajectory
    if (this.pts.length >= 6) {
      ctx.strokeStyle = cssVar("--im-accent", "#4fc3f7"); ctx.lineWidth = 1.5; ctx.beginPath();
      const step = Math.max(1, Math.floor(this.pts.length / 3 / 4000));
      let first = true;
      for (let i = 0; i < this.pts.length; i += 3 * step) {
        const p = project([this.pts[i], this.pts[i + 1], this.pts[i + 2]]);
        if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    // camera frustum (ARKit camera looks -Z, up +Y, right +X), 20 cm deep
    if (this.last) {
      const { p, q } = this.last;
      const d = 0.2, hw = 0.13, hh = 0.1;
      const corners: V3[] = [[-hw, -hh, -d], [hw, -hh, -d], [hw, hh, -d], [-hw, hh, -d]].map((v) => {
        const r = rotate(q, v as V3); return [p[0] + r[0], p[1] + r[1], p[2] + r[2]] as V3;
      });
      const col = cssVar("--im-warn", "#ffb300");
      for (let i = 0; i < 4; i++) { line(p, corners[i], col, 1.5); line(corners[i], corners[(i + 1) % 4], col, 1.5); }
      const up = rotate(q, [0, hh * 1.4, -d]);
      line(corners[2], [p[0] + up[0], p[1] + up[1], p[2] + up[2]], col, 1.5);
      line(corners[3], [p[0] + up[0], p[1] + up[1], p[2] + up[2]], col, 1.5);
      const pp = project(p);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pp[0], pp[1], 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = cssVar("--im-muted", "#aaa"); ctx.font = "11px system-ui";
    ctx.fillText(`${(this.pts.length / 3).toLocaleString()} pts · ${dist.toFixed(1)} m`, 6, 13);
  }
}
