import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { readZip, rewriteZip, verifyZip, analyzeZip, type Out } from '@localcompress/archive';
import { sniff, refineZip } from '@localcompress/core';

class MemOut implements Out {
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

const text = (n: number) => strToU8('LocalCompress keeps the file on the workstation. '.repeat(n));

describe('zip rewrite', () => {
  it('recompresses stored/weakly deflated entries losslessly', async () => {
    const src = zipSync({
      'a.txt': [text(5000), { level: 0 }],
      'dir/b.txt': [text(3000), { level: 1 }],
      'dir/c.bin': [crypto.getRandomValues(new Uint8Array(50_000)), { level: 0 }],
      'empty/': new Uint8Array(0),
    });
    const blob = new Blob([src as BlobPart]);
    const archive = await readZip(blob);
    expect(archive.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt', 'dir/c.bin', 'empty/']);

    const analysis = await analyzeZip(blob, archive);
    expect(analysis.estimate).toBeLessThan(src.length);

    const out = new MemOut();
    const res = await rewriteZip(blob, archive, out);
    const outBlob = out.blob();
    expect(outBlob.size).toBeLessThan(src.length);

    const v = await verifyZip(outBlob, archive, res.changed);
    expect(v.problems).toEqual([]);
    expect(v.structureMatches).toBe(true);

    const original = unzipSync(src);
    const roundtrip = unzipSync(new Uint8Array(await outBlob.arrayBuffer()));
    for (const k of Object.keys(original)) expect(roundtrip[k]).toEqual(original[k]);
  });

  it('writes ZIP64 end records when there are more than 65535 entries', async () => {
    // Replicate one entry 70 000 times through our own writer.
    const small = zipSync({ 'x.txt': [text(10), { level: 0 }] });
    const blob = new Blob([small as BlobPart]);
    const archive = await readZip(blob);
    const one = archive.entries[0];
    archive.entries = Array.from({ length: 70_000 }, (_, i) => ({ ...one, index: i }));
    const out = new MemOut();
    await rewriteZip(blob, archive, out, { classify: () => 'verbatim' });
    const re = await readZip(out.blob());
    expect(re.zip64).toBe(true);
    expect(re.entries.length).toBe(70_000);
  });

  it('transforms selected entries and records them as changed', async () => {
    const src = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'ppt/media/a.bin': [text(100), { level: 0 }] });
    const blob = new Blob([src as BlobPart]);
    const archive = await readZip(blob);
    const out = new MemOut();
    const res = await rewriteZip(blob, archive, out, {
      classify: (e) => (e.name.startsWith('ppt/media/') ? 'transform' : 'recompress'),
      transform: async () => strToU8('smaller'),
    });
    expect(res.changed.size).toBe(1);
    const v = await verifyZip(out.blob(), archive, res.changed);
    expect(v.problems).toEqual([]);
    expect(unzipSync(new Uint8Array(await out.blob().arrayBuffer()))['ppt/media/a.bin']).toEqual(strToU8('smaller'));
  });

  it('rejects entries that lie about their size (bomb guard)', async () => {
    const src = zipSync({ 'bomb.txt': [new Uint8Array(1_000_000), { level: 9 }] });
    // Corrupt the declared uncompressed size in the central directory.
    const view = new DataView(src.buffer);
    for (let i = src.length - 22; i > 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1000, true);
        break;
      }
    }
    const blob = new Blob([src as BlobPart]);
    const archive = await readZip(blob);
    await expect(rewriteZip(blob, archive, new MemOut())).rejects.toThrow(/declared size|bomb/);
  });
});

describe('detection', () => {
  it('trusts bytes over extensions', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const d = sniff(png, 'photo.jpg');
    expect(d.format).toBe('png');
    expect(d.extensionMismatch).toBe(true);
  });
  it('recognises Office packages from the entry list', () => {
    const base = sniff(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'deck.pptx');
    const d = refineZip(base, ['[Content_Types].xml', 'ppt/presentation.xml'], 'deck.pptx');
    expect(d.kind).toBe('office');
    expect(d.format).toBe('pptx');
    const m = refineZip(base, ['[Content_Types].xml', 'xl/workbook.xml', 'xl/vbaProject.bin'], 'book.xlsx');
    expect(m.macroEnabled).toBe(true);
  });
});
