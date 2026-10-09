/**
 * How much memory a file will need while it is processed, roughly, so the
 * queue can run several files at once without exhausting the workstation.
 * Read from the first bytes only: an image's real cost is its pixel count,
 * which a small file can hide.
 */
import { imageSize, sniff } from './detect';

const MB = 1 << 20;

export async function memoryCost(file: File): Promise<number> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const { kind, format } = sniff(head);
  if (format === 'jpeg' || format === 'png') {
    const size = imageSize(head, format);
    // Decoded pixels, a comparison copy and JPEG coefficients: about 16 bytes per pixel.
    return size ? size.width * size.height * 16 + file.size * 2 : Infinity;
  }
  if (kind === 'pdf') return file.size * 4; // pdf-lib holds the whole document and rewrites it
  if (kind === 'zip') return Math.min(file.size, 128 * MB) * 3; // one entry in memory at a time
  if (kind === 'video') return 512 * MB; // decoder and encoder frame queues
  return file.size * 2;
}

/** What the queue may use at once: a quarter of the workstation's memory, between 512 MB and 2 GB. */
export function memoryBudget(): number {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return Math.min(2048 * MB, Math.max(512 * MB, (gb * 1024 * MB) / 4));
}
