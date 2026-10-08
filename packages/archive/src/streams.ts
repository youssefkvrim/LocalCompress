import { Deflate } from 'fflate';
import { ZipError, type ZipEntry, type ZipLimits } from './zip-read';

/** Shared byte budget for one archive — the decompression-bomb guard. */
export class Budget {
  used = 0;
  readonly limits: ZipLimits;
  /** @param inputSize lets the total budget scale with the archive (bombs expand far beyond it). */
  constructor(limits: ZipLimits, inputSize?: number) {
    this.limits = inputSize ? { ...limits, maxTotalUncompressed: Math.min(limits.maxTotalUncompressed, Math.max(2 * 1024 ** 3, inputSize * 200)) } : limits;
  }
  consume(e: ZipEntry, entryBytes: number, n: number) {
    this.used += n;
    if (this.used > this.limits.maxTotalUncompressed) {
      throw new ZipError('Decompression limit reached: archive expands beyond the configured maximum');
    }
    if (entryBytes > e.uncompressedSize + 1024) {
      throw new ZipError(`"${e.name}" expands beyond its declared size — possible decompression bomb`);
    }
    if (entryBytes > this.limits.ratioFloor && entryBytes / Math.max(1, e.compressedSize) > this.limits.maxRatio) {
      throw new ZipError(`"${e.name}" has an abnormal compression ratio — possible decompression bomb`);
    }
  }
}

/**
 * Yield the decompressed bytes of a stored/deflated entry, chunk by chunk,
 * using the browser's native inflater. Memory stays bounded.
 */
export async function* inflateEntry(blob: Blob, e: ZipEntry, dataStart: number, budget: Budget): AsyncGenerator<Uint8Array> {
  let stream = blob.slice(dataStart, dataStart + e.compressedSize).stream() as ReadableStream<Uint8Array>;
  if (e.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  else if (e.method !== 0) throw new ZipError(`Unsupported compression method ${e.method}`);
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      budget.consume(e, total, value.length);
      yield value;
    }
  } finally {
    // Also runs when the consumer stops early (sampling): stop reading the file.
    await reader.cancel().catch(() => {});
  }
  if (total !== e.uncompressedSize) throw new ZipError(`"${e.name}" size mismatch (${total} ≠ ${e.uncompressedSize})`);
}

/** Collects compressed output; spills to an external sink when it grows large. */
export interface Spill {
  write(d: Uint8Array): void;
  read(at: number, len: number): Uint8Array;
  close(): Promise<void>;
}

export class Staging {
  private chunks: Uint8Array[] = [];
  size = 0;
  private spill?: Spill;
  constructor(
    private spillAt: number,
    private makeSpill?: () => Promise<Spill>,
  ) {}

  async push(d: Uint8Array) {
    if (!d.length) return;
    if (!this.spill && this.makeSpill && this.size + d.length > this.spillAt) {
      this.spill = await this.makeSpill();
      for (const c of this.chunks) this.spill.write(c);
      this.chunks = [];
    }
    if (this.spill) this.spill.write(d);
    else this.chunks.push(d.slice());
    this.size += d.length;
  }

  /** Stream staged bytes into `write`. */
  drain(write: (d: Uint8Array) => void) {
    if (!this.spill) {
      for (const c of this.chunks) write(c);
      return;
    }
    const step = 8 * 1024 * 1024;
    for (let at = 0; at < this.size; at += step) write(this.spill.read(at, Math.min(step, this.size - at)));
  }

  async dispose() {
    this.chunks = [];
    await this.spill?.close();
  }
}

/**
 * Streaming raw DEFLATE.
 * - fflate level 9 for real ratio gains (already-deflated inputs),
 * - native CompressionStream for large stored inputs (much faster).
 */
export class Deflater {
  private fflate?: Deflate;
  private native?: { writer: WritableStreamDefaultWriter<Uint8Array>; pump: Promise<void> };
  private pending: Uint8Array[] = [];

  constructor(
    mode: 'max' | 'fast',
    private sink: (d: Uint8Array) => Promise<void>,
  ) {
    if (mode === 'max') {
      this.fflate = new Deflate({ level: 9, mem: 8 }, (chunk) => {
        this.pending.push(chunk);
      });
    } else {
      const cs = new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>;
      const reader = cs.readable.getReader();
      const pump = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          await this.sink(value);
        }
      })();
      this.native = { writer: cs.writable.getWriter(), pump };
    }
  }

  async push(d: Uint8Array) {
    if (this.fflate) {
      this.fflate.push(d, false);
      await this.flushPending();
    } else {
      await this.native!.writer.write(d);
    }
  }

  async finish() {
    if (this.fflate) {
      this.fflate.push(new Uint8Array(0), true);
      await this.flushPending();
    } else {
      await this.native!.writer.close();
      await this.native!.pump;
    }
  }

  private async flushPending() {
    const p = this.pending;
    this.pending = [];
    for (const c of p) await this.sink(c);
  }
}
