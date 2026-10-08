/** IDAT re-compression keeps every pixel: checked with ImageMagick, an independent decoder. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { recompressPngIdat } from '../../packages/image/src/lossless';

const dir = join(import.meta.dirname, '..', 'fixtures');
const files = ['photo.png', 'screenshot.png'].filter((f) => existsSync(join(dir, f)));
const hasMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const rgba = (f: string) => createHash('sha256').update(execFileSync('magick', [f, '-depth', '16', 'rgba:-'], { maxBuffer: 1 << 30 })).digest('hex');

describe.skipIf(!files.length || !hasMagick)('lossless PNG', () => {
  it.each(files)('%s', (name) => {
    const src = new Uint8Array(readFileSync(join(dir, name)));
    const out = recompressPngIdat(src, true);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThan(src.length);
    const p = join(mkdtempSync(join(tmpdir(), 'lcp-')), name);
    writeFileSync(p, out!);
    expect(rgba(p)).toBe(rgba(join(dir, name)));
  });
});
