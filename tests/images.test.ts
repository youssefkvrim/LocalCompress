/**
 * Lossless images, proven with decoders that share no code with ours:
 * libjpeg-turbo (`djpeg`) for JPEG, ImageMagick for PNG. JPEG savings are
 * compared with the reference tool, `jpegtran -optimize -progressive`.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizeJpegLossless, sameCoefficients } from '../src/engines/jpeg';
import { recompressIdat } from '../src/engines/image';
import { fixture, fixtures, tool } from './helpers';

const tmp = mkdtempSync(join(tmpdir(), 'lci-'));
const hash = (cmd: string, args: string[]) => createHash('sha256').update(execFileSync(cmd, args, { maxBuffer: 1 << 30 })).digest('hex');
const jpegs = existsSync(join(fixtures, 'jpeg')) ? readdirSync(join(fixtures, 'jpeg')).filter((f) => f.endsWith('.jpg')) : [];

describe.skipIf(!jpegs.length || !tool('djpeg'))('lossless JPEG', () => {
  it.each(jpegs)('%s', (name) => {
    const path = join(fixtures, 'jpeg', name);
    const src = new Uint8Array(readFileSync(path));
    const r = optimizeJpegLossless(src, { stripMetadata: true })!;
    const out = join(tmp, name);
    writeFileSync(out, r.bytes);
    expect(sameCoefficients(src, r.bytes)).toBe(true);
    expect(hash('djpeg', ['-ppm', out])).toBe(hash('djpeg', ['-ppm', path]));
    expect(r.bytes.length).toBeLessThanOrEqual(src.length);
    if (tool('magick')) {
      const orientation = (f: string) => execFileSync('magick', ['identify', '-format', '%[orientation]', f]).toString();
      expect(orientation(out)).toBe(orientation(path));
    }
    if (tool('jpegtran')) {
      const ref = execFileSync('jpegtran', ['-optimize', '-progressive', '-copy', 'none', path]).length;
      expect(r.bytes.length).toBeLessThanOrEqual(ref * 1.002);
    }
  });
});

describe.skipIf(!tool('magick'))('lossless PNG', () => {
  it.each(['photo.png', 'screenshot.png'])('%s', async (name) => {
    const path = fixture(name);
    if (!path) return;
    const src = new Uint8Array(readFileSync(path));
    const out = (await recompressIdat(src, true))!;
    expect(out.length).toBeLessThan(src.length);
    const file = join(tmp, name);
    writeFileSync(file, out);
    expect(hash('magick', [file, '-depth', '16', 'rgba:-'])).toBe(hash('magick', [path, '-depth', '16', 'rgba:-']));
  });
});
