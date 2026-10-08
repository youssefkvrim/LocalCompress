import { deflate, zlib } from 'libdeflate';

/**
 * Best practical DEFLATE: libdeflate at its near-optimal levels (10–12),
 * ~20 % smaller than zlib -9 on text and still fully standard DEFLATE,
 * readable by every ZIP / PDF / PNG / Office reader. Whole-buffer, so it
 * is used up to BEST_MAX; larger payloads are streamed by the callers.
 */
export const BEST_MAX = 128 * 1024 * 1024;

const level = (n: number) => (n <= 32 * 1024 * 1024 ? 12 : 10);

/** Raw DEFLATE (ZIP entries). */
export function deflateBest(data: Uint8Array): Uint8Array {
  return deflate(data, level(data.length));
}

/** zlib-wrapped DEFLATE (PDF FlateDecode, PNG IDAT). */
export function zlibBest(data: Uint8Array): Uint8Array {
  return zlib(data, level(data.length));
}
