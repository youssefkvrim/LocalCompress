import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { readZip } from '../src/lib/zip';
import { rewrite, verify } from '../src/engines/zip';
import { office, sniff } from '../src/lib/detect';
import { Memory, fixture, tool } from './helpers';

const text = (n: number) => strToU8('LocalCompress keeps the file on the workstation. '.repeat(n));
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('zip', () => {
  it('recompresses losslessly and keeps the structure', async () => {
    const src = zipSync({ 'a.txt': [text(5000), { level: 0 }], 'd/b.txt': [text(3000), { level: 1 }], 'd/r.bin': [crypto.getRandomValues(new Uint8Array(50_000)), { level: 0 }], 'empty/': new Uint8Array(0) });
    const blob = new Blob([src as BlobPart]);
    const archive = await readZip(blob);
    const out = new Memory();
    const changed = await rewrite(blob, archive, out);
    expect(out.position).toBeLessThan(src.length);
    expect(await verify(out.blob(), archive, changed)).toEqual([]);
    const a = unzipSync(src);
    const b = unzipSync(await bytes(out.blob()));
    for (const k of Object.keys(a)) expect(b[k]).toEqual(a[k]);
  });

  it('writes ZIP64 end records above 65 535 entries', async () => {
    const blob = new Blob([zipSync({ 'x.txt': [text(10), { level: 0 }] }) as BlobPart]);
    const archive = await readZip(blob);
    archive.entries = Array.from({ length: 70_000 }, (_, i) => ({ ...archive.entries[0], index: i }));
    const out = new Memory();
    await rewrite(blob, archive, out, { policy: () => 'copy' });
    expect((await readZip(out.blob())).entries.length).toBe(70_000);
  });

  it('applies transforms and records them', async () => {
    const blob = new Blob([zipSync({ 'm/a.bin': [text(100), { level: 0 }], 'b.txt': text(10) }) as BlobPart]);
    const archive = await readZip(blob);
    const out = new Memory();
    const changed = await rewrite(blob, archive, out, { policy: (e) => (e.name.startsWith('m/') ? 'transform' : 'pack'), transform: async () => strToU8('new') });
    expect([...changed]).toEqual([0]);
    expect(await verify(out.blob(), archive, changed)).toEqual([]);
    expect(unzipSync(await bytes(out.blob()))['m/a.bin']).toEqual(strToU8('new'));
  });

  it('rejects entries lying about their size (zip bomb)', async () => {
    const src = zipSync({ 'bomb.txt': [new Uint8Array(1_000_000), { level: 9 }] });
    const v = new DataView(src.buffer);
    for (let i = src.length - 22; i > 0; i--) if (v.getUint32(i, true) === 0x02014b50) (v.setUint32(i + 24, 1000, true), (i = 0));
    const blob = new Blob([src as BlobPart]);
    await expect(rewrite(blob, await readZip(blob), new Memory())).rejects.toThrow(/declared size|corrupt/);
  });

  it.each(['logs-stored.zip', 'already-compressed.zip', 'deck.pptx', 'macro.xlsm'])('%s passes unzip -t and Python zipfile', async (name) => {
    const path = fixture(name);
    if (!path) return;
    const blob = new Blob([readFileSync(path)]);
    const archive = await readZip(blob);
    const out = new Memory();
    await rewrite(blob, archive, out);
    const tmp = join(mkdtempSync(join(tmpdir(), 'lc-')), name);
    writeFileSync(tmp, await bytes(out.blob()));
    if (tool('unzip')) expect(execFileSync('unzip', ['-tqq', tmp]).toString()).toBe('');
    const py = 'import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1]);print(z.testzip() or "ok", len(z.infolist()))';
    expect(execFileSync('python3', ['-c', py, tmp]).toString().trim()).toBe(`ok ${archive.entries.length}`);
  });
});

describe('detection', () => {
  it('reads bytes, not extensions', () => {
    expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).format).toBe('png');
    expect(sniff(strToU8('%PDF-1.7')).kind).toBe('pdf');
  });
  it('recognises Office packages', () => {
    expect(office(['[Content_Types].xml', 'ppt/presentation.xml'])).toEqual({ ext: 'pptx', macro: false });
    expect(office(['[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin'])).toEqual({ ext: 'xlsm', macro: true });
    expect(office(['a.txt'])).toBeNull();
  });
});
