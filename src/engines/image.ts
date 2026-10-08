/**
 * Images. JPEG and PNG are optimised; WebP / AVIF / GIF / HEIC are left
 * alone (already compact, or animated).
 *
 * Lossless always:  JPEG → optimal Huffman + progressive (jpeg.ts)
 *                   PNG  → OxiPNG, then IDAT re-deflated with libdeflate
 * Lossy on request: JPEG → MozJPEG, downscaled to a maximum edge; kept only
 *                   when it is at least 10 % smaller than the lossless result.
 */
import { optimizeJpegLossless, sameCoefficients } from './jpeg';
import { crc32 } from '../lib/crc32';
import { inflate, zlibBest } from '../lib/deflate';
import { saveBytes } from '../lib/scratch';
import { Skip, type Check, type Engine, type Mode } from '../lib/types';

type Format = 'jpeg' | 'png';
const MIME: Record<Format, string> = { jpeg: 'image/jpeg', png: 'image/png' };

/** Above this, decoding could exhaust memory ("pixel bomb"). */
const MAX_PIXELS = 120_000_000;
const LOSSY: Record<Mode, { quality: number; maxEdge: number } | null> = {
  lossless: null,
  balanced: { quality: 78, maxEdge: 3840 },
  compact: { quality: 62, maxEdge: 2560 },
};

export interface Optimized {
  bytes: Uint8Array;
  lossless: boolean;
  engine: string;
  checks: Check[];
}

/** Best candidate for one image, with the checks that prove it. Null when nothing beats the original. */
export async function optimizeImage(bytes: Uint8Array, format: Format, mode: Mode, strip: boolean, maxEdge?: number): Promise<Optimized | null> {
  const size = dimensions(bytes, format);
  if (!size) throw new Skip('unreadable');
  if (size.animated) throw new Skip('animated');
  if (size.width * size.height > MAX_PIXELS) throw new Skip('too-large');

  let best: Omit<Optimized, 'checks'> | null = null;
  if (format === 'jpeg') {
    const r = optimizeJpegLossless(bytes, { stripMetadata: strip });
    if (r) best = { bytes: r.bytes, lossless: true, engine: `JPEG ${r.mode}, optimal Huffman` };
  } else {
    best = { bytes: await optimizePng(bytes, strip), lossless: true, engine: 'OxiPNG + libdeflate' };
  }

  const lossy = LOSSY[mode];
  if (lossy && format === 'jpeg') {
    const jpeg = await mozjpeg(bytes, lossy.quality, maxEdge ?? lossy.maxEdge);
    if (!best || jpeg.bytes.length < best.bytes.length * 0.9) best = { bytes: jpeg.bytes, lossless: false, engine: 'MozJPEG' };
  }
  if (!best || best.bytes.length >= bytes.length) return null;

  const checks: Check[] = [{ label: 'Output decodes', ok: await decodes(best.bytes, format) }];
  if (best.lossless && format === 'jpeg') checks.push({ label: 'Coefficients identical', ok: sameCoefficients(bytes, best.bytes) });
  if (best.lossless && format === 'png') checks.push({ label: 'Pixels identical', ok: await samePixels(bytes, best.bytes) });
  return { ...best, checks };
}

export const imageEngine: Engine = async (job) => {
  const bytes = new Uint8Array(await job.file.arrayBuffer());
  const format = (bytes[0] === 0xff ? 'jpeg' : bytes[0] === 0x89 ? 'png' : null) as Format | null;
  if (!format) throw new Skip('already-optimal');
  const r = await optimizeImage(bytes, format, job.mode, job.stripMetadata);
  if (!r) throw new Skip('already-optimal');
  for (const c of r.checks) job.check(c.label, c.ok);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  return { ...(await saveBytes(job.id, `out.${ext}`, r.bytes)), ext, engine: r.engine, lossless: r.lossless };
};

// ── Header probing ────────────────────────────────────────────────────────

function dimensions(b: Uint8Array, format: Format): { width: number; height: number; animated: boolean } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (format === 'png') return { width: v.getUint32(16), height: v.getUint32(20), animated: chunkTypes(b).includes('acTL') };
    for (let p = 2; p + 9 < b.length; ) {
      if (b[p] !== 0xff) return null;
      const m = b[p + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        p += m === 0xff ? 1 : 2;
        continue;
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: v.getUint16(p + 5), width: v.getUint16(p + 7), animated: false };
      p += 2 + v.getUint16(p + 2);
    }
  } catch {
    /* truncated */
  }
  return null;
}

function chunkTypes(png: Uint8Array): string[] {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const types: string[] = [];
  for (let p = 8; p + 12 <= png.length; p += 12 + v.getUint32(p)) types.push(String.fromCharCode(...png.subarray(p + 4, p + 8)));
  return types;
}

// ── PNG ───────────────────────────────────────────────────────────────────

const PNG_METADATA = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

async function optimizePng(png: Uint8Array, strip: boolean): Promise<Uint8Array> {
  let best = png;
  try {
    // Single-threaded build: no nested worker pool (which escaped the egress
    // guard and hung in recent Chromium). optimize_alpha=false keeps the colour
    // of fully transparent pixels: strictly lossless.
    const oxipng = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
    await oxipng.default();
    const ox = oxipng.optimise(png, 3, false, false);
    if (ox.length < best.length) best = ox;
  } catch {
    /* keep the original */
  }
  const z = await recompressIdat(best, strip);
  return z && z.length < best.length ? z : best;
}

/**
 * Re-deflate the image data (IDAT) with libdeflate, the role Zopfli plays
 * in `oxipng -Z`. Same filtered bytes, so the same pixels by construction.
 */
export async function recompressIdat(png: Uint8Array, strip: boolean): Promise<Uint8Array | null> {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const before: Uint8Array[] = [];
  const after: Uint8Array[] = [];
  const idat: Uint8Array[] = [];
  for (let p = 8; p + 12 <= png.length; ) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (p + 12 + len > png.length) return null;
    if (type === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len));
    else if (!(strip && PNG_METADATA.has(type))) (idat.length ? after : before).push(png.subarray(p, p + 12 + len));
    p += 12 + len;
  }
  if (!idat.length) return null;
  const compressed = idat.reduce((n, d) => n + d.length, 0);
  let raw: Uint8Array;
  try {
    raw = await inflate(cat(idat), 'deflate', 256 * 1024 * 1024);
  } catch {
    return null;
  }
  const repacked = zlibBest(raw);
  const packed = repacked.length < compressed ? repacked : cat(idat); // the IDAT chunks join into one zlib stream
  const chunk = new Uint8Array(12 + packed.length);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, packed.length);
  chunk.set([73, 68, 65, 84], 4); // "IDAT"
  chunk.set(packed, 8);
  cv.setUint32(8 + packed.length, crc32(chunk.subarray(4, 8 + packed.length)));
  return cat([png.subarray(0, 8), ...before, chunk, ...after]);
}

const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
};

// ── Lossy JPEG ────────────────────────────────────────────────────────────

async function mozjpeg(bytes: Uint8Array, quality: number, maxEdge: number) {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME.jpeg }), { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { bytes: await encodeJpeg(ctx.getImageData(0, 0, w, h), quality, false), width: w, height: h };
}

export async function encodeJpeg(img: ImageData, quality: number, gray: boolean): Promise<Uint8Array> {
  const { default: encode } = await import('@jsquash/jpeg/encode.js');
  // color_space: 1 = grayscale, 3 = YCbCr
  return new Uint8Array(await encode(img, { quality, progressive: true, optimize_coding: true, color_space: gray ? 1 : 3, chroma_quality: quality }));
}

// ── Proofs ────────────────────────────────────────────────────────────────

async function decodes(bytes: Uint8Array, format: Format): Promise<boolean> {
  try {
    (await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[format] }))).close();
    return true;
  } catch {
    return false;
  }
}

/** Pixel-exact comparison with the browser's decoder, in strips to bound memory. */
async function samePixels(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  const opts: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' };
  const [x, y] = await Promise.all([a, b].map((d) => createImageBitmap(new Blob([d as BlobPart], { type: MIME.png }), opts)));
  try {
    if (x.width !== y.width || x.height !== y.height) return false;
    const rows = Math.max(1, Math.floor((8 << 20) / (4 * x.width)));
    const [cx, cy] = [x, y].map(() => new OffscreenCanvas(x.width, rows).getContext('2d', { willReadFrequently: true })!);
    for (let top = 0; top < x.height; top += rows) {
      const h = Math.min(rows, x.height - top);
      const [dx, dy] = ([[cx, x], [cy, y]] as const).map(([c, bmp]) => {
        c.clearRect(0, 0, x.width, rows);
        c.drawImage(bmp, 0, top, x.width, h, 0, 0, x.width, h);
        return c.getImageData(0, 0, x.width, h).data;
      });
      for (let i = 0; i < dx.length; i++) if (dx[i] !== dy[i]) return false;
    }
    return true;
  } finally {
    x.close();
    y.close();
  }
}
