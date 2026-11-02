/**
 * Mask maths for background removal, on plain arrays (no canvas, no DOM),
 * so it runs in a worker and in tests alike.
 */

/** Bilinear resize of a one-channel image. */
export function upsample(src: Float32Array, sw: number, sh: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / h - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / w - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * w + x] = top * (1 - ty) + bottom * ty;
    }
  }
  return out;
}

/** Mean over a (2r+1)² window, clipped at the borders. O(n) whatever r. */
export function box(src: Float32Array, w: number, h: number, r: number, out: Float32Array, tmp: Float32Array) {
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += src[o + x];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      if (x + r + 1 < w) s += src[o + x + r + 1];
      if (x - r >= 0) s -= src[o + x - r];
    }
  }
  const col = new Float64Array(w);
  for (let y = 0; y <= Math.min(r, h - 1); y++) for (let x = 0; x < w; x++) col[x] += tmp[y * w + x];
  for (let y = 0; y < h; y++) {
    const count = Math.min(h - 1, y + r) - Math.max(0, y - r) + 1;
    for (let x = 0; x < w; x++) out[y * w + x] = col[x] / count;
    if (y + r + 1 < h) for (let x = 0; x < w; x++) col[x] += tmp[(y + r + 1) * w + x];
    if (y - r >= 0) for (let x = 0; x < w; x++) col[x] -= tmp[(y - r) * w + x];
  }
}

/**
 * Grey-guided filter (He, Sun, Tang 2013): where `p` changes, the output
 * follows the changes of the guide `I`; elsewhere it stays flat.
 * `p` is overwritten; the result is a new array.
 */
export function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const tmp = new Float32Array(n);
  const mI = new Float32Array(n);
  const mP = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  box(I, w, h, r, mI, tmp);
  box(p, w, h, r, mP, tmp);
  for (let i = 0; i < n; i++) A[i] = I[i] * I[i];
  box(A, w, h, r, B, tmp); // mean of I²
  for (let i = 0; i < n; i++) A[i] = I[i] * p[i];
  box(A, w, h, r, p, tmp); // mean of I·p
  for (let i = 0; i < n; i++) {
    const a = (p[i] - mI[i] * mP[i]) / (B[i] - mI[i] * mI[i] + eps);
    A[i] = a;
    B[i] = mP[i] - a * mI[i];
  }
  box(A, w, h, r, mP, tmp); // mean of a
  box(B, w, h, r, p, tmp); // mean of b
  for (let i = 0; i < n; i++) A[i] = mP[i] * I[i] + p[i];
  return A;
}

/** Network input (IS-Net): RGB planes from RGBA, divided by the brightest value, centred on 0.5. */
export function isnetInput(rgba: Uint8ClampedArray, n: number): Float32Array {
  let max = 1;
  for (let i = 0; i < rgba.length; i++) if ((i & 3) !== 3 && rgba[i] > max) max = rgba[i];
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    input[i] = rgba[i * 4] / max - 0.5;
    input[n + i] = rgba[i * 4 + 1] / max - 0.5;
    input[2 * n + i] = rgba[i * 4 + 2] / max - 0.5;
  }
  return input;
}

/** Network output stretched to 0-1, and the share of the picture it covers. */
export function normalise(pred: Float32Array, n: number): { mask: Float32Array; coverage: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) (lo = Math.min(lo, pred[i])), (hi = Math.max(hi, pred[i]));
  const span = hi - lo || 1;
  const mask = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += mask[i] = (pred[i] - lo) / span;
  return { mask, coverage: sum / n };
}

/** Luma of RGBA pixels, 0-1: the guide for the edges. */
export function luma(rgba: Uint8ClampedArray, n: number): Float32Array {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return g;
}

/** Coarse 1024² mask → alpha at w × h, snapped to the edges of the guide, haze clipped. */
export function refineMask(coarse: Float32Array, size: number, guide: Float32Array, w: number, h: number, clip: readonly [number, number] = [0.04, 0.96]): Float32Array {
  const p = upsample(coarse, size, size, w, h);
  const r = Math.max(2, Math.round(Math.max(w, h) / 320));
  const q = guidedFilter(guide, p, w, h, r, 5e-4);
  const [lo, hi] = clip;
  for (let i = 0; i < q.length; i++) q[i] = Math.min(1, Math.max(0, (q[i] - lo) / (hi - lo)));
  return q;
}
