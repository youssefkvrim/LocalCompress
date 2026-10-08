/**
 * Office documents (PPTX / XLSX / DOCX, and their macro variants on request).
 *
 * They are ZIP packages: images in the media folder are optimised in place
 * (same format, same part name, so every relationship stays valid), XML is
 * re-deflated, author fields are cleared. Macros, embedded objects, ActiveX
 * and signatures are copied byte for byte. Sensitivity labels
 * (docProps/custom.xml, docMetadata/) are never touched.
 */
import { optimizeImage } from './image';
import { rewrite, verify } from './zip';
import { join } from '../lib/deflate';
import { office } from '../lib/detect';
import { Writer } from '../lib/scratch';
import { Budget, inflateEntry, readLocal, readZip, type Entry } from '../lib/zip';
import { Skip, type Engine } from '../lib/types';

const VERBATIM = /(^|\/)(vbaProject\.bin|vbaData\.xml)$|\/(embeddings|activeX|customUI)\/|^_xmlsignatures\//i;
const MEDIA = /^(ppt|xl|word)\/media\/[^/]+\.(png|jpe?g)$/i;
/** Documents are viewed at screen size: images larger than this are downscaled in lossy modes. */
const MAX_EDGE = { balanced: 2400, compact: 1600 } as const;

export const officeEngine: Engine = async (job) => {
  const archive = await readZip(job.file);
  const kind = office(archive.entries.map((e) => e.name))!;
  if (kind.macro && !job.allowMacros) throw new Skip('macro');
  if (archive.entries.some((e) => e.unsafe)) throw new Skip('unsafe-paths');
  // A signed package must keep every part identical: re-deflate only.
  const signed = archive.entries.some((e) => e.name.startsWith('_xmlsignatures/'));
  const scrub = job.stripMetadata && !signed;
  const maxEdge = job.mode === 'lossless' ? undefined : MAX_EDGE[job.mode];

  const out = await Writer.create(job.id, `out.${kind.ext}`);
  const changed = await rewrite(job.file, archive, out, {
    progress: (f) => job.progress(f * 0.8),
    policy: (e) => (VERBATIM.test(e.name) ? 'copy' : (!signed && MEDIA.test(e.name)) || (scrub && /^docProps\/(core|app)\.xml$/.test(e.name)) ? 'transform' : 'pack'),
    transform: async (e, data) => {
      if (e.name === 'docProps/core.xml') return clear(data, ['dc:creator', 'cp:lastModifiedBy', 'cp:keywords', 'dc:description', 'cp:category']);
      if (e.name === 'docProps/app.xml') return clear(data, ['Company', 'Manager', 'HyperlinkBase']);
      const format = /\.png$/i.test(e.name) ? 'png' : 'jpeg';
      try {
        const r = await optimizeImage(data, format, job.mode, job.stripMetadata, maxEdge);
        // Each replaced image carries its own proof; any doubt keeps the original.
        return r && r.checks.every((c) => c.ok) ? r.bytes : null;
      } catch {
        return null;
      }
    },
  });
  const file = await out.close();
  job.step('verify');

  const problems = await verify(file, archive, changed);
  job.check('Package reopens', true);
  job.check('CRC-32 verified', problems.length === 0);
  job.check('Relationships resolve', await relationshipsResolve(file));
  return { file, path: out.path, ext: kind.ext, engine: 'OOXML · JPEG · OxiPNG · libdeflate', lossless: job.mode === 'lossless' };
};

/** Empty the text of the given XML elements; the structure stays identical. */
function clear(xml: Uint8Array, tags: string[]) {
  const text = new TextDecoder().decode(xml);
  const re = new RegExp(`<(${tags.join('|')})>[\\s\\S]*?</\\1>`, 'g');
  return new TextEncoder().encode(text.replace(re, '<$1></$1>'));
}

/** Every internal relationship target must exist in the package, and content types must be declared. */
async function relationshipsResolve(file: File): Promise<boolean> {
  const archive = await readZip(file);
  const names = new Set(archive.entries.map((e) => e.name));
  if (!names.has('[Content_Types].xml')) return false;
  const budget = new Budget(file.size);
  for (const e of archive.entries) {
    if (!e.name.endsWith('.rels') || !e.readable || e.usize > 16 << 20) continue;
    const xml = await readText(file, e, budget);
    for (const [, attrs] of xml.matchAll(/<Relationship\b([^>]*)>/g)) {
      if (/TargetMode\s*=\s*"External"/.test(attrs)) continue;
      const target = /Target\s*=\s*"([^"]*)"/.exec(attrs)?.[1];
      if (target && !names.has(resolve(e.name, target.replace(/&amp;/g, '&')))) return false;
    }
  }
  return true;
}

async function readText(file: File, e: Entry, budget: Budget) {
  const { start } = await readLocal(file, e);
  const parts: Uint8Array[] = [];
  for await (const c of inflateEntry(file, e, start, budget)) parts.push(c.slice());
  return new TextDecoder().decode(join(parts));
}

/** "ppt/slides/_rels/slide1.xml.rels" + "../media/a.png" → "ppt/media/a.png" */
function resolve(relsPath: string, target: string) {
  if (target.startsWith('/')) return decodeURIComponent(target.slice(1));
  const owner = relsPath.replace(/_rels\/[^/]*\.rels$/, '');
  const out: string[] = [];
  for (const p of (owner + target).split('/')) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return decodeURIComponent(out.join('/'));
}

