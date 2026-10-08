import {
  MIN_SAVING,
  ScratchWriter,
  formatBytes,
  formatPercent,
  outputNameFor,
  type EngineContext,
  type EngineOutput,
} from '@localcompress/core';
import { readZip } from './zip-read';
import { analyzeZip, methodName } from './estimate';
import { rewriteZip } from './rewrite';
import { verifyZip } from './verify';
import type { Spill } from './streams';

/** Below this projected saving, a generic archive is left alone. */
const ZIP_THRESHOLD = 0.02;

let spillSeq = 0;
export const opfsSpill = (jobId: string) => async (): Promise<Spill> => {
  const w = await ScratchWriter.create(jobId, `spill-${spillSeq++}.bin`);
  return { write: (d) => w.write(d), read: (at, len) => w.read(at, len), close: () => w.remove() };
};

export async function compressZip(ctx: EngineContext): Promise<EngineOutput> {
  const { file } = ctx;
  ctx.stage('analyze');
  const archive = await readZip(file);
  const methods = Object.entries(
    archive.entries.reduce<Record<string, number>>((m, e) => ((m[methodName(e.method)] = (m[methodName(e.method)] ?? 0) + 1), m), {}),
  )
    .map(([k, v]) => `${k} ×${v}`)
    .join(', ');
  ctx.log(`${archive.entries.length} entries · ${methods}${archive.zip64 ? ' · ZIP64' : ''}`);
  const a = await analyzeZip(file, archive, 24 * 1024 * 1024, (p) => ctx.progress(p, 'Sampling entries'));
  const details = [
    `${a.entries} entries — ${methods}`,
    `Uncompressed payload ${formatBytes(a.uncompressedTotal)}`,
    `Sampled ${formatBytes(a.sampledBytes)} to project the result`,
  ];
  if (a.encrypted) details.push(`${a.encrypted} encrypted entries copied byte-for-byte`);
  if (a.unsafePaths) details.push(`⚠ ${a.unsafePaths} entries have unsafe paths (absolute or "..") — preserved, never extracted`);

  ctx.stage('strategy');
  const projected = 1 - a.estimate / file.size;
  ctx.plan({ engine: 'DEFLATE · per-entry best-of', summary: 'Lossless re-deflate; names, attributes and order preserved', estimate: a.estimate });
  if (projected < ZIP_THRESHOLD) {
    return {
      status: 'not-worth-it',
      reason: 'archive-compressed',
      engine: 'DEFLATE · analysis only',
      summary: `Projected saving ${formatPercent(Math.max(0, projected))} — not worth recompressing. Entries are already compressed.`,
      details,
      outputSize: a.estimate,
    };
  }

  ctx.stage('candidate');
  const writer = await ScratchWriter.create(ctx.jobId, 'output.zip');
  let res;
  try {
    res = await rewriteZip(file, archive, writer, {
      makeSpill: opfsSpill(ctx.jobId),
      onProgress: (f, name) => ctx.progress(f, name),
    });
  } finally {
    writer.close();
  }

  ctx.stage('validate');
  const out = await writer.file();
  const v = await verifyZip(out, archive, res.changed, (p) => ctx.progress(p, 'Verifying CRC-32'));
  ctx.check('Archive reopens', true, `${v.entries} entries`);
  ctx.check('Structure preserved', v.structureMatches, v.structureMatches ? 'names, attributes, timestamps, order' : v.problems.slice(0, 3).join('; '));
  ctx.check('CRC-32 verified', v.problems.length === 0, `${v.verified} decompressed and checked${v.opaque ? `, ${v.opaque} opaque copied verbatim` : ''}`);

  ctx.stage('compare');
  const recompressed = res.reports.filter((r) => r.action === 'recompressed').length;
  details.push(`${recompressed} entries recompressed, ${res.reports.length - recompressed} kept as-is (already optimal)`);
  if (out.size > file.size * (1 - MIN_SAVING)) {
    await writer.remove();
    return { status: 'not-worth-it', reason: 'archive-compressed', engine: 'DEFLATE', summary: 'Recompression did not meaningfully reduce the archive.', details, outputSize: out.size };
  }
  return {
    status: 'optimized',
    outputPath: writer.path,
    outputSize: out.size,
    outputName: outputNameFor(file.name, 'zip'),
    mime: 'application/zip',
    lossless: true,
    engine: 'DEFLATE (libdeflate 12)',
    summary: 'Lossless — every entry decompresses to identical bytes',
    details,
  };
}
