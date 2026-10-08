#!/usr/bin/env node
/**
 * Generate synthetic, non-sensitive test fixtures into tests/fixtures/.
 * Never commit real Safran documents as fixtures.
 *
 *   npm run fixtures
 *
 * Requires ffmpeg on PATH for the media fixtures.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const out = join(import.meta.dirname, '..', 'tests', 'fixtures');
mkdirSync(out, { recursive: true });
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const p = (f) => join(out, f);

// ── Images ──────────────────────────────────────────────────────────────
// Photographic-looking content: mandelbrot + film grain, saved at very high quality.
ff('-f', 'lavfi', '-i', 'mandelbrot=s=4000x3000', '-vf', 'noise=alls=12:allf=t', '-frames:v', '1', '-q:v', '1', '-metadata', 'comment=fixture', p('photo.jpg'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', p('screenshot.png'));
ff('-f', 'lavfi', '-i', 'mandelbrot=s=1600x1200', '-vf', 'noise=alls=8:allf=t', '-frames:v', '1', p('photo.png'));

// JPEG variants for the lossless optimiser (baseline 4:2:0 / 4:4:4 odd size / grey / 4:2:2).
mkdirSync(p('jpeg'), { recursive: true });
ff('-f', 'lavfi', '-i', 'mandelbrot=s=1600x1200', '-vf', 'noise=alls=10:allf=t', '-frames:v', '1', '-q:v', '3', '-huffman', 'default', p('jpeg/base-420.jpg'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=1023x767', '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj444p', '-huffman', 'default', p('jpeg/odd-444.jpg'));
ff('-f', 'lavfi', '-i', 'mandelbrot=s=800x600', '-vf', 'format=gray', '-frames:v', '1', '-q:v', '4', p('jpeg/gray.jpg'));
ff('-f', 'lavfi', '-i', 'testsrc2=s=1280x720', '-frames:v', '1', '-q:v', '2', '-pix_fmt', 'yuvj422p', '-huffman', 'default', p('jpeg/r422.jpg'));
try {
  // Progressive and restart-marker inputs, when libjpeg-turbo tools are installed.
  writeFileSync(p('jpeg/prog-in.jpg'), execFileSync('jpegtran', ['-progressive', p('jpeg/base-420.jpg')]));
  const ppm = execFileSync('djpeg', ['-ppm', p('jpeg/r422.jpg')], { maxBuffer: 1 << 28 });
  writeFileSync(p('jpeg/restart.jpg'), execFileSync('cjpeg', ['-quality', '88', '-restart', '3', '-sample', '1x1'], { input: ppm, maxBuffer: 1 << 28 }));
} catch {
  console.log('jpegtran/cjpeg not found, progressive and restart fixtures skipped');
}

// ── Video ───────────────────────────────────────────────────────────────
ff(
  '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
  '-vf', 'noise=alls=6:allf=t',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '256k',
  '-metadata', 'location=+48.8566+002.3522/', '-metadata', 'artist=Fixture Author',
  '-movflags', '+faststart', p('clip.mp4'),
);

// ── PDF with embedded images ────────────────────────────────────────────
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(readFileSync(p('photo.jpg')));
  const png = await doc.embedPng(readFileSync(p('photo.png')));
  for (let i = 0; i < 4; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`LocalCompress fixture, page ${i + 1}`, { x: 50, y: 790, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
    page.drawImage(i % 2 ? png : jpg, { x: 50, y: 300, width: 495, height: 371 });
  }
  doc.setAuthor('Fixture Author');
  doc.setProducer('LocalCompress fixtures');
  writeFileSync(p('report.pdf'), await doc.save({ useObjectStreams: false }));
}

// ── Office packages (minimal but structurally complete) ─────────────────
const CT = (main, extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>${main}${extra}</Types>`;
const REL = (rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture</dc:title><dc:creator>Fixture Author</dc:creator><cp:lastModifiedBy>Fixture Editor</cp:lastModifiedBy></cp:coreProperties>`;
const filler = (n) => '<a:p><a:r><a:t>' + 'Confidential fixture text. '.repeat(n) + '</a:t></a:r></a:p>';

writeFileSync(
  p('deck.pptx'),
  zipSync({
    '[Content_Types].xml': strToU8(CT('<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>')),
    '_rels/.rels': strToU8(REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>')),
    'docProps/core.xml': strToU8(core),
    'ppt/presentation.xml': strToU8('<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
    'ppt/_rels/presentation.xml.rels': strToU8(REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>')),
    'ppt/slides/slide1.xml': [strToU8(`<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${filler(400)}</p:sld>`), { level: 1 }],
    'ppt/slides/_rels/slide1.xml.rels': strToU8(REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://intranet.example/" TargetMode="External"/>')),
    'ppt/media/image1.jpeg': [readFileSync(p('photo.jpg')), { level: 0 }],
    'ppt/media/image2.png': [readFileSync(p('photo.png')), { level: 0 }],
  }),
);

writeFileSync(
  p('macro.xlsm'),
  zipSync({
    '[Content_Types].xml': strToU8(CT('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>', '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>')),
    '_rels/.rels': strToU8(REL('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>')),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
    'xl/_rels/workbook.xml.rels': strToU8(REL('<Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/>')),
    'xl/vbaProject.bin': [new Uint8Array(4096).fill(7), { level: 0 }],
    'xl/media/image1.jpeg': [readFileSync(p('photo.jpg')), { level: 0 }],
  }),
);

// ── ZIP archives ────────────────────────────────────────────────────────
const csv = (rows) => strToU8('id,timestamp,sensor,value\n' + Array.from({ length: rows }, (_, i) => `${i},2026-10-08T10:${String(i % 60).padStart(2, '0')}:00Z,S${i % 17},${(Math.sin(i) * 100).toFixed(4)}`).join('\n'));
writeFileSync(p('logs-stored.zip'), zipSync({ 'data/measurements.csv': [csv(200_000), { level: 0 }], 'data/notes.txt': [strToU8('note\n'.repeat(50_000)), { level: 0 }], 'img/photo.jpg': [readFileSync(p('photo.jpg')), { level: 0 }] }));
writeFileSync(p('already-compressed.zip'), zipSync({ 'data/measurements.csv': [csv(200_000), { level: 9 }], 'img/photo.jpg': [readFileSync(p('photo.jpg')), { level: 6 }] }));

console.log(`Fixtures written to ${out}`);
