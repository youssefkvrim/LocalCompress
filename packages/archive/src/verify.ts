import { createCrc32 } from '@localcompress/core/hash';
import { DEFAULT_LIMITS, canTranscode, readLocal, readZip, type ZipArchive, type ZipLimits } from './zip-read';
import { Budget, inflateEntry } from './streams';

export interface ZipVerification {
  entries: number;
  verified: number;
  /** Entries that cannot be decompressed here (encrypted / exotic method) — byte-identical copies. */
  opaque: number;
  structureMatches: boolean;
  problems: string[];
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Reopen a generated archive from scratch and prove it is sound:
 * same entry list and attributes as the original, every entry
 * decompresses and matches its CRC-32.
 */
export async function verifyZip(
  output: Blob,
  original: ZipArchive,
  changed: Set<number>,
  onProgress?: (f: number) => void,
  limits: ZipLimits = DEFAULT_LIMITS,
): Promise<ZipVerification> {
  const problems: string[] = [];
  const archive = await readZip(output, limits);
  const budget = new Budget(limits, output.size);
  let structureMatches = archive.entries.length === original.entries.length;
  if (!structureMatches) problems.push(`Entry count differs (${archive.entries.length} ≠ ${original.entries.length})`);

  let verified = 0;
  let opaque = 0;
  const total = archive.entries.reduce((n, e) => n + e.compressedSize, 0) || 1;
  let done = 0;
  for (const e of archive.entries) {
    const o = original.entries[e.index];
    if (o) {
      if (!sameBytes(o.nameBytes, e.nameBytes)) (structureMatches = false), problems.push(`Name changed: ${o.name}`);
      if (o.externalAttr !== e.externalAttr) (structureMatches = false), problems.push(`Attributes changed: ${o.name}`);
      if (o.time !== e.time || o.date !== e.date) (structureMatches = false), problems.push(`Timestamp changed: ${o.name}`);
      if (!changed.has(e.index) && (o.crc !== e.crc || o.uncompressedSize !== e.uncompressedSize)) {
        structureMatches = false;
        problems.push(`Content changed unexpectedly: ${o.name}`);
      }
    }
    if (!canTranscode(e)) {
      opaque++;
    } else {
      const loc = await readLocal(output, e);
      const crc = await createCrc32();
      try {
        for await (const chunk of inflateEntry(output, e, loc.dataStart, budget)) crc.update(chunk);
        if (crc.digest() === e.crc) verified++;
        else problems.push(`CRC mismatch: ${e.name}`);
      } catch (err) {
        problems.push(`${e.name}: ${(err as Error).message}`);
      }
    }
    done += e.compressedSize;
    onProgress?.(done / total);
  }
  return { entries: archive.entries.length, verified, opaque, structureMatches, problems };
}
