/**
 * ZIP / ZIP64 reading and writing, byte-exact where it matters.
 *
 * Reading only touches the central directory and the ranges of the entries
 * being processed, so archives of any size work without loading them.
 * Names (raw bytes), attributes, timestamps, extra fields, comments and
 * order are carried over unchanged.
 */
import { crc32 } from './crc32';
/** Anything bytes can be appended to: the OPFS Writer, or an array in tests. */
export interface Sink {
  position: number;
  write(data: Uint8Array): void;
}

const MAX32 = 0xffffffff;
const MAX_ENTRIES = 500_000;
const MAX_CENTRAL_DIR = 256 * 1024 * 1024;

export interface Entry {
  index: number;
  nameBytes: Uint8Array;
  name: string;
  madeBy: number;
  needed: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  csize: number;
  usize: number;
  internal: number;
  external: number;
  offset: number;
  extra: Uint8Array;
  comment: Uint8Array;
  /** Stored or deflated, not encrypted, not a directory: we can decode it. */
  readable: boolean;
  /** Absolute, drive-letter or "..": reported, never extracted. */
  unsafe: boolean;
}

export interface Archive {
  entries: Entry[];
  comment: Uint8Array;
}

export class ZipError extends Error {
  override name = 'ZipError';
}

const bytes = async (b: Blob, from: number, to: number) => new Uint8Array(await b.slice(from, to).arrayBuffer());
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (v: DataView, at: number) => {
  const n = v.getBigUint64(at, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('ZIP64 value out of range');
  return Number(n);
};

export async function readZip(blob: Blob): Promise<Archive> {
  const tailStart = Math.max(0, blob.size - 65_557 - 20);
  const tail = await bytes(blob, tailStart, blob.size);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50 && i + 22 + tv.getUint16(i + 20, true) <= tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive');
  if (tv.getUint16(eocd + 4, true) !== 0) throw new ZipError('Spanned archives are not supported');

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  let end = tailStart + eocd;
  if (eocd >= 20 && tv.getUint32(eocd - 20, true) === 0x07064b50) {
    const at = u64(tv, eocd - 12);
    const rv = view(await bytes(blob, at, at + 56));
    if (rv.getUint32(0, true) !== 0x06064b50) throw new ZipError('Corrupt ZIP64 record');
    count = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
    end = at;
  }
  if (count > MAX_ENTRIES || cdSize > MAX_CENTRAL_DIR) throw new ZipError('Archive directory too large');
  // Data prepended to the archive (self-extractors) shifts every offset.
  const shift = end - (cdOffset + cdSize);
  if (shift < 0) throw new ZipError('Corrupt central directory');

  const cd = await bytes(blob, cdOffset + shift, cdOffset + shift + cdSize);
  const v = view(cd);
  const entries: Entry[] = [];
  const utf8 = new TextDecoder();
  const latin1 = new TextDecoder('latin1');
  for (let i = 0, p = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipError('Corrupt central directory');
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) throw new ZipError('Truncated central directory');
    const flags = v.getUint16(p + 8, true);
    const nameBytes = cd.slice(p + 46, p + 46 + nameLen);
    const e: Entry = {
      index: i,
      nameBytes,
      name: (flags & 0x800 ? utf8 : latin1).decode(nameBytes),
      madeBy: v.getUint16(p + 4, true),
      needed: v.getUint16(p + 6, true),
      flags,
      method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
      crc: v.getUint32(p + 16, true),
      csize: v.getUint32(p + 20, true),
      usize: v.getUint32(p + 24, true),
      internal: v.getUint16(p + 36, true),
      external: v.getUint32(p + 38, true),
      offset: v.getUint32(p + 42, true),
      extra: cd.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen),
      comment: cd.slice(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + commentLen),
      readable: false,
      unsafe: false,
    };
    readZip64Extra(e);
    e.offset += shift;
    e.readable = !(flags & 1) && (e.method === 0 || e.method === 8) && !(e.name.endsWith('/') && e.usize === 0);
    e.unsafe = /^([a-zA-Z]:|[\\/])/.test(e.name) || e.name.split(/[\\/]/).includes('..');
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, comment: tail.slice(eocd + 22, eocd + 22 + tv.getUint16(eocd + 20, true)) };
}

function readZip64Extra(e: Entry) {
  const v = view(e.extra);
  for (let p = 0; p + 4 <= e.extra.length; p += 4 + v.getUint16(p + 2, true)) {
    if (v.getUint16(p, true) !== 1) continue;
    let q = p + 4;
    const end = q + v.getUint16(p + 2, true);
    if (e.usize === MAX32 && q + 8 <= end) (e.usize = u64(v, q)), (q += 8);
    if (e.csize === MAX32 && q + 8 <= end) (e.csize = u64(v, q)), (q += 8);
    if (e.offset === MAX32 && q + 8 <= end) e.offset = u64(v, q);
    return;
  }
}

/** Where an entry's data starts and its whole local record ends. */
export async function readLocal(blob: Blob, e: Entry) {
  const h = view(await bytes(blob, e.offset, e.offset + 30));
  if (h.byteLength < 30 || h.getUint32(0, true) !== 0x04034b50) throw new ZipError(`Corrupt local header: ${e.name}`);
  const nameLen = h.getUint16(26, true);
  const extraLen = h.getUint16(28, true);
  const extra = await bytes(blob, e.offset + 30 + nameLen, e.offset + 30 + nameLen + extraLen);
  const start = e.offset + 30 + nameLen + extraLen;
  let end = start + e.csize;
  if (end > blob.size) throw new ZipError(`Entry past end of file: ${e.name}`);
  if (e.flags & 8) {
    const signed = view(await bytes(blob, end, end + 4)).getUint32(0, true) === 0x08074b50;
    end += (signed ? 4 : 0) + 4 + (hasExtra(extra, 1) || e.csize >= MAX32 ? 16 : 8);
  }
  return { start, extra, end: Math.min(end, blob.size) };
}

/** Shared decompression budget for one archive: the zip-bomb guard. */
export class Budget {
  left: number;
  constructor(archiveSize: number) {
    this.left = Math.min(64 * 1024 ** 3, Math.max(2 * 1024 ** 3, archiveSize * 200));
  }
}

/** Decompressed bytes of an entry, chunk by chunk, CRC-checked at the end. */
export async function* inflateEntry(blob: Blob, e: Entry, start: number, budget: Budget): AsyncGenerator<Uint8Array> {
  let stream = blob.slice(start, start + e.csize).stream() as ReadableStream<Uint8Array>;
  if (e.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  let total = 0;
  let crc = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      budget.left -= value.length;
      if (total > e.usize + 1024) throw new ZipError(`"${e.name}" expands beyond its declared size (zip bomb?)`);
      if (total > 64 * 1024 * 1024 && total / Math.max(1, e.csize) > 1000) throw new ZipError(`"${e.name}" has an abnormal ratio (zip bomb?)`);
      if (budget.left < 0) throw new ZipError('Archive expands beyond the safety limit');
      crc = crc32(value, crc);
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (total !== e.usize || crc !== e.crc) throw new ZipError(`"${e.name}" is corrupt (size or CRC mismatch)`);
}

export function hasExtra(extra: Uint8Array, id: number) {
  const v = view(extra);
  for (let p = 0; p + 4 <= extra.length; p += 4 + v.getUint16(p + 2, true)) if (v.getUint16(p, true) === id) return true;
  return false;
}

function withoutZip64(extra: Uint8Array) {
  const v = view(extra);
  const keep: number[] = [];
  for (let p = 0; p + 4 <= extra.length; ) {
    const size = v.getUint16(p + 2, true);
    if (v.getUint16(p, true) !== 1) keep.push(...extra.subarray(p, p + 4 + size));
    p += 4 + size;
  }
  return Uint8Array.from(keep);
}

function zip64(values: number[]) {
  const b = new Uint8Array(4 + values.length * 8);
  const v = view(b);
  v.setUint16(0, 1, true);
  v.setUint16(2, values.length * 8, true);
  values.forEach((n, i) => v.setBigUint64(4 + i * 8, BigInt(n), true));
  return b;
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
};

interface Written {
  e: Entry;
  method: number;
  flags: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
  needed: number;
}

/** Writes a new archive entry by entry, then the central directory. */
export class ZipWriter {
  private written: Written[] = [];
  private out: Sink;
  constructor(out: Sink) {
    this.out = out;
  }

  /** Copy an entry's original local record byte for byte. */
  async copy(blob: Blob, e: Entry, end: number) {
    const offset = this.out.position;
    for (let at = e.offset; at < end; at += 8 << 20) this.out.write(await bytes(blob, at, Math.min(end, at + (8 << 20))));
    this.written.push({ e, method: e.method, flags: e.flags, crc: e.crc, csize: e.csize, usize: e.usize, offset, needed: e.needed });
  }

  /** Write an entry whose final bytes are known. */
  put(e: Entry, localExtra: Uint8Array, method: number, crc: number, usize: number, data: Uint8Array) {
    const big = data.length >= MAX32 || usize >= MAX32;
    const offset = this.out.position;
    const flags = e.flags & 0x800; // keep the UTF-8 flag only
    const needed = big ? 45 : 20;
    this.out.write(this.header(e, withoutZip64(localExtra), big ? zip64([usize, data.length]) : new Uint8Array(0), flags, method, crc, big ? MAX32 : data.length, big ? MAX32 : usize, needed));
    this.out.write(data);
    this.written.push({ e, method, flags, crc, csize: data.length, usize, offset, needed });
  }

  /**
   * Stream-deflate a very large entry with the browser's compressor.
   * Sizes are unknown up front, so they follow the data (data descriptor).
   */
  async stream(e: Entry, localExtra: Uint8Array, chunks: AsyncIterable<Uint8Array>) {
    const offset = this.out.position;
    const flags = (e.flags & 0x800) | 8;
    this.out.write(this.header(e, withoutZip64(localExtra), zip64([0, 0]), flags, 8, 0, MAX32, MAX32, 45));
    const cs = new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>;
    const writer = cs.writable.getWriter();
    let csize = 0;
    const drain = (async () => {
      const r = cs.readable.getReader();
      for (;;) {
        const { value, done } = await r.read();
        if (done) break;
        this.out.write(value);
        csize += value.length;
      }
    })();
    let usize = 0;
    let crc = 0;
    for await (const c of chunks) {
      usize += c.length;
      crc = crc32(c, crc);
      await writer.write(c);
    }
    await writer.close();
    await drain;
    const d = new Uint8Array(24);
    const v = view(d);
    v.setUint32(0, 0x08074b50, true);
    v.setUint32(4, crc, true);
    v.setBigUint64(8, BigInt(csize), true);
    v.setBigUint64(16, BigInt(usize), true);
    this.out.write(d);
    this.written.push({ e, method: 8, flags, crc, csize, usize, offset, needed: 45 });
  }

  private header(e: Entry, extra: Uint8Array, z64: Uint8Array, flags: number, method: number, crc: number, csize: number, usize: number, needed: number) {
    const ex = cat(extra, z64);
    const b = new Uint8Array(30 + e.nameBytes.length + ex.length);
    const v = view(b);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, needed, true);
    v.setUint16(6, flags, true);
    v.setUint16(8, method, true);
    v.setUint16(10, e.time, true);
    v.setUint16(12, e.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, csize, true);
    v.setUint32(22, usize, true);
    v.setUint16(26, e.nameBytes.length, true);
    v.setUint16(28, ex.length, true);
    b.set(e.nameBytes, 30);
    b.set(ex, 30 + e.nameBytes.length);
    return b;
  }

  /** Central directory and end records (ZIP64 only when needed). */
  finish(comment: Uint8Array) {
    const cdStart = this.out.position;
    for (const w of this.written) {
      const big = [w.usize, w.csize, w.offset].map((n) => n >= MAX32);
      const z = [w.usize, w.csize, w.offset].filter((_, i) => big[i]);
      const extra = cat(withoutZip64(w.e.extra), z.length ? zip64(z) : new Uint8Array(0));
      const needed = Math.max(w.needed, z.length ? 45 : 0);
      const b = new Uint8Array(46 + w.e.nameBytes.length + extra.length + w.e.comment.length);
      const v = view(b);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, (w.e.madeBy & 0xff00) | Math.max(w.e.madeBy & 0xff, needed), true);
      v.setUint16(6, needed, true);
      v.setUint16(8, w.flags, true);
      v.setUint16(10, w.method, true);
      v.setUint16(12, w.e.time, true);
      v.setUint16(14, w.e.date, true);
      v.setUint32(16, w.crc, true);
      v.setUint32(20, Math.min(w.csize, MAX32), true);
      v.setUint32(24, Math.min(w.usize, MAX32), true);
      v.setUint16(28, w.e.nameBytes.length, true);
      v.setUint16(30, extra.length, true);
      v.setUint16(32, w.e.comment.length, true);
      v.setUint16(36, w.e.internal, true);
      v.setUint32(38, w.e.external, true);
      v.setUint32(42, Math.min(w.offset, MAX32), true);
      b.set(cat(w.e.nameBytes, extra, w.e.comment), 46);
      this.out.write(b);
    }
    const cdSize = this.out.position - cdStart;
    const n = this.written.length;
    if (n >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32) {
      const at = this.out.position;
      const r = new Uint8Array(56 + 20);
      const v = view(r);
      v.setUint32(0, 0x06064b50, true);
      v.setBigUint64(4, 44n, true);
      v.setUint16(12, 45, true);
      v.setUint16(14, 45, true);
      v.setBigUint64(24, BigInt(n), true);
      v.setBigUint64(32, BigInt(n), true);
      v.setBigUint64(40, BigInt(cdSize), true);
      v.setBigUint64(48, BigInt(cdStart), true);
      v.setUint32(56, 0x07064b50, true);
      v.setBigUint64(64, BigInt(at), true);
      v.setUint32(72, 1, true);
      this.out.write(r);
    }
    const e = new Uint8Array(22 + comment.length);
    const v = view(e);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, Math.min(n, 0xffff), true);
    v.setUint16(10, Math.min(n, 0xffff), true);
    v.setUint32(12, Math.min(cdSize, MAX32), true);
    v.setUint32(16, Math.min(cdStart, MAX32), true);
    v.setUint16(20, comment.length, true);
    e.set(comment, 22);
    this.out.write(e);
  }
}
