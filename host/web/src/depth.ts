import { decompress as zstdDecompress } from "fzstd";
import { appleLz4Decode } from "./lz4";
import type { DepthFrame } from "./proto";

const COMPRESSION_LZ4 = 1, COMPRESSION_ZSTD = 2;

export function decodeDepth(f: DepthFrame): { depth: Uint16Array; conf: Uint8Array | null } {
  let raw: Uint8Array = f.depth_mm;
  let rawC: Uint8Array | null = f.confidence.length ? f.confidence : null;
  if (f.compression === COMPRESSION_LZ4) {
    raw = appleLz4Decode(raw);
    if (rawC) rawC = appleLz4Decode(rawC);
  } else if (f.compression === COMPRESSION_ZSTD) {
    raw = zstdDecompress(raw);
    if (rawC) rawC = zstdDecompress(rawC);
  }
  const n = f.width * f.height;
  // uint16 LE; copy to an aligned buffer
  const aligned = new Uint8Array(n * 2);
  aligned.set(raw.subarray(0, n * 2));
  return { depth: new Uint16Array(aligned.buffer), conf: rawC };
}

// Turbo-like colormap LUT (256 entries) built from a few anchor colours.
const anchors = [
  [48, 18, 59], [70, 107, 227], [40, 187, 236], [26, 228, 182], [122, 251, 110],
  [204, 234, 50], [254, 176, 25], [239, 96, 5], [179, 25, 3], [122, 4, 3],
];
const LUT = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = (i / 255) * (anchors.length - 1);
  const a = Math.floor(t), b = Math.min(a + 1, anchors.length - 1), f = t - a;
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = anchors[a][c] + (anchors[b][c] - anchors[a][c]) * f;
}

/** Auto range: ~98th percentile of valid depth, rounded up to 0.5 m, so close scenes are not all blue. */
export function depthRangeMm(depth: Uint16Array): number {
  const hist = new Uint32Array(64); // 0..16 m in 250 mm bins
  let n = 0;
  for (let i = 0; i < depth.length; i += 4) { const d = depth[i]; if (d) { hist[Math.min(63, d >> 8)]++; n++; } }
  if (!n) return 5000;
  let acc = 0;
  for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= n * 0.98) return Math.max(500, Math.ceil(((b + 1) * 256) / 500) * 500); }
  return 5000;
}

/** Colourise depth (mm) into RGBA; invalid (0) is black, low confidence is dimmed. */
export function depthToImage(depth: Uint16Array, conf: Uint8Array | null, w: number, h: number, maxMm = 5000): ImageData {
  const img = new ImageData(w, h);
  const px = img.data;
  for (let i = 0; i < w * h; i++) {
    const d = depth[i];
    const o = i * 4;
    if (d === 0) { px[o + 3] = 255; continue; }
    const k = Math.min(255, Math.round((d / maxMm) * 255)) * 3;
    const dim = conf && conf[i] === 0 ? 0.4 : 1;
    px[o] = LUT[k] * dim; px[o + 1] = LUT[k + 1] * dim; px[o + 2] = LUT[k + 2] * dim; px[o + 3] = 255;
  }
  return img;
}
