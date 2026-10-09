import { deflate, zlib } from 'libdeflate';

/**
 * DEFLATE, the format inside ZIP, Office, PDF and PNG files.
 *
 * Compression uses libdeflate at its near-optimal levels: ~20 % smaller than
 * zlib -9 on text, still plain DEFLATE that every reader understands. It is
 * whole-buffer, so it is used up to BEST_MAX. Decompression uses the browser.
 */
export const BEST_MAX = 128 * 1024 * 1024;

const level = (n: number) => (n <= 32 * 1024 * 1024 ? 12 : 10);

export const deflateBest = (data: Uint8Array) => deflate(data, level(data.length));
export const zlibBest = (data: Uint8Array) => zlib(data, level(data.length));

/** Inflate with a hard output limit (decompression bombs). */
export async function inflate(data: Uint8Array, format: 'deflate' | 'deflate-raw', max = BEST_MAX): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Error('inflated data exceeds limit');
    }
    parts.push(value);
  }
  return join(parts, size);
}

export function join(parts: Uint8Array[], size = parts.reduce((n, p) => n + p.length, 0)) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}
