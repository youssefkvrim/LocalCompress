import { unzlibSync } from 'fflate';
import { zlibBest } from '@localcompress/core/deflate';
import { pngChunkTypes, type RasterFormat } from './probe';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const t = Uint8Array.from(type, (ch) => ch.charCodeAt(0));
  out.set(t, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

const METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
/** Raw IDAT payloads above this are left as produced by OxiPNG. */
const MAX_IDAT_RAW = 256 * 1024 * 1024;

/**
 * Re-compress the IDAT stream with libdeflate's near-optimal level
 * (the role Zopfli plays in `oxipng -Z`), keeping OxiPNG's filter choice.
 * Pixels are untouched by construction: same filtered bytes, better DEFLATE.
 */
export function recompressPngIdat(png: Uint8Array, stripMetadata: boolean): Uint8Array | null {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const before: Uint8Array[] = [];
  const after: Uint8Array[] = [];
  const idat: Uint8Array[] = [];
  let seenIdat = false;
  for (let p = 8; p + 12 <= png.length; ) {
    const len = v.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (p + 12 + len > png.length) return null;
    const whole = png.subarray(p, p + 12 + len);
    if (type === 'IDAT') {
      idat.push(png.subarray(p + 8, p + 8 + len));
      seenIdat = true;
    } else if (!(stripMetadata && METADATA_CHUNKS.has(type))) (seenIdat ? after : before).push(whole);
    p += 12 + len;
    if (type === 'IEND') break;
  }
  if (!idat.length) return null;
  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const d of idat) joined.set(d, o), (o += d.length);
  let raw: Uint8Array;
  try {
    raw = unzlibSync(joined);
  } catch {
    return null;
  }
  if (raw.length > MAX_IDAT_RAW) return null;
  const packed = zlibBest(raw);
  if (packed.length >= total) return null;
  const parts = [png.subarray(0, 8), ...before, chunk('IDAT', packed), ...after];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** Strictly lossless PNG: OxiPNG (no alpha tricks) then libdeflate IDAT. */
export async function optimizePngLossless(png: Uint8Array, level: number, stripMetadata: boolean): Promise<Uint8Array> {
  const { default: optimise } = await import('@jsquash/oxipng/optimise.js');
  let best = png;
  try {
    // optimiseAlpha=false: colours of fully transparent pixels stay bit-exact.
    const ox = new Uint8Array(await optimise(png.slice().buffer, { level, interlace: false, optimiseAlpha: false }));
    if (ox.length < best.length) best = ox;
  } catch {
    /* fall through with the original */
  }
  const z = recompressPngIdat(best, stripMetadata);
  if (z && z.length < best.length) best = z;
  if (stripMetadata && best === png && pngChunkTypes(png).some((t) => METADATA_CHUNKS.has(t))) {
    best = recompressPngIdat(png, true) ?? png;
  }
  return best;
}

const MIME: Record<RasterFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

/**
 * Pixel-exact comparison with the browser's decoder, in horizontal strips
 * so very large images do not need two full RGBA copies in JS memory.
 */
export async function samePixels(a: Uint8Array, fa: RasterFormat, b: Uint8Array, fb: RasterFormat): Promise<boolean> {
  const opts: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' };
  const [x, y] = await Promise.all([
    createImageBitmap(new Blob([a as BlobPart], { type: MIME[fa] }), opts),
    createImageBitmap(new Blob([b as BlobPart], { type: MIME[fb] }), opts),
  ]);
  try {
    if (x.width !== y.width || x.height !== y.height) return false;
    const strip = Math.max(1, Math.floor((8 * 1024 * 1024) / (4 * x.width)));
    const cx = new OffscreenCanvas(x.width, strip).getContext('2d', { willReadFrequently: true })!;
    const cy = new OffscreenCanvas(x.width, strip).getContext('2d', { willReadFrequently: true })!;
    for (let top = 0; top < x.height; top += strip) {
      const h = Math.min(strip, x.height - top);
      cx.clearRect(0, 0, x.width, strip);
      cy.clearRect(0, 0, x.width, strip);
      cx.drawImage(x, 0, top, x.width, h, 0, 0, x.width, h);
      cy.drawImage(y, 0, top, x.width, h, 0, 0, x.width, h);
      const dx = cx.getImageData(0, 0, x.width, h).data;
      const dy = cy.getImageData(0, 0, x.width, h).data;
      for (let i = 0; i < dx.length; i++) if (dx[i] !== dy[i]) return false;
    }
    return true;
  } finally {
    x.close();
    y.close();
  }
}
