/**
 * How much memory a file will need while it is processed, roughly, so the
 * queue can run several files at once without exhausting the workstation.
 * Read from the first bytes only: an image's real cost is its pixel count,
 * which a small file can hide.
 */
import { imageSize, sniff } from './detect';
import type { Task } from './types';

const MB = 1 << 20;

export async function memoryCost(file: File, task: Task = 'compress'): Promise<number> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const { kind, format } = sniff(head);
  const size = format === 'jpeg' || format === 'png' ? imageSize(head, format) : null;
  // The segmentation network and its weights, whatever the picture.
  if (task === 'removebg') return 1024 * MB + (size ? size.width * size.height * 12 : file.size * 8);
  if (task === 'convert') {
    if (kind === 'video' || kind === 'audio') return 512 * MB;
    if (kind === 'pdf') return file.size * 3 + 256 * MB; // the document, plus one page at a time
    // Decoded pixels, a canvas copy and the encoder: compressed formats can hide a large picture.
    return size ? size.width * size.height * 12 + file.size * 2 : Math.max(256 * MB, file.size * 20);
  }
  if (format === 'jpeg' || format === 'png') {
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
