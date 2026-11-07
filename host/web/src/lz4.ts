// Apple Compression.framework LZ4 framing ("bv41" blocks) + the raw LZ4 block format.
// Mirrors host/python/src/imuninn/depth.py::_apple_lz4_decode.

function lz4Block(src: Uint8Array, out: Uint8Array, outPos: number, outEnd: number): number {
  let i = 0;
  let o = outPos;
  const n = src.length;
  while (i < n) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) {
      let b;
      do { b = src[i++]; lit += b; } while (b === 255);
    }
    out.set(src.subarray(i, i + lit), o);
    i += lit; o += lit;
    if (i >= n) break; // last sequence has no match
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let mlen = (token & 15) + 4;
    if ((token & 15) === 15) {
      let b;
      do { b = src[i++]; mlen += b; } while (b === 255);
    }
    let m = o - offset;
    if (m < 0 || o + mlen > outEnd) throw new Error("lz4: bad match");
    // byte-wise copy: overlapping matches are legal
    for (let k = 0; k < mlen; k++) out[o++] = out[m++];
  }
  return o;
}

export function appleLz4Decode(buf: Uint8Array): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // first pass: total decompressed size
  let total = 0;
  for (let i = 0; i + 4 <= buf.length;) {
    const magic = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    if (magic === "bv4$") break;
    if (magic === "bv41") { total += dv.getUint32(i + 4, true); i += 12 + dv.getUint32(i + 8, true); }
    else if (magic === "bv4-") { const s = dv.getUint32(i + 4, true); total += s; i += 8 + s; }
    else throw new Error(`lz4: unexpected block magic ${magic} at ${i}`);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i + 4 <= buf.length;) {
    const magic = String.fromCharCode(buf[i], buf[i + 1], buf[i + 2], buf[i + 3]);
    if (magic === "bv4$") break;
    if (magic === "bv41") {
      const dsize = dv.getUint32(i + 4, true), csize = dv.getUint32(i + 8, true);
      i += 12;
      // Apple keeps the window across blocks, so decode in place into `out` (matches may
      // reference the previous 64 KiB of output).
      const end = lz4Block(buf.subarray(i, i + csize), out, o, o + dsize);
      if (end !== o + dsize) throw new Error("lz4: size mismatch");
      o = end; i += csize;
    } else {
      const s = dv.getUint32(i + 4, true);
      i += 8;
      out.set(buf.subarray(i, i + s), o);
      o += s; i += s;
    }
  }
  return out;
}
