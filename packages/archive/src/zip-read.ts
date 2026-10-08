/**
 * Minimal, defensive ZIP / ZIP64 reader working on a Blob.
 *
 * Only the end of the file (central directory) and the byte ranges of the
 * entries being processed are ever read, so multi-GB archives are handled
 * without loading them into memory.
 */

export const MAX32 = 0xffffffff;
const SIG_EOCD = 0x06054b50;
const SIG_Z64_LOCATOR = 0x07064b50;
const SIG_Z64_EOCD = 0x06064b50;
const SIG_CDH = 0x02014b50;
const SIG_LFH = 0x04034b50;
const SIG_DD = 0x08074b50;

export interface ZipLimits {
  maxEntries: number;
  maxCentralDirectory: number;
  /** Max total uncompressed bytes processed per archive. */
  maxTotalUncompressed: number;
  /** Max compression ratio tolerated per entry once above `ratioFloor` bytes. */
  maxRatio: number;
  ratioFloor: number;
}

export const DEFAULT_LIMITS: ZipLimits = {
  maxEntries: 500_000,
  maxCentralDirectory: 256 * 1024 * 1024,
  maxTotalUncompressed: 64 * 1024 ** 3,
  maxRatio: 1000,
  ratioFloor: 64 * 1024 * 1024,
};

export interface ZipEntry {
  index: number;
  nameBytes: Uint8Array;
  name: string;
  versionMadeBy: number;
  versionNeeded: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  diskStart: number;
  internalAttr: number;
  externalAttr: number;
  localOffset: number;
  /** Central-directory extra field, raw. */
  extra: Uint8Array;
  comment: Uint8Array;
  encrypted: boolean;
  isDirectory: boolean;
  /** Suspicious path (absolute, drive letter, or `..` segment). Never extracted, only reported. */
  unsafePath: boolean;
}

export interface ZipArchive {
  entries: ZipEntry[];
  comment: Uint8Array;
  cdOffset: number;
  cdSize: number;
  /** Bytes prepended before the archive (e.g. self-extractor stub). */
  prefix: number;
  zip64: boolean;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

async function readRange(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const u64 = (v: DataView, at: number) => {
  const n = v.getBigUint64(at, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError('ZIP64 value out of range');
  return Number(n);
};

const utf8 = new TextDecoder('utf-8', { fatal: false });
// CP437 is the ZIP default; for display we fall back to latin1 which is close
// enough for names. Raw bytes are always preserved for writing.
const latin1 = new TextDecoder('latin1');

export async function readZip(blob: Blob, limits: ZipLimits = DEFAULT_LIMITS): Promise<ZipArchive> {
  const tailLen = Math.min(blob.size, 65_535 + 22 + 20);
  const tailStart = blob.size - tailLen;
  const tail = await readRange(blob, tailStart, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD) {
      const commentLen = tv.getUint16(i + 20, true);
      if (i + 22 + commentLen <= tail.length) {
        eocd = i;
        break;
      }
    }
  }
  if (eocd < 0) throw new ZipError('Not a ZIP archive (end of central directory not found)');

  const diskNo = tv.getUint16(eocd + 4, true);
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  const commentLen = tv.getUint16(eocd + 20, true);
  const comment = tail.slice(eocd + 22, eocd + 22 + commentLen);
  if (diskNo !== 0) throw new ZipError('Multi-volume (spanned) archives are not supported');

  let zip64 = false;
  const eocdAbs = tailStart + eocd;
  let recordEnd = eocdAbs; // where the central directory (or zip64 record) should end
  if (eocd >= 20 && tv.getUint32(eocd - 20, true) === SIG_Z64_LOCATOR) {
    zip64 = true;
    const z64At = u64(tv, eocd - 20 + 8);
    const rec = await readRange(blob, z64At, z64At + 56);
    const rv = new DataView(rec.buffer);
    if (rv.getUint32(0, true) !== SIG_Z64_EOCD) throw new ZipError('Corrupt ZIP64 end record');
    count = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
    recordEnd = z64At;
  }

  if (count > limits.maxEntries) throw new ZipError(`Too many entries (${count}); limit is ${limits.maxEntries}`);
  if (cdSize > limits.maxCentralDirectory) throw new ZipError('Central directory too large');

  // Support archives with a prepended stub: the CD really ends where the EOCD begins.
  const prefix = recordEnd - (cdOffset + cdSize);
  if (prefix < 0) throw new ZipError('Corrupt central directory offset');
  const cd = await readRange(blob, cdOffset + prefix, cdOffset + prefix + cdSize);
  const v = new DataView(cd.buffer);

  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== SIG_CDH) throw new ZipError(`Corrupt central directory at entry ${i}`);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen2 = v.getUint16(p + 32, true);
    if (p + 46 + nameLen + extraLen + commentLen2 > cd.length) throw new ZipError('Truncated central directory');
    const flags = v.getUint16(p + 8, true);
    const nameBytes = cd.slice(p + 46, p + 46 + nameLen);
    const extra = cd.slice(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const e: ZipEntry = {
      index: i,
      nameBytes,
      name: flags & 0x0800 ? utf8.decode(nameBytes) : latin1.decode(nameBytes),
      versionMadeBy: v.getUint16(p + 4, true),
      versionNeeded: v.getUint16(p + 6, true),
      flags,
      method: v.getUint16(p + 10, true),
      time: v.getUint16(p + 12, true),
      date: v.getUint16(p + 14, true),
      crc: v.getUint32(p + 16, true),
      compressedSize: v.getUint32(p + 20, true),
      uncompressedSize: v.getUint32(p + 24, true),
      diskStart: v.getUint16(p + 34, true),
      internalAttr: v.getUint16(p + 36, true),
      externalAttr: v.getUint32(p + 38, true),
      localOffset: v.getUint32(p + 42, true),
      extra,
      comment: cd.slice(p + 46 + nameLen + extraLen, p + 46 + nameLen + extraLen + commentLen2),
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: false,
      unsafePath: false,
    };
    applyZip64Extra(e);
    e.localOffset += prefix;
    e.isDirectory = e.name.endsWith('/') && e.uncompressedSize === 0;
    e.unsafePath = /^([a-zA-Z]:|[\\/])/.test(e.name) || e.name.split(/[\\/]/).includes('..');
    entries.push(e);
    p += 46 + nameLen + extraLen + commentLen2;
  }
  return { entries, comment, cdOffset: cdOffset + prefix, cdSize, prefix, zip64 };
}

function applyZip64Extra(e: ZipEntry) {
  const v = new DataView(e.extra.buffer, e.extra.byteOffset, e.extra.byteLength);
  for (let p = 0; p + 4 <= e.extra.length; ) {
    const id = v.getUint16(p, true);
    const size = v.getUint16(p + 2, true);
    if (id === 0x0001) {
      let q = p + 4;
      const end = q + size;
      if (e.uncompressedSize === MAX32 && q + 8 <= end) (e.uncompressedSize = u64(v, q)), (q += 8);
      if (e.compressedSize === MAX32 && q + 8 <= end) (e.compressedSize = u64(v, q)), (q += 8);
      if (e.localOffset === MAX32 && q + 8 <= end) (e.localOffset = u64(v, q)), (q += 8);
      return;
    }
    p += 4 + size;
  }
}

export interface LocalRecord {
  /** Absolute offset of the compressed data. */
  dataStart: number;
  /** Local-header extra field (raw). */
  localExtra: Uint8Array;
  /** Absolute end of the whole local record (data + optional data descriptor). */
  recordEnd: number;
}

export async function readLocal(blob: Blob, e: ZipEntry): Promise<LocalRecord> {
  const h = await readRange(blob, e.localOffset, e.localOffset + 30);
  const v = new DataView(h.buffer);
  if (h.length < 30 || v.getUint32(0, true) !== SIG_LFH) throw new ZipError(`Corrupt local header for "${e.name}"`);
  const nameLen = v.getUint16(26, true);
  const extraLen = v.getUint16(28, true);
  const localExtra = await readRange(blob, e.localOffset + 30 + nameLen, e.localOffset + 30 + nameLen + extraLen);
  const dataStart = e.localOffset + 30 + nameLen + extraLen;
  let recordEnd = dataStart + e.compressedSize;
  if (recordEnd > blob.size) throw new ZipError(`Entry "${e.name}" extends past end of file`);
  if (e.flags & 0x0008) {
    const zip64 = hasExtra(localExtra, 0x0001) || e.compressedSize >= MAX32 || e.uncompressedSize >= MAX32;
    const dd = await readRange(blob, recordEnd, recordEnd + 4);
    const hasSig = dd.length === 4 && new DataView(dd.buffer).getUint32(0, true) === SIG_DD;
    recordEnd += (hasSig ? 4 : 0) + 4 + (zip64 ? 16 : 8);
  }
  return { dataStart, localExtra, recordEnd: Math.min(recordEnd, blob.size) };
}

export function hasExtra(extra: Uint8Array, id: number): boolean {
  const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (let p = 0; p + 4 <= extra.length; p += 4 + v.getUint16(p + 2, true)) if (v.getUint16(p, true) === id) return true;
  return false;
}

export function stripExtra(extra: Uint8Array, id: number): Uint8Array {
  const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  const parts: Uint8Array[] = [];
  for (let p = 0; p + 4 <= extra.length; ) {
    const size = v.getUint16(p + 2, true);
    if (v.getUint16(p, true) !== id) parts.push(extra.subarray(p, Math.min(extra.length, p + 4 + size)));
    p += 4 + size;
  }
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** Entries that can be decompressed and recompressed by this engine. */
export const canTranscode = (e: ZipEntry) => !e.encrypted && (e.method === 0 || e.method === 8) && !e.isDirectory;
