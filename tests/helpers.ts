import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Sink } from '../src/lib/zip';

export const fixtures = join(import.meta.dirname, 'fixtures');
export const fixture = (name: string) => (existsSync(join(fixtures, name)) ? join(fixtures, name) : null);

export const tool = (cmd: string) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** In-memory replacement for the OPFS writer. */
export class Memory implements Sink {
  position = 0;
  parts: Uint8Array[] = [];
  write(d: Uint8Array) {
    this.parts.push(d.slice());
    this.position += d.length;
  }
  blob() {
    return new Blob(this.parts as BlobPart[]);
  }
}
