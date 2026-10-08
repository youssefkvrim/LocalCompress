/**
 * Lossless JPEG optimiser: output must decode to bit-identical pixels in an
 * independent decoder (libjpeg-turbo `djpeg`), keep identical coefficients,
 * and be no larger than the input. Compared with the reference `jpegtran`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { optimizeJpegLossless, sameCoefficients } from '../../packages/image/src/jpeg-lossless';

const dir = join(import.meta.dirname, '..', 'fixtures', 'jpeg');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.jpg')) : [];
const have = (c: string) => {
  try {
    execFileSync('which', [c], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const tmp = mkdtempSync(join(tmpdir(), 'lcj-'));
const pixels = (f: string) => createHash('sha256').update(execFileSync('djpeg', ['-ppm', f], { maxBuffer: 1 << 30 })).digest('hex');

describe.skipIf(!files.length || !have('djpeg'))('lossless JPEG', () => {
  it.each(files)('%s', (name) => {
    const src = readFileSync(join(dir, name));
    const t0 = performance.now();
    const res = optimizeJpegLossless(new Uint8Array(src), { stripMetadata: true });
    const ms = performance.now() - t0;
    expect(res).not.toBeNull();
    const out = join(tmp, name);
    writeFileSync(out, res!.bytes);
    expect(sameCoefficients(new Uint8Array(src), res!.bytes)).toBe(true);
    expect(pixels(out)).toBe(pixels(join(dir, name)));
    expect(res!.bytes.length).toBeLessThanOrEqual(src.length);
    if (have('magick')) {
      const o = (f: string) => execFileSync('magick', ['identify', '-format', '%[orientation]', f]).toString();
      expect(o(out)).toBe(o(join(dir, name)));
    }
    let ref = '';
    if (have('jpegtran')) {
      const jt = execFileSync('jpegtran', ['-optimize', '-progressive', '-copy', 'none', join(dir, name)], { maxBuffer: 1 << 30 });
      ref = ` · jpegtran ${(100 * (1 - jt.length / src.length)).toFixed(1)}%`;
    }
    console.log(`${name.padEnd(20)} ${src.length} → ${res!.bytes.length} (${(100 * (1 - res!.bytes.length / src.length)).toFixed(1)}%, ${res!.mode}, ${ms.toFixed(0)} ms)${ref}`);
  });
});
