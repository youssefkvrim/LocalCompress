import { strFromU8, strToU8 } from 'fflate';
import {
  MIN_SAVING,
  RefusedError,
  ScratchWriter,
  formatBytes,
  outputNameFor,
  type EngineContext,
  type EngineOutput,
} from '@localcompress/core';
import { optimizeRaster, probe, proveRaster, type RasterFormat } from '@localcompress/image';
import { readZip, rewriteZip, verifyZip, canTranscode, readLocal, inflateEntry, opfsSpill, Budget, DEFAULT_LIMITS, type ZipEntry } from '@localcompress/archive';

const MIME: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  docm: 'application/vnd.ms-word.document.macroEnabled.12',
};

/** Parts that must never be touched, not even losslessly re-deflated. */
const VERBATIM = [
  /(^|\/)vbaProject\.bin$/i,
  /(^|\/)vbaData\.xml$/i,
  /\/embeddings\//i,
  /\/activeX\//i,
  /^_xmlsignatures\//i,
  /\/customUI\//i,
];
const MEDIA = /^(ppt|xl|word)\/media\/[^/]+\.(png|jpe?g)$/i;

const rasterOf = (name: string): RasterFormat | null => (/\.png$/i.test(name) ? 'png' : /\.jpe?g$/i.test(name) ? 'jpeg' : null);

/** Blank identifying fields in docProps (keeps the XML structurally identical). */
function scrubCore(xml: string): string {
  return xml.replace(/<(dc:creator|cp:lastModifiedBy|cp:keywords|dc:description|cp:category|cp:contentStatus)>[\s\S]*?<\/\1>/g, '<$1></$1>');
}
function scrubApp(xml: string): string {
  return xml.replace(/<(Company|Manager|HyperlinkBase)>[\s\S]*?<\/\1>/g, '<$1></$1>');
}

/** Resolve an OPC relationship target against the part that owns the .rels. */
function resolveTarget(relsPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  // "_rels/.rels" belongs to the package root; "ppt/slides/_rels/slide1.xml.rels" to ppt/slides/slide1.xml.
  const owner = relsPath.replace(/_rels\/([^/]*)\.rels$/, '$1');
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  const parts = (base + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
}

async function readEntryText(blob: Blob, e: ZipEntry): Promise<string> {
  const loc = await readLocal(blob, e);
  const parts: Uint8Array[] = [];
  for await (const c of inflateEntry(blob, e, loc.dataStart, new Budget(DEFAULT_LIMITS))) parts.push(c.slice());
  return strFromU8(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()));
}

/** Prove the package still hangs together: content types + every internal relationship target exists. */
async function verifyPackage(blob: Blob): Promise<{ ok: boolean; rels: number; broken: string[]; contentTypes: boolean }> {
  const archive = await readZip(blob);
  const names = new Set(archive.entries.map((e) => e.name));
  const ct = archive.entries.find((e) => e.name === '[Content_Types].xml');
  const contentTypes = !!ct && /<Types[\s>]/.test(await readEntryText(blob, ct));
  const broken: string[] = [];
  let rels = 0;
  for (const e of archive.entries) {
    if (!e.name.endsWith('.rels') || !canTranscode(e)) continue;
    if (e.uncompressedSize > 16 * 1024 * 1024) {
      broken.push(`${e.name}: oversized relationship part`);
      continue;
    }
    const xml = await readEntryText(blob, e);
    for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1];
      if (/TargetMode\s*=\s*"External"/.test(attrs)) continue;
      const target = /Target\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      if (!target) continue;
      rels++;
      const resolved = resolveTarget(e.name, target.replace(/&amp;/g, '&'));
      if (!names.has(resolved) && !names.has(resolved + '/')) broken.push(`${e.name} → ${target}`);
    }
  }
  return { ok: contentTypes && broken.length === 0, rels, broken, contentTypes };
}

export async function compressOffice(ctx: EngineContext): Promise<EngineOutput> {
  const { file, params, settings, detection } = ctx;
  if (detection.macroEnabled && !settings.allowMacros) {
    throw new RefusedError('Macro-enabled document — disabled by policy. Enable “Allow macro-enabled formats” in Settings to process (VBA is kept byte-for-byte).', 'macro');
  }

  ctx.stage('analyze');
  const archive = await readZip(file);
  const signed = archive.entries.some((e) => e.name.startsWith('_xmlsignatures/'));
  const media = archive.entries.filter((e) => MEDIA.test(e.name) && canTranscode(e));
  const mediaBytes = media.reduce((n, e) => n + e.compressedSize, 0);
  const details = [
    `${archive.entries.length} parts · ${media.length} raster images (${formatBytes(mediaBytes)})`,
  ];
  if (detection.macroEnabled) details.push('VBA project preserved byte-for-byte');
  if (signed) details.push('Digitally signed — lossless mode only (content of every part is unchanged)');
  const unsafe = archive.entries.filter((e) => e.unsafePath).length;
  if (unsafe) throw new RefusedError(`Package contains ${unsafe} unsafe part paths — refusing to process`, 'unsafe-paths');

  ctx.stage('strategy');
  const optimiseMedia = !signed;
  const scrub = settings.stripMetadata && !signed;
  ctx.plan({
    engine: 'OOXML repack · MozJPEG · OxiPNG',
    summary: [
      optimiseMedia ? `Images Q${params.imageQuality}${params.documentMaxDimension ? ` ≤ ${params.documentMaxDimension}px` : ''}, same format & name` : 'Lossless only',
      'XML re-deflated',
      scrub ? 'author fields cleared' : null,
    ]
      .filter(Boolean)
      .join(' · '),
  });

  ctx.stage('candidate');
  let imagesChanged = 0;
  let imageBefore = 0;
  let imageAfter = 0;
  const writer = await ScratchWriter.create(ctx.jobId, `output.${detection.format}`);
  let res;
  try {
    res = await rewriteZip(file, archive, writer, {
      makeSpill: opfsSpill(ctx.jobId),
      onProgress: (f, name) => ctx.progress(f, name),
      classify: (e) => {
        if (VERBATIM.some((r) => r.test(e.name))) return 'verbatim';
        if (optimiseMedia && MEDIA.test(e.name)) return 'transform';
        if (scrub && (e.name === 'docProps/core.xml' || e.name === 'docProps/app.xml')) return 'transform';
        return 'recompress';
      },
      transform: async (e, data) => {
        if (e.name === 'docProps/core.xml') return strToU8(scrubCore(strFromU8(data)));
        if (e.name === 'docProps/app.xml') return strToU8(scrubApp(strFromU8(data)));
        const fmt = rasterOf(e.name);
        if (!fmt || !probe(data, fmt)) return null;
        try {
          // Same format, same part name: relationships and content types stay valid.
          const out = await optimizeRaster(data, fmt, { ...params, maxDimension: params.documentMaxDimension }, settings.stripMetadata, fmt);
          if (!out || out.format !== fmt || out.bytes.length > data.length * 0.98) return null;
          // Every replaced image carries its own proof; any doubt keeps the original bytes.
          const proofs = await proveRaster(data, fmt, out);
          if (!proofs.every((p) => p.ok)) {
            ctx.log(`${e.name} kept: validation failed`);
            return null;
          }
          imagesChanged++;
          imageBefore += data.length;
          imageAfter += out.bytes.length;
          return out.bytes;
        } catch (err) {
          ctx.log(`${e.name} kept: ${(err as Error).message}`);
          return null;
        }
      },
    });
  } finally {
    writer.close();
  }

  ctx.stage('validate');
  const out = await writer.file();
  const v = await verifyZip(out, archive, res.changed, (p) => ctx.progress(p * 0.7, 'Verifying CRC-32'));
  ctx.check('Package reopens', true, `${v.entries} parts`);
  ctx.check('CRC-32 verified', v.problems.length === 0, `${v.verified} parts`);
  ctx.check('Part names & order preserved', v.structureMatches, v.problems.slice(0, 2).join('; ') || undefined);
  const pkg = await verifyPackage(out);
  ctx.check('[Content_Types].xml', pkg.contentTypes);
  ctx.check('Relationships resolve', pkg.broken.length === 0, pkg.broken.length ? pkg.broken.slice(0, 2).join('; ') : `${pkg.rels} internal targets`);
  if (detection.macroEnabled) {
    const vba = res.reports.filter((r) => /vbaProject\.bin$/i.test(r.name));
    ctx.check('VBA project untouched', vba.every((r) => r.action === 'verbatim'), `${vba.length} part(s) copied verbatim`);
  }

  ctx.stage('compare');
  details.push(`${imagesChanged} images optimised · ${formatBytes(imageBefore)} → ${formatBytes(imageAfter)}`);
  details.push('Formulas, slides, macros, embedded objects and relationships unchanged');
  if (scrub) details.push('Author / last-modified-by / company fields cleared');
  if (out.size > file.size * (1 - MIN_SAVING)) {
    await writer.remove();
    return { status: 'not-worth-it', reason: 'already-optimal', engine: 'OOXML repack', summary: 'The package is already compact.', details, outputSize: out.size };
  }
  return {
    status: 'optimized',
    outputPath: writer.path,
    outputSize: out.size,
    outputName: outputNameFor(file.name, detection.format),
    mime: MIME[detection.format] ?? 'application/octet-stream',
    lossless: params.lossless,
    engine: params.lossless ? 'OOXML repack · lossless JPEG · OxiPNG · libdeflate' : 'OOXML repack · MozJPEG · OxiPNG · libdeflate',
    summary: `${imagesChanged} of ${media.length} images optimised`,
    details,
  };
}
