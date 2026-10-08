import { MAX_PIXELS, magicMatches, pngChunkTypes, probe, type RasterFormat } from './probe';

export interface EncodeJob {
  bytes: Uint8Array;
  format: RasterFormat;
  target: RasterFormat;
  /** 1–100 */
  quality: number;
  /** Longest edge, 0 = keep. */
  maxDimension: number;
  pngLevel: number;
}

export interface EncodeResult {
  bytes: Uint8Array;
  format: RasterFormat;
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  engine: string;
  resized: boolean;
}

export class ImageRefused extends Error {
  override name = 'ImageRefused';
  readonly reason: 'animated' | 'too-large' | 'unreadable';
  constructor(message: string) {
    super(message);
    this.reason = /animated/i.test(message) ? 'animated' : /limit|MP/.test(message) ? 'too-large' : 'unreadable';
  }
}

const MIME: Record<RasterFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
export const extensionFor = (f: RasterFormat) => (f === 'jpeg' ? 'jpg' : f);
export const mimeFor = (f: RasterFormat) => MIME[f];

export function targetSize(w: number, h: number, maxDim: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (!maxDim || long <= maxDim) return { width: w, height: h };
  const s = maxDim / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Decode with the browser's native decoder (EXIF orientation applied), into RGBA at the target size. */
export async function decodeTo(bytes: Uint8Array, format: RasterFormat, width: number, height: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[format] }), {
    imageOrientation: 'from-image',
    premultiplyAlpha: 'none',
  });
  try {
    return drawScaled(bitmap, width, height);
  } finally {
    bitmap.close();
  }
}

/** Progressive halving keeps downscales sharp without moiré. */
function drawScaled(src: ImageBitmap | OffscreenCanvas, width: number, height: number): ImageData {
  let cur: ImageBitmap | OffscreenCanvas = src;
  let cw = src.width;
  let ch = src.height;
  while (cw / 2 >= width && ch / 2 >= height) {
    const nw = Math.max(width, Math.floor(cw / 2));
    const nh = Math.max(height, Math.floor(ch / 2));
    const c = new OffscreenCanvas(nw, nh);
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh);
    cur = c;
    cw = nw;
    ch = nh;
  }
  const c = new OffscreenCanvas(width, height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, width, height);
  return g.getImageData(0, 0, width, height);
}

function hasAlpha(img: ImageData): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true;
  return false;
}

/** Codecs are loaded lazily so a PDF job never instantiates the AVIF encoder. */
const codecs = {
  jpeg: () => import('@jsquash/jpeg/encode.js'),
  webp: () => import('@jsquash/webp/encode.js'),
  avif: () => import('@jsquash/avif/encode.js'),
  png: () => import('@jsquash/oxipng/optimise.js'),
};

async function encodePixels(img: ImageData, target: RasterFormat, quality: number, pngLevel: number): Promise<{ bytes: Uint8Array; engine: string }> {
  switch (target) {
    case 'jpeg': {
      const { default: encode } = await codecs.jpeg();
      const q = Math.round(quality);
      return { bytes: new Uint8Array(await encode(img, { quality: q, progressive: true, optimize_coding: true, chroma_quality: q })), engine: 'MozJPEG' };
    }
    case 'webp': {
      const { default: encode } = await codecs.webp();
      return { bytes: new Uint8Array(await encode(img, { quality, method: 5, alpha_quality: 100 })), engine: 'libwebp' };
    }
    case 'avif': {
      const { default: encode } = await codecs.avif();
      // AVIF "quality" is perceptually harsher; shift it up a little.
      const q = Math.min(100, Math.round(quality * 0.85 + 10));
      return { bytes: new Uint8Array(await encode(img, { quality: q, speed: 7 })), engine: 'libavif (AV1)' };
    }
    case 'png': {
      const { default: optimise } = await codecs.png();
      return { bytes: new Uint8Array(await optimise(img, { level: pngLevel, interlace: false, optimiseAlpha: true })), engine: 'OxiPNG' };
    }
  }
}

/**
 * Produce one candidate. PNG → PNG without resize stays fully lossless
 * (OxiPNG on the original bytes, metadata chunks dropped).
 */
export async function encodeImage(job: EncodeJob): Promise<EncodeResult> {
  const info = probe(job.bytes, job.format);
  if (!info || !info.width || !info.height) throw new ImageRefused('Unreadable image header');
  if (info.animated) throw new ImageRefused('Animated image — kept as-is to preserve animation');
  if (info.width * info.height > MAX_PIXELS) {
    throw new ImageRefused(`Image is ${(info.width * info.height / 1e6).toFixed(0)} MP — above the ${MAX_PIXELS / 1e6} MP safety limit`);
  }
  const { width, height } = targetSize(info.width, info.height, job.maxDimension);
  const resized = width !== info.width || height !== info.height;

  if (job.format === 'png' && job.target === 'png' && !resized) {
    const { default: optimise } = await codecs.png();
    let bytes: Uint8Array = new Uint8Array(await optimise(job.bytes.slice().buffer, { level: job.pngLevel, interlace: false, optimiseAlpha: true }));
    // Guarantee metadata stripping even if the optimiser kept text chunks.
    if (pngChunkTypes(bytes).some((t) => ['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(t))) {
      const img = await decodeTo(job.bytes, 'png', width, height);
      bytes = (await encodePixels(img, 'png', 0, job.pngLevel)).bytes;
    }
    return { bytes, format: 'png', width, height, srcWidth: info.width, srcHeight: info.height, engine: 'OxiPNG (lossless)', resized };
  }

  const img = await decodeTo(job.bytes, job.format, width, height);
  let target = job.target;
  // JPEG cannot carry transparency; never silently flatten it.
  if (target === 'jpeg' && job.format !== 'jpeg' && hasAlpha(img)) target = job.format;
  const { bytes, engine } = await encodePixels(img, target, job.quality, job.pngLevel);
  return { bytes, format: target, width, height, srcWidth: info.width, srcHeight: info.height, engine, resized };
}

export interface ImageValidation {
  decodes: boolean;
  dimensionsOk: boolean;
  formatOk: boolean;
  detail: string;
}

/** Decode the generated bytes from scratch and check what we claim about them. */
export async function validateImage(bytes: Uint8Array, format: RasterFormat, width: number, height: number): Promise<ImageValidation> {
  const formatOk = magicMatches(bytes, format);
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: MIME[format] }));
    const dimensionsOk = bmp.width === width && bmp.height === height;
    const detail = `${bmp.width}×${bmp.height}`;
    bmp.close();
    return { decodes: true, dimensionsOk, formatOk, detail };
  } catch (e) {
    return { decodes: false, dimensionsOk: false, formatOk, detail: (e as Error).message };
  }
}

/**
 * Estimate the encoded size by encoding a centre crop at target scale
 * and extrapolating bytes-per-pixel. Cheap enough to run before the
 * real encode on large images.
 */
export async function estimateImage(job: EncodeJob): Promise<number | undefined> {
  const info = probe(job.bytes, job.format);
  if (!info || info.animated || info.width * info.height > MAX_PIXELS) return undefined;
  const { width, height } = targetSize(info.width, info.height, job.maxDimension);
  if (width * height < 4_000_000) return undefined;
  const bitmap = await createImageBitmap(new Blob([job.bytes as BlobPart], { type: MIME[job.format] }), { imageOrientation: 'from-image' });
  try {
    const scale = width / bitmap.width;
    const crop = 512;
    const sw = Math.min(bitmap.width, crop / scale);
    const sh = Math.min(bitmap.height, crop / scale);
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    const sample = g.getImageData(0, 0, c.width, c.height);
    const target = job.target === 'png' ? 'png' : job.target;
    const { bytes } = await encodePixels(sample, target, job.quality, Math.min(job.pngLevel, 2));
    return Math.round((bytes.length / (c.width * c.height)) * width * height);
  } finally {
    bitmap.close();
  }
}
