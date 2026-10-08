import { createCrc32 } from '@localcompress/core/hash';
import { BEST_MAX, deflateBest } from '@localcompress/core/deflate';
import { DEFAULT_LIMITS, ZipError, canTranscode, readLocal, type ZipArchive, type ZipEntry, type ZipLimits } from './zip-read';
import { Budget, Deflater, Staging, inflateEntry, type Spill } from './streams';
import { localHeader, writeCentralDirectory, type Out, type WrittenEntry } from './zip-write';

export type EntryPolicy = 'verbatim' | 'recompress' | 'transform';

export interface RewriteOptions {
  limits?: ZipLimits;
  /** Decide how to treat each entry. Defaults to lossless recompression. */
  classify?: (e: ZipEntry) => EntryPolicy;
  /** Content transform for `transform` entries. Return null to keep bytes as-is. */
  transform?: (e: ZipEntry, data: Uint8Array) => Promise<Uint8Array | null>;
  /** Entries larger than this are never transformed in memory. */
  maxTransformBytes?: number;
  /** Large staged entries spill to disk (OPFS) instead of RAM. */
  makeSpill?: () => Promise<Spill>;
  onProgress?: (fraction: number, label: string) => void;
  /** Cooperative cancellation. */
  signal?: { aborted: boolean };
}

export interface EntryReport {
  name: string;
  action: 'verbatim' | 'recompressed' | 'transformed' | 'unchanged';
  before: number;
  after: number;
}

export interface RewriteResult {
  written: WrittenEntry[];
  reports: EntryReport[];
  /** Indices of entries whose uncompressed content changed (transform). */
  changed: Set<number>;
}

const SPILL_AT = 64 * 1024 * 1024;
const COPY_STEP = 8 * 1024 * 1024;

/**
 * Re-encode a ZIP archive into `out`, entry by entry, keeping names,
 * attributes, timestamps, comments, extra fields and order. Each entry
 * independently keeps whichever is smaller: the original bytes or the
 * new encoding. CRCs of the input are verified while streaming.
 */
export async function rewriteZip(blob: Blob, archive: ZipArchive, out: Out, opts: RewriteOptions = {}): Promise<RewriteResult> {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const budget = new Budget(limits, blob.size);
  const written: WrittenEntry[] = [];
  const reports: EntryReport[] = [];
  const changed = new Set<number>();
  const total = archive.entries.reduce((n, e) => n + e.compressedSize, 0) || 1;
  let done = 0;

  const copyVerbatim = async (e: ZipEntry, recordEnd: number, report: EntryReport['action'] = 'verbatim') => {
    const localOffset = out.position;
    for (let at = e.localOffset; at < recordEnd; at += COPY_STEP) {
      out.write(new Uint8Array(await blob.slice(at, Math.min(recordEnd, at + COPY_STEP)).arrayBuffer()));
    }
    written.push({
      source: e,
      method: e.method,
      flags: e.flags,
      crc: e.crc,
      compressedSize: e.compressedSize,
      uncompressedSize: e.uncompressedSize,
      localOffset,
      versionNeeded: e.versionNeeded,
    });
    reports.push({ name: e.name, action: report, before: e.compressedSize, after: e.compressedSize });
  };

  const writeNew = (e: ZipEntry, localExtra: Uint8Array, method: number, crc: number, usize: number, csize: number, body: (w: (d: Uint8Array) => void) => void) => {
    const flags = e.flags & 0x0800; // keep UTF-8 name flag; no data descriptor
    const localOffset = out.position;
    const h = localHeader(e, localExtra, { method, flags, crc, compressedSize: csize, uncompressedSize: usize });
    out.write(h.bytes);
    body((d) => out.write(d));
    written.push({ source: e, method, flags, crc, compressedSize: csize, uncompressedSize: usize, localOffset, versionNeeded: h.versionNeeded });
  };

  for (const e of archive.entries) {
    if (opts.signal?.aborted) throw new ZipError('Cancelled');
    opts.onProgress?.(done / total, e.name);
    const loc = await readLocal(blob, e);
    let policy: EntryPolicy = canTranscode(e) ? (opts.classify?.(e) ?? 'recompress') : 'verbatim';
    if (policy === 'transform' && e.uncompressedSize > (opts.maxTransformBytes ?? 256 * 1024 * 1024)) policy = 'recompress';

    if (policy === 'verbatim') {
      await copyVerbatim(e, loc.recordEnd);
    } else if (policy === 'recompress' && e.uncompressedSize <= BEST_MAX) {
      // Whole entry in memory (≤ 128 MB): near-optimal libdeflate.
      const crc = await createCrc32();
      const parts: Uint8Array[] = [];
      for await (const chunk of inflateEntry(blob, e, loc.dataStart, budget)) crc.update(chunk), parts.push(chunk.slice());
      if (opts.signal?.aborted) throw new ZipError('Cancelled');
      if (crc.digest() !== e.crc) throw new ZipError(`CRC mismatch in input entry "${e.name}" — the archive is corrupt`);
      const raw = joinParts(parts, e.uncompressedSize);
      const packed = deflateBest(raw);
      if (packed.length < e.compressedSize) {
        writeNew(e, loc.localExtra, 8, e.crc, e.uncompressedSize, packed.length, (w) => w(packed));
        reports.push({ name: e.name, action: 'recompressed', before: e.compressedSize, after: packed.length });
      } else {
        await copyVerbatim(e, loc.recordEnd, 'unchanged');
      }
    } else if (policy === 'recompress') {
      // Very large entry: streaming, bounded memory, spills to disk.
      const crc = await createCrc32();
      const staging = new Staging(SPILL_AT, opts.makeSpill);
      const mode = e.method === 0 ? 'fast' : 'max';
      const deflater = new Deflater(mode, (d) => staging.push(d));
      try {
        for await (const chunk of inflateEntry(blob, e, loc.dataStart, budget)) {
          crc.update(chunk);
          await deflater.push(chunk);
          if (opts.signal?.aborted) throw new ZipError('Cancelled');
        }
        await deflater.finish();
        if (crc.digest() !== e.crc) throw new ZipError(`CRC mismatch in input entry "${e.name}" — the archive is corrupt`);
        if (staging.size < e.compressedSize) {
          writeNew(e, loc.localExtra, 8, e.crc, e.uncompressedSize, staging.size, (w) => staging.drain(w));
          reports.push({ name: e.name, action: 'recompressed', before: e.compressedSize, after: staging.size });
        } else {
          await copyVerbatim(e, loc.recordEnd, 'unchanged');
        }
      } finally {
        await staging.dispose();
      }
    } else {
      const parts: Uint8Array[] = [];
      const crc = await createCrc32();
      for await (const chunk of inflateEntry(blob, e, loc.dataStart, budget)) crc.update(chunk), parts.push(chunk.slice());
      if (crc.digest() !== e.crc) throw new ZipError(`CRC mismatch in input entry "${e.name}" — the archive is corrupt`);
      const original = joinParts(parts, e.uncompressedSize);
      const next = (await opts.transform!(e, original)) ?? original;
      const isChanged = next !== original;
      const deflated = deflateBest(next);
      const useStore = next.length <= deflated.length;
      const csize = useStore ? next.length : deflated.length;
      if (!isChanged && csize >= e.compressedSize) {
        await copyVerbatim(e, loc.recordEnd, 'unchanged');
      } else {
        const ncrc = isChanged ? await crcOf(next) : e.crc;
        writeNew(e, loc.localExtra, useStore ? 0 : 8, ncrc, next.length, csize, (w) => w(useStore ? next : deflated));
        if (isChanged) changed.add(e.index);
        reports.push({ name: e.name, action: isChanged ? 'transformed' : 'recompressed', before: e.compressedSize, after: csize });
      }
    }
    done += e.compressedSize;
  }

  writeCentralDirectory(out, written, archive.comment);
  opts.onProgress?.(1, '');
  return { written, reports, changed };
}

function joinParts(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

async function crcOf(d: Uint8Array): Promise<number> {
  const c = await createCrc32();
  c.update(d);
  return c.digest();
}
