/**
 * Lossless ZIP recompression, also used for Office documents.
 *
 * Each entry keeps whichever is smaller: its original bytes or a new
 * libdeflate encoding. Entries are only ever streamed, never extracted.
 */
import { BEST_MAX, deflateBest, join } from '../lib/deflate';
import { crc32 } from '../lib/crc32';
import { Writer } from '../lib/scratch';
import { Budget, ZipWriter, inflateEntry, readLocal, readZip, type Archive, type Entry, type Sink } from '../lib/zip';
import type { Engine } from '../lib/types';

/** Payloads that are already compressed: recompressing them is wasted time. */
const COMPRESSED = /\.(jpe?g|png|gif|webp|avif|heic|mp[34]|m4[av]|mov|mkv|webm|aac|ogg|opus|flac|zip|7z|rar|gz|bz2|xz|zst|docx|xlsx|pptx|pdf)$/i;

export interface RewriteOptions {
  /** 'copy' = byte-for-byte, 'pack' = recompress, 'transform' = change the content. */
  policy?: (e: Entry) => 'copy' | 'pack' | 'transform';
  transform?: (e: Entry, data: Uint8Array) => Promise<Uint8Array | null>;
  progress?: (fraction: number) => void;
}

/** Rewrite `file` into `out`. Returns the indices of entries whose content changed. */
export async function rewrite(file: Blob, archive: Archive, out: Sink, opts: RewriteOptions = {}): Promise<Set<number>> {
  const zip = new ZipWriter(out);
  const budget = new Budget(file.size);
  const changed = new Set<number>();
  const total = archive.entries.reduce((n, e) => n + e.csize, 0) || 1;
  let done = 0;

  for (const e of archive.entries) {
    opts.progress?.(done / total);
    done += e.csize;
    const local = await readLocal(file, e);
    const policy = e.readable ? (opts.policy?.(e) ?? 'pack') : 'copy';

    if (policy === 'copy' || (e.usize > BEST_MAX && (e.method === 8 || COMPRESSED.test(e.name)))) {
      await zip.copy(file, e, local.end);
      continue;
    }
    if (e.usize > BEST_MAX) {
      // Very large stored entry: stream it through the browser's compressor.
      await zip.stream(e, local.extra, inflateEntry(file, e, local.start, budget));
      continue;
    }

    const parts: Uint8Array[] = [];
    for await (const c of inflateEntry(file, e, local.start, budget)) parts.push(c.slice());
    const original = join(parts, e.usize);
    const content = (policy === 'transform' && (await opts.transform?.(e, original))) || original;
    const isNew = content !== original;
    const packed = deflateBest(content);
    const [method, data] = packed.length < content.length ? [8, packed] : [0, content];

    if (!isNew && data.length >= e.csize) await zip.copy(file, e, local.end);
    else {
      zip.put(e, local.extra, method, isNew ? crc32(content) : e.crc, content.length, data);
      if (isNew) changed.add(e.index);
    }
  }
  zip.finish(archive.comment);
  opts.progress?.(1);
  return changed;
}

/**
 * Reopen the new archive from scratch: same entries, names, attributes and
 * timestamps; unchanged content has the same CRC; every entry decompresses
 * to bytes matching its CRC. Returns the problems found.
 */
export async function verify(output: Blob, original: Archive, changed: Set<number>): Promise<string[]> {
  const problems: string[] = [];
  const archive = await readZip(output);
  if (archive.entries.length !== original.entries.length) return ['entry count differs'];
  const budget = new Budget(output.size);
  for (const e of archive.entries) {
    const o = original.entries[e.index];
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (!same(o.nameBytes, e.nameBytes) || o.external !== e.external || o.time !== e.time || o.date !== e.date) problems.push(`metadata changed: ${o.name}`);
    if (!changed.has(e.index) && (o.crc !== e.crc || o.usize !== e.usize)) problems.push(`content changed: ${o.name}`);
    if (!e.readable) continue;
    try {
      const { start } = await readLocal(output, e);
      for await (const _ of inflateEntry(output, e, start, budget));
    } catch (err) {
      problems.push((err as Error).message);
    }
  }
  return problems;
}

export const zipEngine: Engine = async (job) => {
  const archive = await readZip(job.file);
  const out = await Writer.create(job.id, 'out.zip');
  const changed = await rewrite(job.file, archive, out, { progress: (f) => job.progress(f * 0.8) });
  const file = await out.close();
  const problems = await verify(file, archive, changed);
  job.check('Archive reopens', true);
  job.check('Structure preserved', !problems.some((p) => p.includes('changed') || p.includes('count')));
  job.check('CRC-32 verified', problems.length === 0);
  return { file, path: out.path, ext: 'zip', engine: 'DEFLATE (libdeflate 12)', lossless: true };
};
