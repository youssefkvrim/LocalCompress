/**
 * Rewrites real fixture archives and checks the result with tools that
 * share no code with LocalCompress (Info-ZIP `unzip -t`, Python zipfile).
 * Run `node scripts/make-fixtures.mjs` first; skipped when fixtures are absent.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readZip, rewriteZip, verifyZip, type Out } from '@localcompress/archive';

const dir = join(import.meta.dirname, '..', 'fixtures');
const has = (cmd: string) => {
  try {
    execFileSync(cmd, ['-h'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

class MemOut implements Out {
  position = 0;
  parts: Uint8Array[] = [];
  write(d: Uint8Array) {
    this.parts.push(d.slice());
    this.position += d.length;
  }
}

describe.each(['logs-stored.zip', 'already-compressed.zip', 'deck.pptx', 'macro.xlsm'])('%s', (name) => {
  const path = join(dir, name);
  it.skipIf(!existsSync(path))('rewrites losslessly and passes independent verifiers', async () => {
    const blob = new Blob([readFileSync(path)]);
    const archive = await readZip(blob);
    const out = new MemOut();
    const res = await rewriteZip(blob, archive, out);
    const result = new Blob(out.parts as BlobPart[]);
    expect(result.size).toBeLessThanOrEqual(blob.size);
    const v = await verifyZip(result, archive, res.changed);
    expect(v.problems).toEqual([]);

    const tmp = join(mkdtempSync(join(tmpdir(), 'lc-')), name);
    writeFileSync(tmp, new Uint8Array(await result.arrayBuffer()));
    if (has('unzip')) expect(execFileSync('unzip', ['-tqq', tmp]).toString()).toBe('');
    const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1]);bad=z.testzip();print(bad or 'ok', len(z.infolist()))`;
    expect(execFileSync('python3', ['-c', py, tmp]).toString().trim()).toBe(`ok ${archive.entries.length}`);
  });
});
