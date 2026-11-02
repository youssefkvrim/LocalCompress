import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { run, type DeskReply, type DeskRequest } from '../src/engines/pdftools';
import { readZip } from '../src/lib/zip';

async function makePdf(pages: number, name = 'doc.pdf') {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  return new File([(await doc.save()) as BlobPart], name, { type: 'application/pdf' });
}

async function exec(req: DeskRequest) {
  const r = await run(req, () => {});
  if (r.type !== 'done') throw new Error('not done');
  return r;
}

const open = async (r: DeskReply & { type: 'done' }) => PDFDocument.load(new Uint8Array(await r.blob!.arrayBuffer()));

describe('PDF workshop', () => {
  it('counts pages', async () => {
    expect((await exec({ op: 'info', file: await makePdf(4) })).pages).toBe(4);
  });

  it('merges in order', async () => {
    const r = await exec({ op: 'merge', files: [await makePdf(2), await makePdf(3)] });
    const doc = await open(r);
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(2).getWidth()).toBe(200);
  });

  it('splits into a ZIP of PDFs, or a single PDF for one range', async () => {
    const file = await makePdf(5);
    const zip = await exec({ op: 'split', file, groups: [[0, 1], [4]], base: 'doc' });
    expect(zip.ext).toBe('zip');
    const names = (await readZip(new File([zip.blob!], 'x.zip'))).entries.map((e) => e.name);
    expect(names).toEqual(['doc-01.pdf', 'doc-02.pdf']);
    const one = await exec({ op: 'split', file, groups: [[2, 3]], base: 'doc' });
    expect(one.ext).toBe('pdf');
    expect((await open(one)).getPageCount()).toBe(2);
  });

  it('reorders, rotates and removes pages', async () => {
    const r = await exec({ op: 'organize', file: await makePdf(3), pages: [{ index: 2, rotate: 90 }, { index: 0, rotate: 0 }] });
    const doc = await open(r);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getWidth()).toBe(202);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
  });

  it('rotates every page and adds a watermark', async () => {
    const rotated = await open(await exec({ op: 'rotate', file: await makePdf(2), angle: 270 }));
    expect(rotated.getPages().map((p) => p.getRotation().angle)).toEqual([270, 270]);
    const marked = await open(await exec({ op: 'watermark', file: await makePdf(2), text: 'CONFIDENTIEL – C2 ’', opacity: 0.3, size: 54 }));
    expect(marked.getPageCount()).toBe(2);
  });

  it('refuses pages that do not exist and unreadable files', async () => {
    await expect(run({ op: 'organize', file: await makePdf(2), pages: [{ index: 5, rotate: 0 }] }, () => {})).rejects.toMatchObject({ reason: 'invalid' });
    await expect(run({ op: 'info', file: new File(['not a pdf'], 'x.pdf') }, () => {})).rejects.toMatchObject({ reason: 'corrupt' });
  });
});
