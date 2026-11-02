/**
 * The PDF workshop (fourth tab), shown in place of the drop zone once PDFs
 * are added: merge, split, organise, rotate, watermark. Each operation runs
 * in a fresh worker behind the egress guard (worker/pdfdesk.ts); the result
 * is reopened and checked there, then saved where the user chooses.
 */
import type { DeskReason, DeskReply, DeskRequest } from '../engines/pdftools';
import { categoryOf } from '../lib/detect';
import { safeName } from '../lib/names';
import { parseRanges } from '../lib/ranges';
import { categoryIcon, h, icon, replace } from './dom';
import { bytes, getLang, t } from './i18n';
import { saveAs, store } from './store';

type Tool = 'merge' | 'split' | 'organize' | 'rotate' | 'watermark';
type Key = Parameters<typeof t>[0];
const TOOLS: Tool[] = ['merge', 'split', 'organize', 'rotate', 'watermark'];
const THUMB = 150;
const SUFFIX: Record<Tool, [string, string]> = {
  merge: ['fusion', 'merged'],
  split: ['extrait', 'extract'],
  organize: ['organise', 'organised'],
  rotate: ['pivote', 'rotated'],
  watermark: ['filigrane', 'watermarked'],
};

interface DeskFile {
  id: string;
  file: File;
  pages?: number;
  reason?: DeskReason;
}
interface DeskPage {
  index: number;
  rotate: number;
  deleted: boolean;
}

export const desk = {
  files: [] as DeskFile[],
  tool: 'merge' as Tool,
  selected: '',
  pages: [] as DeskPage[],
  thumbs: [] as (string | undefined)[],
  thumbsFor: '',
  busy: false,
  progress: 0,
  status: '',
  error: false,
  split: 'each' as 'each' | 'ranges',
  ranges: '',
  angle: 90,
  wmText: 'CONFIDENTIEL',
  wmOpacity: 0.25,
  wmSize: 54,
};

/** Bumped on every change that needs the workshop drawn again (typing does not). */
let version = 0;
const changed = () => (version++, store.emit());
let thumbJob: { stop(): void } | null = null;
let barEl: HTMLElement | null = null;
const bar = () => barEl?.style.setProperty('--p', String(desk.progress));

const reasonKey = (r?: DeskReason): Key => (r === 'encrypted' ? 'pdf.encrypted' : r === 'invalid' ? 'pdf.invalid' : 'pdf.corrupt');
const selectedFile = () => desk.files.find((f) => f.id === desk.selected);
const usable = () => desk.files.filter((f) => f.pages && !f.reason);
const baseOf = (file: File) => safeName(file.name).replace(/\.[^.]*$/, '') || 'document';

/** One fresh worker per operation; its blocked requests are reported like the others. */
function call(req: DeskRequest, onThumb?: (index: number, blob: Blob) => void) {
  const worker = new Worker(new URL('../worker/pdfdesk.ts', import.meta.url), { type: 'module' });
  let stop = () => {};
  const promise = new Promise<Extract<DeskReply, { type: 'done' }>>((resolve, reject) => {
    stop = () => (worker.terminate(), reject(new Error('stopped')));
    worker.onmessage = ({ data: m }: MessageEvent<DeskReply>) => {
      if (m.type === 'net') store.net(m.entry);
      else if (m.type === 'thumb') onThumb?.(m.index, m.blob);
      else if (m.type === 'progress') (desk.progress = m.value), bar();
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m);
        else reject(Object.assign(new Error(m.message), { reason: m.reason }));
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      worker.terminate();
      reject(Object.assign(new Error(e.message), { reason: 'corrupt' }));
    };
  });
  worker.postMessage(req);
  return { promise, stop };
}

export function addPdfs(files: Iterable<File>) {
  let rejected = false;
  for (const file of files) {
    if (categoryOf(file.name) !== 'pdf') {
      rejected = true;
      continue;
    }
    const f: DeskFile = { id: crypto.randomUUID(), file };
    desk.files.push(f);
    if (!desk.selected) desk.selected = f.id;
    call({ op: 'info', file })
      .promise.then(
        (r) => (f.pages = r.pages),
        (e: { reason?: DeskReason }) => (f.reason = e.reason ?? 'corrupt'),
      )
      .finally(() => {
        if (f.id === desk.selected) resetPages();
        changed();
      });
  }
  desk.status = rejected ? t('pdf.onlyPdf') : '';
  desk.error = rejected;
  changed();
}

function resetPages() {
  thumbJob?.stop();
  thumbJob = null;
  desk.thumbs.forEach((u) => u && URL.revokeObjectURL(u));
  desk.thumbs = [];
  desk.thumbsFor = '';
  const f = selectedFile();
  desk.pages = f?.pages ? Array.from({ length: f.pages }, (_, index) => ({ index, rotate: 0, deleted: false })) : [];
  loadThumbs();
}

/** Page pictures for the Organise view, drawn one by one in a worker, put in place as they arrive. */
function loadThumbs() {
  const f = selectedFile();
  if (desk.tool !== 'organize' || !f?.pages || f.reason || desk.thumbsFor === f.id) return;
  desk.thumbsFor = f.id;
  const job = call({ op: 'thumbs', file: f.file, width: THUMB }, (index, blob) => {
    if (desk.selected !== f.id) return;
    const url = (desk.thumbs[index] = URL.createObjectURL(blob));
    for (const img of document.querySelectorAll<HTMLImageElement>(`img[data-thumb="${index}"]`)) img.src = url;
  });
  thumbJob = job;
  job.promise.catch(() => {}).finally(() => thumbJob === job && (thumbJob = null));
}

function select(id: string) {
  if (desk.selected === id || desk.busy) return;
  desk.selected = id;
  resetPages();
  changed();
}

function removeFile(id: string) {
  desk.files = desk.files.filter((f) => f.id !== id);
  if (desk.selected === id) {
    desk.selected = desk.files[0]?.id ?? '';
    resetPages();
  }
  changed();
}

function clearDesk() {
  desk.files = [];
  desk.selected = '';
  desk.status = '';
  desk.error = false;
  resetPages();
  changed();
}

function moveFile(i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= desk.files.length) return;
  [desk.files[i], desk.files[j]] = [desk.files[j], desk.files[i]];
  changed();
}

function movePage(from: number, to: number) {
  if (to < 0 || to >= desk.pages.length || from === to) return;
  const [page] = desk.pages.splice(from, 1);
  desk.pages.splice(to, 0, page);
  changed();
}

async function apply() {
  if (desk.busy) return;
  const fail = (key: Key) => ((desk.status = t(key)), (desk.error = true), changed());
  const suffix = SUFFIX[desk.tool][getLang() === 'fr' ? 0 : 1];
  let req: DeskRequest;
  let name: string;
  if (desk.tool === 'merge') {
    const files = usable();
    if (files.length < 2) return fail('pdf.mergeNeed');
    req = { op: 'merge', files: files.map((x) => x.file) };
    name = `${baseOf(files[0].file)}-${suffix}.pdf`;
  } else {
    const f = selectedFile();
    if (!f?.pages || f.reason) return fail(f?.reason ? reasonKey(f.reason) : 'pdf.selectHint');
    name = `${baseOf(f.file)}-${suffix}.pdf`;
    if (desk.tool === 'split') {
      const groups = desk.split === 'each' ? Array.from({ length: f.pages }, (_, i) => [i]) : parseRanges(desk.ranges, f.pages);
      if (!groups) return fail('pdf.badRanges');
      req = { op: 'split', file: f.file, groups, base: baseOf(f.file) };
      if (groups.length > 1) name = `${baseOf(f.file)}-pages.zip`;
    } else if (desk.tool === 'organize') {
      const kept = desk.pages.filter((p) => !p.deleted);
      if (!kept.length) return fail('pdf.nothingLeft');
      req = { op: 'organize', file: f.file, pages: kept.map(({ index, rotate }) => ({ index, rotate })) };
    } else if (desk.tool === 'rotate') {
      req = { op: 'rotate', file: f.file, angle: desk.angle };
    } else {
      if (!desk.wmText.trim()) return fail('pdf.wmEmpty');
      req = { op: 'watermark', file: f.file, text: desk.wmText, opacity: desk.wmOpacity, size: desk.wmSize };
    }
  }

  desk.busy = true;
  desk.progress = 0;
  desk.error = false;
  desk.status = t('pdf.working');
  changed();
  try {
    const r = await call(req).promise;
    desk.status = (await saveAs(r.blob!, name)) ? t('pdf.done') : '';
  } catch (e) {
    desk.status = t(reasonKey((e as { reason?: DeskReason }).reason));
    desk.error = true;
  } finally {
    desk.busy = false;
    changed();
  }
}

/** The workshop's element; redrawn only when something it shows has changed. */
export function createDesk(pick: () => void) {
  const el = h('div', { class: 'desk' });
  let shown = -1;
  const render = () => {
    if (shown === version) return;
    shown = version;
    replace(el, build(pick));
  };
  return { el, render };
}

function build(pick: () => void) {
  const head = h(
    'div',
    { class: 'bench-head' },
    h('b', { class: 'bench-name' }, t('task.pdf')),
    h('span', { class: 'editor-spacer' }),
    h('button', { class: 'btn small ghost', type: 'button', disabled: desk.busy, onclick: pick }, icon.plus(), t('pdf.add')),
    h('button', { class: 'btn small ghost', type: 'button', disabled: desk.busy, onclick: clearDesk }, t('pdf.clear')),
  );
  const tools = h(
    'div',
    { class: 'seg desk-tools', role: 'radiogroup' },
    ...TOOLS.map((tool) =>
      h(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: tool === desk.tool ? 'on' : '',
          'aria-checked': String(tool === desk.tool),
          disabled: desk.busy,
          onclick: () => ((desk.tool = tool), (desk.status = ''), (desk.error = false), loadThumbs(), changed()),
        },
        t(`pdf.tool.${tool}`),
      ),
    ),
  );
  barEl = h('div', { class: 'bench-bar desk-bar', hidden: !desk.busy });
  bar();
  const foot = h(
    'div',
    { class: 'desk-foot' },
    h('p', { class: `desk-status${desk.error ? ' bad' : ''}`, role: 'status' }, desk.status),
    barEl,
    h('button', { class: 'btn', type: 'button', disabled: desk.busy || !usable().length, onclick: () => void apply() }, icon.down(), t('pdf.apply')),
  );
  return h(
    'div',
    { class: 'bench desk-sheet' },
    head,
    h('div', { class: 'desk-body' }, h('ul', { class: 'desk-files' }, ...desk.files.map(fileRow)), tools, options(), foot),
  );
}

function fileRow(f: DeskFile, i: number) {
  const merge = desk.tool === 'merge';
  const meta = f.reason ? t(reasonKey(f.reason)) : f.pages === undefined ? t('pdf.reading') : `${f.pages} page${f.pages > 1 ? 's' : ''} · ${bytes(f.file.size)}`;
  const row = h(
    'li',
    { class: `desk-file${!merge && f.id === desk.selected ? ' on' : ''}${f.reason ? ' bad' : ''}${merge ? '' : ' selectable'}` },
    h('span', { class: 'row-icon' }, categoryIcon.pdf()),
    h('span', { class: 'desk-name' }, h('b', { title: safeName(f.file.name) }, safeName(f.file.name)), h('small', null, meta)),
    merge ? tool('↑', 'pdf.moveUp', () => moveFile(i, -1), i === 0) : null,
    merge ? tool('↓', 'pdf.moveDown', () => moveFile(i, 1), i === desk.files.length - 1) : null,
    h('button', { class: 'icon-btn', type: 'button', title: t('remove'), 'aria-label': t('remove'), disabled: desk.busy, onclick: () => removeFile(f.id) }, icon.close()),
  );
  if (!merge) row.addEventListener('click', (e) => !(e.target as Element).closest('button') && select(f.id));
  return row;
}

const tool = (label: string, key: Key, onclick: () => void, disabled = false) =>
  h('button', { class: 'icon-btn desk-glyph', type: 'button', title: t(key), 'aria-label': t(key), disabled: disabled || desk.busy, onclick }, label);

function seg<T extends string | number>(items: [T, string][], current: T, set: (v: T) => void) {
  return h(
    'div',
    { class: 'seg mini-text', role: 'radiogroup' },
    ...items.map(([v, label]) => h('button', { type: 'button', role: 'radio', class: v === current ? 'on' : '', 'aria-checked': String(v === current), onclick: () => (set(v), changed()) }, label)),
  );
}

function options() {
  const box = (hint: Key, ...content: (Node | null)[]) => h('div', { class: 'desk-options' }, ...content, h('p', { class: 'hint' }, t(hint)));
  if (desk.tool === 'merge') return box('pdf.mergeHint');
  if (desk.tool === 'organize') return box('pdf.organizeHint', grid());
  if (desk.tool === 'rotate')
    return box('pdf.rotateHint', seg<number>([[90, '90° ↻'], [180, '180°'], [270, '90° ↺']], desk.angle, (v) => (desk.angle = v)));
  if (desk.tool === 'split') {
    const input = h('input', { class: 'unlock-input', type: 'text', value: desk.ranges, placeholder: t('pdf.rangesPlaceholder'), 'aria-label': t('pdf.splitRanges'), hidden: desk.split !== 'ranges' }) as HTMLInputElement;
    input.addEventListener('input', () => (desk.ranges = input.value));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && void apply());
    return box(
      'pdf.splitHint',
      seg<'each' | 'ranges'>([['each', t('pdf.splitEach')], ['ranges', t('pdf.splitRanges')]], desk.split, (v) => (desk.split = v)),
      input,
    );
  }
  const text = h('input', { class: 'unlock-input', type: 'text', value: desk.wmText, maxlength: 120, 'aria-label': t('pdf.wmText') }) as HTMLInputElement;
  text.addEventListener('input', () => (desk.wmText = text.value));
  const opacity = h('input', { type: 'range', min: 0.05, max: 0.6, step: 0.05, value: desk.wmOpacity, 'aria-label': t('pdf.wmOpacity') }) as HTMLInputElement;
  opacity.addEventListener('input', () => (desk.wmOpacity = Number(opacity.value)));
  return box(
    'pdf.wmHint',
    h('label', { class: 'desk-field' }, h('span', null, t('pdf.wmText')), text),
    h('label', { class: 'desk-field editor-range' }, h('span', null, t('pdf.wmOpacity')), opacity),
    h('div', { class: 'desk-field' }, h('span', null, t('pdf.wmSize')), seg<number>([[36, t('pdf.wmSmall')], [54, t('pdf.wmMedium')], [80, t('pdf.wmLarge')]], desk.wmSize, (v) => (desk.wmSize = v))),
  );
}

/** Organise: one card per page, dragged to reorder, turned or set aside. */
function grid() {
  const f = selectedFile();
  if (!f?.pages) return h('p', { class: 'hint' }, f?.reason ? t(reasonKey(f.reason)) : t('pdf.reading'));
  let dragFrom = -1;
  return h(
    'ol',
    { class: 'desk-pages' },
    ...desk.pages.map((p, pos) => {
      const img = h('img', { alt: '', decoding: 'async', draggable: 'false', 'data-thumb': p.index }) as HTMLImageElement;
      const url = desk.thumbs[p.index];
      if (url) img.src = url;
      img.style.transform = `rotate(${p.rotate}deg)`;
      const card = h(
        'li',
        { class: `desk-page${p.deleted ? ' off' : ''}`, draggable: 'true' },
        h('div', { class: 'desk-thumb' }, img),
        h('span', { class: 'desk-num' }, String(p.index + 1)),
        h(
          'div',
          { class: 'desk-page-tools' },
          tool('↺', 'pdf.rotateLeft', () => ((p.rotate = (p.rotate + 270) % 360), changed())),
          tool('↻', 'pdf.rotateRight', () => ((p.rotate = (p.rotate + 90) % 360), changed())),
          tool('←', 'pdf.moveUp', () => movePage(pos, pos - 1), pos === 0),
          tool('→', 'pdf.moveDown', () => movePage(pos, pos + 1), pos === desk.pages.length - 1),
          tool(p.deleted ? '↩' : '✕', p.deleted ? 'pdf.restore' : 'pdf.delete', () => ((p.deleted = !p.deleted), changed())),
        ),
      );
      card.addEventListener('dragstart', (e) => ((dragFrom = pos), e.dataTransfer?.setData('text/plain', String(pos)), card.classList.add('dragging')));
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => dragFrom >= 0 && e.preventDefault());
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragFrom >= 0) movePage(dragFrom, pos);
        dragFrom = -1;
      });
      return card;
    }),
  );
}
