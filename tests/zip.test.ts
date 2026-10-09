import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { readLocal, readZip, unsafeName } from '../src/lib/zip';
import { Skip } from '../src/lib/types';
import { rewrite, verify } from '../src/engines/zip';
import { imageSize, office, sniff } from '../src/lib/detect';
import { memoryCost } from '../src/lib/cost';
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
  it('reads image dimensions from the header and costs a file by its pixels', async () => {
    const path = fixture('photo.png');
    if (!path) return;
    const png = new Uint8Array(readFileSync(path));
    expect(imageSize(png, 'png')).toEqual({ width: 1600, height: 1200, animated: false });
    // A 4 MB file that decodes to 1.9 megapixels costs far more than its size.
    expect(await memoryCost(new File([png], 'x.png'))).toBeGreaterThan(1600 * 1200 * 16);
    expect(await memoryCost(new File([new Uint8Array(10)], 'x.bin'))).toBe(20);
  });
  it('recognises Office packages', () => {
    expect(office(['[Content_Types].xml', 'ppt/presentation.xml'])).toEqual({ ext: 'pptx', macro: false });
    expect(office(['[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin'])).toEqual({ ext: 'xlsm', macro: true });
    expect(office(['a.txt'])).toBeNull();
  });
});

describe('dangerous or ambiguous names', () => {
  it.each(['/etc/passwd', '\\server\\x', 'C:/Windows/x.dll', '../up.txt', 'a/../../up.txt', 'NUL', 'nul.txt', 'd/CON.docx', 'com1', 'LPT9.log', 'file.', 'dir /x.txt', 'a.txt:hidden', 'x\u0001y'])('refuses %j', (name) => {
    expect(unsafeName(name)).toBe(true);
  });
  it.each(['a.txt', 'dossier/', 'dossier/sous dossier/b.pdf', './a.txt', 'console.log', 'nullable.txt', 'com10.txt', '.gitignore', 'Été 2026/photo.jpg'])('accepts %j', (name) => {
    expect(unsafeName(name)).toBe(false);
  });

  it('flags names that collide once case or Unicode form are ignored', async () => {
    const nfc = 'Été.txt';
    const nfd = nfc.normalize('NFD');
    const archive = await readZip(new Blob([zipSync({ 'Rapport.txt': text(1), 'rapport.TXT': text(1), [nfc]: text(1), [nfd]: text(1), 'ok.txt': text(1) }) as BlobPart]));
    expect(archive.entries.map((e) => e.unsafe)).toEqual([true, true, true, true, false]);
  });

  it('refuses an entry whose local name differs from the directory', async () => {
    const src = zipSync({ 'a.txt': [text(1), { level: 0 }] });
    expect(String.fromCharCode(src[30])).toBe('a');
    src[30] = 'b'.charCodeAt(0); // the local header now says "b.txt"
    const blob = new Blob([src as BlobPart]);
    const [entry] = (await readZip(blob)).entries;
    await expect(readLocal(blob, entry)).rejects.toBeInstanceOf(Skip);
  });
});
