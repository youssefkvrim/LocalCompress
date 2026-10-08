import { DEFAULT_LIMITS, canTranscode, readLocal, type ZipArchive, type ZipEntry } from './zip-read';
import { deflateBest } from '@localcompress/core/deflate';
import { Budget, inflateEntry } from './streams';

export interface ZipAnalysis {
  entries: number;
  methods: Record<string, number>;
  encrypted: number;
  unsafePaths: number;
  compressedTotal: number;
  uncompressedTotal: number;
  /** Projected output size (central directory overhead ignored). */
  estimate: number;
  sampledBytes: number;
}

const METHOD_NAMES: Record<number, string> = { 0: 'Stored', 8: 'Deflate', 9: 'Deflate64', 12: 'BZIP2', 14: 'LZMA', 93: 'Zstandard', 95: 'XZ', 99: 'AES' };
export const methodName = (m: number) => METHOD_NAMES[m] ?? `Method ${m}`;

/** Already-compressed payloads: recompressing them is pointless. */
const INCOMPRESSIBLE = /\.(jpe?g|png|gif|webp|avif|heic|mp4|m4v|mov|mkv|webm|mp3|aac|m4a|ogg|opus|flac|zip|7z|rar|gz|bz2|xz|zst|docx|xlsx|pptx|odt|ods|odp|jar|apk|pdf)$/i;

/**
 * Predict the achievable saving by recompressing a sample of entries
 * (largest first, bounded budget) and extrapolating per category.
 */
export async function analyzeZip(blob: Blob, archive: ZipArchive, sampleBudget = 24 * 1024 * 1024, onProgress?: (f: number) => void): Promise<ZipAnalysis> {
  const methods: Record<string, number> = {};
  let encrypted = 0;
  let unsafePaths = 0;
  let compressedTotal = 0;
  let uncompressedTotal = 0;
  for (const e of archive.entries) {
    methods[methodName(e.method)] = (methods[methodName(e.method)] ?? 0) + 1;
    if (e.encrypted) encrypted++;
    if (e.unsafePath) unsafePaths++;
    compressedTotal += e.compressedSize;
    uncompressedTotal += e.uncompressedSize;
  }

  const category = (e: ZipEntry) => (!canTranscode(e) || INCOMPRESSIBLE.test(e.name) ? 'opaque' : e.method === 0 ? 'stored' : 'deflated');
  const candidates = archive.entries.filter((e) => category(e) !== 'opaque' && e.compressedSize > 0).sort((a, b) => b.compressedSize - a.compressedSize);

  const sampled = new Map<number, number>();
  const ratio: Record<string, { before: number; after: number }> = { stored: { before: 0, after: 0 }, deflated: { before: 0, after: 0 } };
  let spent = 0;
  const budget = new Budget(DEFAULT_LIMITS, blob.size);
  const PREFIX = 8 * 1024 * 1024;
  // Mix big and small entries so the sample is representative.
  const order = interleave(candidates);
  for (const e of order) {
    if (spent >= sampleBudget) break;
    // Large entries: compress a prefix of the uncompressed stream and extrapolate.
    const take = e.compressedSize > sampleBudget / 2 ? Math.min(PREFIX, e.uncompressedSize) : e.uncompressedSize;
    const loc = await readLocal(blob, e);
    let taken = 0;
    const parts: Uint8Array[] = [];
    for await (const chunk of inflateEntry(blob, e, loc.dataStart, budget)) {
      const part = chunk.subarray(0, Math.max(0, take - taken));
      taken += part.length;
      parts.push(part.slice());
      if (taken >= take) break;
    }
    const sample = new Uint8Array(taken);
    let o = 0;
    for (const p of parts) sample.set(p, o), (o += p.length);
    const size = deflateBest(sample).length;
    const share = e.uncompressedSize ? taken / e.uncompressedSize : 1;
    const before = e.compressedSize * share;
    const after = Math.min(size, before);
    if (share >= 1) sampled.set(e.index, after);
    const r = ratio[category(e)];
    r.before += before;
    r.after += after;
    spent += before;
    onProgress?.(Math.min(1, spent / sampleBudget));
  }

  let estimate = 0;
  for (const e of archive.entries) {
    const s = sampled.get(e.index);
    if (s !== undefined) estimate += s;
    else {
      const c = category(e);
      const r = c === 'opaque' ? undefined : ratio[c];
      estimate += r && r.before ? e.compressedSize * (r.after / r.before) : e.compressedSize;
    }
  }
  return { entries: archive.entries.length, methods, encrypted, unsafePaths, compressedTotal, uncompressedTotal, estimate: Math.round(estimate), sampledBytes: spent };
}

function interleave<T>(sorted: T[]): T[] {
  const out: T[] = [];
  for (let i = 0, j = sorted.length - 1; i <= j; i++, j--) {
    out.push(sorted[i]);
    if (i !== j) out.push(sorted[j]);
  }
  return out;
}
