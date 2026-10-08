import {
  MIN_SAVING,
  ScratchWriter,
  baseName,
  type EngineContext,
  type EngineOutput,
} from '@localcompress/core';
import { ImageRefused, estimateImage, extensionFor, mimeFor } from './encode';
import { optimizeRaster, proveRaster } from './best';
import { probe, type RasterFormat } from './probe';

/** Standalone image files (JPEG, PNG, WebP, AVIF). */
export async function compressImage(ctx: EngineContext): Promise<EngineOutput> {
  const { file, params, settings } = ctx;
  const format = ctx.detection.format as RasterFormat;
  const bytes = new Uint8Array(await file.arrayBuffer());

  ctx.stage('analyze');
  const info = probe(bytes, format);
  if (!info) throw new ImageRefused('Unreadable image header');
  const details = [`${info.width}×${info.height} px · ${ctx.detection.label}`];
  if (info.animated) return { status: 'unsupported', reason: 'animated', engine: '—', summary: 'Animated image — kept as-is.', details };
  if (params.lossless && (format === 'webp' || format === 'avif')) {
    return { status: 'not-worth-it', reason: 'already-optimal', engine: '—', summary: 'Already in a modern compressed format; no lossless gain possible.', details };
  }

  ctx.stage('strategy');
  const target: RasterFormat = params.lossless || settings.imageTarget === 'keep' ? format : settings.imageTarget;
  ctx.plan({
    engine: params.lossless ? 'Lossless' : `Q${params.imageQuality}`,
    summary: params.lossless ? 'Bit-exact pixels' : `Quality ${params.imageQuality}${params.maxDimension ? ` · ≤ ${params.maxDimension}px` : ''}`,
    estimate: params.lossless ? undefined : await estimateImage({ bytes, format, target, quality: params.imageQuality, maxDimension: params.maxDimension, pngLevel: params.pngLevel }).catch(() => undefined),
  });

  ctx.stage('candidate');
  ctx.progress(0.1, '');
  const out = await optimizeRaster(bytes, format, params, settings.stripMetadata, target);
  if (!out) return { status: 'not-worth-it', reason: 'already-optimal', engine: '—', summary: 'No better encoding found.', details };

  ctx.stage('validate');
  for (const p of await proveRaster(bytes, format, out)) ctx.check(p.label, p.ok, p.detail);

  ctx.stage('compare');
  if (out.bytes.length > file.size * (1 - MIN_SAVING)) {
    return { status: 'not-worth-it', reason: 'already-optimal', engine: out.engine, summary: 'Already well optimised.', details, outputSize: out.bytes.length };
  }
  const w = await ScratchWriter.create(ctx.jobId, `output.${extensionFor(out.format)}`);
  w.write(out.bytes);
  w.close();
  return {
    status: 'optimized',
    lossless: out.lossless,
    outputPath: w.path,
    outputSize: out.bytes.length,
    outputName: `${baseName(file.name)}.compressed.${extensionFor(out.format)}`,
    mime: mimeFor(out.format),
    engine: out.engine,
    summary: out.lossless ? 'Lossless' : `${out.format.toUpperCase()} · ${out.width}×${out.height}`,
    details,
    preview: { kind: 'image', width: out.width, height: out.height },
  };
}
