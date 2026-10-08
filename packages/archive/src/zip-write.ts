import { MAX32, concat, stripExtra, type ZipEntry } from './zip-read';

/** Sequential byte sink (OPFS writer in the browser, array in tests). */
export interface Out {
  position: number;
  write(d: Uint8Array): void;
}

export interface WrittenEntry {
  source: ZipEntry;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  versionNeeded: number;
}

function zip64Extra(fields: number[]): Uint8Array {
  const b = new Uint8Array(4 + fields.length * 8);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0x0001, true);
  v.setUint16(2, fields.length * 8, true);
  fields.forEach((f, i) => v.setBigUint64(4 + i * 8, BigInt(f), true));
  return b;
}

/**
 * Local file header for an entry whose sizes and CRC are already known
 * (no data descriptor). ZIP64 is used only when required.
 */
export function localHeader(src: ZipEntry, localExtra: Uint8Array, w: Omit<WrittenEntry, 'source' | 'localOffset' | 'versionNeeded'>): { bytes: Uint8Array; versionNeeded: number } {
  const big = w.compressedSize >= MAX32 || w.uncompressedSize >= MAX32;
  const extra = concat([stripExtra(localExtra, 0x0001), big ? zip64Extra([w.uncompressedSize, w.compressedSize]) : new Uint8Array(0)]);
  const versionNeeded = Math.max(big ? 45 : 20, w.method === 8 ? 20 : 10);
  const b = new Uint8Array(30 + src.nameBytes.length + extra.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, versionNeeded, true);
  v.setUint16(6, w.flags, true);
  v.setUint16(8, w.method, true);
  v.setUint16(10, src.time, true);
  v.setUint16(12, src.date, true);
  v.setUint32(14, w.crc, true);
  v.setUint32(18, big ? MAX32 : w.compressedSize, true);
  v.setUint32(22, big ? MAX32 : w.uncompressedSize, true);
  v.setUint16(26, src.nameBytes.length, true);
  v.setUint16(28, extra.length, true);
  b.set(src.nameBytes, 30);
  b.set(extra, 30 + src.nameBytes.length);
  return { bytes: b, versionNeeded };
}

function centralHeader(w: WrittenEntry): Uint8Array {
  const s = w.source;
  const fields: number[] = [];
  if (w.uncompressedSize >= MAX32) fields.push(w.uncompressedSize);
  if (w.compressedSize >= MAX32) fields.push(w.compressedSize);
  if (w.localOffset >= MAX32) fields.push(w.localOffset);
  const extra = concat([stripExtra(s.extra, 0x0001), fields.length ? zip64Extra(fields) : new Uint8Array(0)]);
  const versionNeeded = Math.max(w.versionNeeded, fields.length ? 45 : 0);
  const b = new Uint8Array(46 + s.nameBytes.length + extra.length + s.comment.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true);
  // Keep the "made by" host (permissions live in externalAttr), bump spec version if needed.
  v.setUint16(4, (s.versionMadeBy & 0xff00) | Math.max(s.versionMadeBy & 0xff, versionNeeded), true);
  v.setUint16(6, versionNeeded, true);
  v.setUint16(8, w.flags, true);
  v.setUint16(10, w.method, true);
  v.setUint16(12, s.time, true);
  v.setUint16(14, s.date, true);
  v.setUint32(16, w.crc, true);
  v.setUint32(20, Math.min(w.compressedSize, MAX32), true);
  v.setUint32(24, Math.min(w.uncompressedSize, MAX32), true);
  v.setUint16(28, s.nameBytes.length, true);
  v.setUint16(30, extra.length, true);
  v.setUint16(32, s.comment.length, true);
  v.setUint16(34, 0, true);
  v.setUint16(36, s.internalAttr, true);
  v.setUint32(38, s.externalAttr, true);
  v.setUint32(42, Math.min(w.localOffset, MAX32), true);
  let p = 46;
  b.set(s.nameBytes, p);
  b.set(extra, (p += s.nameBytes.length));
  b.set(s.comment, p + extra.length);
  return b;
}

/** Write central directory + (ZIP64) end records. */
export function writeCentralDirectory(out: Out, entries: WrittenEntry[], comment: Uint8Array) {
  const cdOffset = out.position;
  for (const e of entries) out.write(centralHeader(e));
  const cdSize = out.position - cdOffset;
  const needZ64 = entries.length >= 0xffff || cdOffset >= MAX32 || cdSize >= MAX32;
  if (needZ64) {
    const z64At = out.position;
    const r = new Uint8Array(56);
    const v = new DataView(r.buffer);
    v.setUint32(0, 0x06064b50, true);
    v.setBigUint64(4, 44n, true);
    v.setUint16(12, 45, true);
    v.setUint16(14, 45, true);
    v.setBigUint64(24, BigInt(entries.length), true);
    v.setBigUint64(32, BigInt(entries.length), true);
    v.setBigUint64(40, BigInt(cdSize), true);
    v.setBigUint64(48, BigInt(cdOffset), true);
    out.write(r);
    const l = new Uint8Array(20);
    const lv = new DataView(l.buffer);
    lv.setUint32(0, 0x07064b50, true);
    lv.setBigUint64(8, BigInt(z64At), true);
    lv.setUint32(16, 1, true);
    out.write(l);
  }
  const e = new Uint8Array(22 + comment.length);
  const v = new DataView(e.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, Math.min(entries.length, 0xffff), true);
  v.setUint16(10, Math.min(entries.length, 0xffff), true);
  v.setUint32(12, Math.min(cdSize, MAX32), true);
  v.setUint32(16, Math.min(cdOffset, MAX32), true);
  v.setUint16(20, comment.length, true);
  e.set(comment, 22);
  out.write(e);
}
