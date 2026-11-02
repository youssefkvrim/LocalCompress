/**
 * Touch-up of a background removal, shown in place of the drop zone: the
 * cut-out on a checkerboard, a brush to Erase / Restore, zoom and pan,
 * compare with the original, undo. A button makes it full screen.
 *
 * The corrected mask is applied (PNG rebuilt at full size from the original
 * pixels) when the picture is saved, when another one is shown, or when it
 * leaves the screen: store.commits holds that step.
 *
 * UI code only: canvases and the browser's PNG encoder, no engine, no WASM.
 */
import { h, icon, replace } from './dom';
import { automaticFile, fileOf, pictureOf, store, type Item } from './store';
import { reasonText, t } from './i18n';

type Tool = 'erase' | 'restore' | 'move';
type Backdrop = 'checker' | 'white' | 'dark';

/** Undo levels kept, within about this much memory. */
const UNDO_BYTES = 400 << 20;

export interface Editor {
  el: HTMLElement;
  /** Apply pending touch-ups to the item (no-op when there are none). */
  commit(): Promise<void>;
  /** Apply, then free everything. */
  dispose(): Promise<void>;
}

export function createEditor(item: Item): Editor {
  const canvas = h('canvas', { class: 'editor-canvas' }) as HTMLCanvasElement;
  const loading = h('p', { class: 'editor-loading', role: 'status' }, t('edit.loading'));
  const stage = h('div', { class: 'editor-stage checker' }, canvas, loading);
  const toolsSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('edit.title') });
  const size = h('input', { type: 'range', min: 4, max: 300, value: 50, 'aria-label': t('edit.size') }) as HTMLInputElement;
  const soft = h('input', { type: 'range', min: 0, max: 100, value: 40, 'aria-label': t('edit.hardness') }) as HTMLInputElement;
  const button = (ic: () => SVGElement, label: string) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label }, ic()) as HTMLButtonElement;
  const undoBtn = button(icon.undo, `${t('edit.undo')} (Ctrl+Z)`);
  const redoBtn = button(icon.redo, `${t('edit.redo')} (Ctrl+Y)`);
  const resetBtn = button(icon.reset, t('edit.reset'));
  const zoomOut = button(icon.minus, t('edit.zoomOut'));
  const zoomIn = button(icon.plus, t('edit.zoomIn'));
  const fitBtn = button(icon.fit, t('edit.fit'));
  const fullBtn = button(icon.expand, t('edit.full'));
  const compareBtn = h('button', { class: 'btn small ghost', type: 'button', title: t('edit.compare') }, icon.eye(), t('edit.original')) as HTMLButtonElement;
  const backdrops = h('div', { class: 'seg mini', role: 'radiogroup', 'aria-label': t('edit.bg') });
  const help = h('p', { class: 'editor-help' });
  const el = h(
    'div',
    { class: 'editor', 'aria-label': t('edit.title') },
    h(
      'div',
      { class: 'editor-tools' },
      toolsSeg,
      h('label', { class: 'editor-range' }, h('span', null, t('edit.size')), size),
      h('label', { class: 'editor-range' }, h('span', null, t('edit.hardness')), soft),
      h('span', { class: 'editor-group' }, undoBtn, redoBtn, resetBtn),
      h('span', { class: 'editor-group' }, zoomOut, zoomIn, fitBtn),
      backdrops,
      compareBtn,
      h('span', { class: 'editor-spacer' }),
      fullBtn,
    ),
    stage,
    help,
  );

  // ── State ────────────────────────────────────────────────────────────────
  let original: ImageBitmap | null = null;
  let mask: OffscreenCanvas | null = null; // white, alpha = what is kept
  let mctx: OffscreenCanvasRenderingContext2D | null = null;
  const comp = document.createElement('canvas'); // the cut-out at screen size
  const cctx = comp.getContext('2d')!;
  const ctx = canvas.getContext('2d')!;
  let W = 0;
  let H = 0;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let fitted = true;
  let tool: Tool = 'erase';
  let backdrop: Backdrop = 'checker';
  let comparing = false;
  let spaceDown = false;
  let hovered = false;
  let full = false;
  let pointer: { x: number; y: number } | null = null;
  let dirty = false;
  let disposed = false;
  const undo: OffscreenCanvas[] = [];
  const redo: OffscreenCanvas[] = [];
  let levels = 10;
  let frame = 0;

  const dpr = () => window.devicePixelRatio || 1;
  const radius = () => ((Number(size.value) / 2) * dpr()) / scale; // in picture pixels

  const setTool = (v: Tool) => ((tool = v), renderTools(), draw());
  function renderTools() {
    const opts: [Tool, string, () => SVGElement][] = [
      ['erase', `${t('edit.erase')} (E)`, icon.eraser],
      ['restore', `${t('edit.restore')} (R)`, icon.brush],
      ['move', `${t('edit.move')} (H)`, icon.hand],
    ];
    replace(toolsSeg, ...opts.map(([v, label, ic]) => h('button', { type: 'button', role: 'radio', class: v === tool ? 'on' : '', 'aria-checked': String(v === tool), title: label, onclick: () => setTool(v) }, ic(), label.replace(/ \(.\)$/, ''))));
    const bgs: [Backdrop, string][] = [['checker', '▦'], ['white', '□'], ['dark', '■']];
    replace(
      backdrops,
      ...bgs.map(([v, label]) => h('button', { type: 'button', role: 'radio', class: v === backdrop ? 'on' : '', 'aria-checked': String(v === backdrop), title: t('edit.bg'), onclick: () => ((backdrop = v), (stage.className = `editor-stage ${v === 'checker' ? 'checker' : v} ready`), renderTools()) }, label)),
    );
    undoBtn.disabled = !undo.length;
    redoBtn.disabled = !redo.length;
    canvas.dataset.tool = spaceDown ? 'move' : tool;
    replace(fullBtn, full ? icon.shrink() : icon.expand());
    fullBtn.title = fullBtn.ariaLabel = t(full ? 'edit.exitFull' : 'edit.full');
    help.textContent = t(full ? 'edit.helpFull' : 'edit.help');
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  async function load() {
    renderTools();
    original = await createImageBitmap(pictureOf(item), { imageOrientation: 'from-image' });
    if (disposed) return void original.close();
    W = original.width;
    H = original.height;
    levels = Math.max(3, Math.min(20, Math.floor(UNDO_BYTES / (W * H * 4))));
    mask = new OffscreenCanvas(W, H);
    mctx = mask.getContext('2d')!;
    await fillMask(await fileOf(item));
    stage.classList.add('ready');
    resize();
    renderTools();
  }

  /** The alpha of a cut-out PNG becomes the mask (white, same alpha). */
  async function fillMask(png: Blob) {
    const bmp = await createImageBitmap(png, { premultiplyAlpha: 'none' });
    mctx!.globalCompositeOperation = 'copy';
    mctx!.drawImage(bmp, 0, 0, W, H);
    bmp.close();
    mctx!.globalCompositeOperation = 'source-in';
    mctx!.fillStyle = '#fff';
    mctx!.fillRect(0, 0, W, H);
    mctx!.globalCompositeOperation = 'source-over';
  }

  // ── View ─────────────────────────────────────────────────────────────────
  function fit() {
    const pad = 20 * dpr();
    scale = Math.min((canvas.width - pad * 2) / W, (canvas.height - pad * 2) / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
    fitted = true;
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    canvas.width = comp.width = Math.max(1, Math.round(r.width * dpr()));
    canvas.height = comp.height = Math.max(1, Math.round(r.height * dpr()));
    if (fitted && W) fit();
    draw();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);

  function zoomAt(sx: number, sy: number, factor: number) {
    const next = Math.min(32, Math.max(0.02, scale * factor));
    ox = sx - ((sx - ox) * next) / scale;
    oy = sy - ((sy - oy) * next) / scale;
    scale = next;
    fitted = false;
    draw();
  }

  const draw = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(paint);
  };
  function paint() {
    frame = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!original || !mask) return;
    const smooth = scale < 2;
    for (const c of [ctx, cctx]) (c.imageSmoothingEnabled = smooth), (c.imageSmoothingQuality = 'high');
    if (comparing) return void ctx.drawImage(original, ox, oy, W * scale, H * scale);

    cctx.globalCompositeOperation = 'copy';
    cctx.drawImage(original, ox, oy, W * scale, H * scale);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask, ox, oy, W * scale, H * scale);
    cctx.globalCompositeOperation = 'source-over';

    // While restoring, what was removed shows faintly, so it can be painted back.
    if (tool === 'restore' && !spaceDown) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(original, ox, oy, W * scale, H * scale);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(comp, 0, 0);

    if (pointer && tool !== 'move' && !spaceDown) {
      const r = radius() * scale;
      ctx.lineWidth = dpr();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(11,35,64,0.9)';
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, r + dpr(), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Brush ────────────────────────────────────────────────────────────────
  function snapshot() {
    const c = new OffscreenCanvas(W, H);
    c.getContext('2d')!.drawImage(mask!, 0, 0);
    return c;
  }
  function restoreFrom(c: OffscreenCanvas) {
    mctx!.globalCompositeOperation = 'copy';
    mctx!.drawImage(c, 0, 0);
    mctx!.globalCompositeOperation = 'source-over';
  }
  function remember() {
    undo.push(snapshot());
    if (undo.length > levels) undo.shift()!.width = 0;
    for (const c of redo.splice(0)) c.width = 0;
    dirty = true;
  }

  function dab(x: number, y: number) {
    const r = radius();
    const inner = r * (1 - Number(soft.value) / 100);
    const g = mctx!.createRadialGradient(x, y, inner, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    mctx!.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    mctx!.fillStyle = g;
    mctx!.beginPath();
    mctx!.arc(x, y, r, 0, Math.PI * 2);
    mctx!.fill();
    mctx!.globalCompositeOperation = 'source-over';
  }

  const toPicture = (e: { clientX: number; clientY: number }) => {
    const b = canvas.getBoundingClientRect();
    const sx = (e.clientX - b.left) * dpr();
    const sy = (e.clientY - b.top) * dpr();
    return { sx, sy, x: (sx - ox) / scale, y: (sy - oy) / scale };
  };

  let stroke: { x: number; y: number } | null = null;
  let pan: { sx: number; sy: number; ox: number; oy: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (!mask) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toPicture(e);
    if (e.button === 1 || e.button === 2 || tool === 'move' || spaceDown) return void (pan = { sx: p.sx, sy: p.sy, ox, oy });
    if (e.button !== 0) return;
    remember();
    stroke = { x: p.x, y: p.y };
    dab(p.x, p.y);
    renderTools();
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = toPicture(e);
    pointer = { x: p.sx, y: p.sy };
    if (pan) {
      ox = pan.ox + p.sx - pan.sx;
      oy = pan.oy + p.sy - pan.sy;
      fitted = false;
    } else if (stroke) {
      // Dabs along the segment, close enough to look continuous.
      const step = Math.max(1, radius() * 0.25);
      const dx = p.x - stroke.x;
      const dy = p.y - stroke.y;
      const n = Math.ceil(Math.hypot(dx, dy) / step);
      for (let i = 1; i <= n; i++) dab(stroke.x + (dx * i) / n, stroke.y + (dy * i) / n);
      stroke = { x: p.x, y: p.y };
    }
    draw();
  });
  const end = () => ((stroke = null), (pan = null));
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => ((pointer = null), draw()));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // In the page, the wheel scrolls the page; Ctrl + wheel zooms. Full screen: the wheel zooms.
  canvas.addEventListener(
    'wheel',
    (e) => {
      if (!full && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toPicture(e);
      zoomAt(p.sx, p.sy, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
  el.addEventListener('pointerenter', () => (hovered = true));
  el.addEventListener('pointerleave', () => (hovered = false));

  // ── Buttons and keys ─────────────────────────────────────────────────────
  undoBtn.addEventListener('click', () => {
    const prev = undo.pop();
    if (!prev) return;
    redo.push(snapshot());
    restoreFrom(prev);
    prev.width = 0;
    dirty = true;
    renderTools();
    draw();
  });
  redoBtn.addEventListener('click', () => {
    const nxt = redo.pop();
    if (!nxt) return;
    undo.push(snapshot());
    restoreFrom(nxt);
    nxt.width = 0;
    dirty = true;
    renderTools();
    draw();
  });
  resetBtn.addEventListener('click', async () => {
    if (!mask) return;
    remember();
    await fillMask(await automaticFile(item));
    renderTools();
    draw();
  });
  const centre = () => ({ sx: canvas.width / 2, sy: canvas.height / 2 });
  zoomIn.addEventListener('click', () => zoomAt(centre().sx, centre().sy, 1.25));
  zoomOut.addEventListener('click', () => zoomAt(centre().sx, centre().sy, 0.8));
  fitBtn.addEventListener('click', () => (fit(), draw()));
  const setFull = (on: boolean) => {
    full = on;
    el.classList.toggle('full', on);
    document.body.classList.toggle('editing', on);
    fitted = true;
    renderTools();
  };
  fullBtn.addEventListener('click', () => setFull(!full));
  const compare = (on: boolean) => ((comparing = on), draw());
  compareBtn.addEventListener('pointerdown', () => compare(true));
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) compareBtn.addEventListener(ev, () => compare(false));
  size.addEventListener('input', draw);

  // Shortcuts only while the editor is under the pointer or full screen, and never while typing.
  const onKey = (e: KeyboardEvent) => {
    if (!hovered && !full) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') return void (e.preventDefault(), (e.shiftKey ? redoBtn : undoBtn).click());
    if ((e.ctrlKey || e.metaKey) && k === 'y') return void (e.preventDefault(), redoBtn.click());
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === 'e') setTool('erase');
    else if (k === 'r') setTool('restore');
    else if (k === 'h') setTool('move');
    else if (k === '[') (size.value = String(Math.max(4, Number(size.value) / 1.2))), draw();
    else if (k === ']') (size.value = String(Math.min(300, Number(size.value) * 1.2))), draw();
    else if (k === ' ' && !spaceDown) e.preventDefault(), (spaceDown = true), renderTools(), draw();
    else if (k === 'escape' && full) setFull(false);
  };
  const onKeyUp = (e: KeyboardEvent) => e.key === ' ' && ((spaceDown = false), renderTools(), draw());
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  // ── Apply / dispose ──────────────────────────────────────────────────────
  async function commit() {
    if (!dirty || !original || !mask) return;
    dirty = false;
    const out = new OffscreenCanvas(W, H);
    const o = out.getContext('2d')!;
    o.drawImage(original, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(mask, 0, 0);
    await store.setEdited(item, await out.convertToBlob({ type: 'image/png' }));
    out.width = out.height = 0;
  }
  store.commits.set(item.id, commit);

  async function dispose() {
    if (disposed) return;
    await commit().catch(() => {});
    disposed = true;
    if (store.commits.get(item.id) === commit) store.commits.delete(item.id);
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    if (full) document.body.classList.remove('editing');
    original?.close();
    for (const c of [mask, ...undo, ...redo]) if (c) c.width = c.height = 0;
    comp.width = comp.height = canvas.width = canvas.height = 0;
    el.remove();
  }

  load().catch(() => (loading.textContent = reasonText('unreadable')));
  return { el, commit, dispose };
}
