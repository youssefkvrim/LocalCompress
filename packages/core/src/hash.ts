import { createCRC32, createSHA256 } from 'hash-wasm';

const CHUNK = 8 * 1024 * 1024;

/**
 * Streaming SHA-256 of a Blob/File with bounded memory (8 MB slices).
 * crypto.subtle cannot stream, which matters for multi-GB inputs.
 */
export async function sha256Blob(blob: Blob, onProgress?: (fraction: number) => void): Promise<string> {
  const h = await createSHA256();
  h.init();
  for (let off = 0; off < blob.size; off += CHUNK) {
    const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
    h.update(buf);
    onProgress?.(Math.min(1, (off + buf.length) / blob.size));
  }
  return h.digest('hex');
}

export interface Crc32 {
  update(data: Uint8Array): void;
  /** Unsigned 32-bit CRC. */
  digest(): number;
}

export async function createCrc32(): Promise<Crc32> {
  const h = await createCRC32();
  h.init();
  return {
    update: (d) => void h.update(d),
    digest: () => parseInt(h.digest('hex'), 16) >>> 0,
  };
}
