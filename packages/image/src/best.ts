import type { Params } from '@localcompress/core';
import { ImageRefused, encodeImage, validateImage } from './encode';
import { optimizeJpegLossless, sameCoefficients } from './jpeg-lossless';
import { optimizePngLossless, samePixels } from './lossless';
import { MAX_PIXELS, probe, type RasterFormat } from './probe';

export interface RasterResult {
  bytes: Uint8Array;
  format: RasterFormat;
  width: number;
  height: number;
  engine: string;
  lossless: boolean;
  resized: boolean;
}

/**
 * Best valid candidate for one raster image.
 * - Lossless candidates always (JPEG: Huffman/progressive re-encode; PNG: OxiPNG + libdeflate).
 * - Lossy candidates only outside "lossless" mode, and kept only if clearly smaller.
 */
export async function optimizeRaster(bytes: Uint8Array, format: RasterFormat, params: Params, stripMetadata: boolean, target: RasterFormat = format): Promise<RasterResult | null> {
  const info = probe(bytes, format);
  if (!info || !info.width || !info.height) throw new ImageRefused('Unreadable image header');
  if (info.animated) throw new ImageRefused('Animated image — kept as-is');
  if (info.width * info.height > MAX_PIXELS) throw new ImageRefused('Image above the pixel safety limit');
  const base = { width: info.width, height: info.height, resized: false };

  let lossless: RasterResult | null = null;
  if (format === 'jpeg') {
    const r = optimizeJpegLossless(bytes, { stripMetadata });
    if (r) lossless = { ...base, bytes: r.bytes, format: 'jpeg', engine: `Lossless JPEG (${r.mode}, optimal Huffman)`, lossless: true };
  } else if (format === 'png') {
    const r = await optimizePngLossless(bytes, params.pngLevel, stripMetadata);
    lossless = { ...base, bytes: r, format: 'png', engine: 'OxiPNG + libdeflate', lossless: true };
  }
  if (params.lossless) return lossless;

  let lossy: RasterResult | null = null;
  const pngKeep = format === 'png' && target === 'png';
  const needsResize = params.maxDimension > 0 && Math.max(info.width, info.height) > params.maxDimension;
  if (!pngKeep || needsResize) {
    const r = await encodeImage({ bytes, format, target, quality: params.imageQuality, maxDimension: params.maxDimension, pngLevel: params.pngLevel });
    lossy = { bytes: r.bytes, format: r.format, width: r.width, height: r.height, engine: r.engine, lossless: false, resized: r.resized };
  }
  if (!lossy) return lossless;
  if (!lossless) return lossy;
  // A generation of loss must buy a real gain.
  return lossy.bytes.length < lossless.bytes.length * 0.9 ? lossy : lossless;
}

export interface Proof {
  ok: boolean;
  label: string;
  detail?: string;
}

/** Validation appropriate to the candidate: equality proofs for lossless, decode checks for lossy. */
export async function proveRaster(original: Uint8Array, format: RasterFormat, out: RasterResult): Promise<Proof[]> {
  const v = await validateImage(out.bytes, out.format, out.width, out.height);
  const proofs: Proof[] = [
    { ok: v.decodes, label: 'Output decodes', detail: v.detail },
    { ok: v.dimensionsOk, label: 'Dimensions verified', detail: `${out.width}×${out.height}` },
    { ok: v.formatOk, label: 'Format verified', detail: out.format.toUpperCase() },
  ];
  if (out.lossless && out.format === 'jpeg') proofs.push({ ok: sameCoefficients(original, out.bytes), label: 'Coefficients identical' });
  if (out.lossless && out.format === 'png') proofs.push({ ok: await samePixels(original, format, out.bytes, out.format), label: 'Pixels identical' });
  return proofs;
}
