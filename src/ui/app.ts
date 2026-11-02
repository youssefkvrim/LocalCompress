/** The single screen: task, title, drop zone (or the picture being worked on), choices, list of files, footer. */
import { TASKS, type ImageTarget, type MediaTarget, type Mode, type Settings, type Task } from '../lib/types';
import type { Category } from '../lib/detect';
import { categoryIcon, h, icon, logo, replace } from './dom';
import { groupOf, headersOk, pending, pictureOf, save, savable, saveAll, store, targetsFor, type Group, type Item } from './store';
import { progressOf, row } from './row';
import { createEditor, type Editor } from './editor';
import { mountWaves } from './waves';
import { MODEL_MB } from '../lib/model';
import { CONTACT, panel as makePanel } from './panel';
import { createDesk, desk } from './pdfdesk';
import { getLang, reasonText, setLang, t, type Lang } from './i18n';

const MODES: Mode[] = ['lossless', 'balanced', 'compact'];
/** Formats are always listed in this order. */
const ORDER: string[] = ['jpg', 'png', 'webp', 'pdf', 'mp4', 'webm', 'm4a', 'wav'];

/** What can be dropped, per task, shown under the drop zone: [category icon, label, formats]. */
const KINDS: Record<Task, [Category, 'kinds.image' | 'kinds.pdf' | 'kinds.document' | 'kinds.video' | 'kinds.audio' | 'kinds.archive', string][]> = {
  compress: [
    ['image', 'kinds.image', 'JPEG, PNG'],
    ['pdf', 'kinds.pdf', 'PDF'],
    ['document', 'kinds.document', 'Word, Excel, PowerPoint, OpenDocument'],
    ['video', 'kinds.video', 'MP4, MOV, MKV, WebM'],
    ['archive', 'kinds.archive', 'ZIP'],
  ],
  convert: [
    ['image', 'kinds.image', 'JPEG, PNG, WebP, AVIF, GIF, BMP, SVG'],
    ['pdf', 'kinds.pdf', 'PDF'],
    ['video', 'kinds.video', 'MP4, MOV, MKV, WebM'],
    ['audio', 'kinds.audio', 'MP3, WAV, M4A, Ogg, FLAC'],
  ],
  removebg: [['image', 'kinds.image', 'JPEG, PNG, WebP, AVIF, SVG']],
  pdf: [['pdf', 'kinds.pdf', 'PDF']],
};

/** A row of mutually exclusive buttons bound to one setting. */
function choice<K extends 'mode' | 'task'>(key: K, values: readonly Settings[K][], label: (v: Settings[K]) => string, extra = '') {
  return h(
    'div',
    { class: `seg ${extra}`, role: 'radiogroup' },
    ...values.map((v) => h('button', { type: 'button', role: 'radio', class: v === store.settings[key] ? 'on' : '', 'aria-checked': String(v === store.settings[key]), onclick: () => store.set({ [key]: v } as Partial<Settings>) }, label(v))),
  );
}

let unmount = () => {};

/** Where the background-removal model is: downloading in the background, ready, or loaded on first use. */
const modelText = () => {
  const { state, progress } = store.model;
  if (state === 'ready') return t('model.ready');
  if (state === 'loading') return t('model.loading').replace('{p}', progress ? ` (${Math.round(progress * 100)}${getLang() === 'fr' ? ' %' : '%'})` : '');
  if (state === 'failed') return t('model.unavailable');
  return t('model.firstUse').replace('{mb}', String(MODEL_MB));
};

export function mountApp(root: HTMLElement) {
  unmount();
  const panel = makePanel();
  const picker = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement;
  picker.addEventListener('change', () => (store.add(picker.files ?? []), (picker.value = '')));

  const lang = (l: Lang) => h('button', { class: `lang ${getLang() === l ? 'on' : ''}`, type: 'button', 'aria-pressed': String(getLang() === l), onclick: () => (setLang(l), mountApp(root)) }, l.toUpperCase());
  const infoButton = h('button', { class: 'link', type: 'button', onclick: panel.open }, icon.info(), h('span', null, t('info')));
  const tasks = h('div', { class: 'tasks' });
  const title = h('h1', { class: 'title' });
  const lede = h('p', { class: 'lede' });
  const badge = h('p', { class: 'local-badge' }, icon.shield(), h('span', null, t('local')));
  const veil = h('p');
  const modes = h('div', { class: 'mode-choices' });
  const hint = h('p', { class: 'hint' });
  const list = h('ul', { class: 'list' });
  const clear = h('button', { class: 'link', type: 'button', onclick: () => store.items.filter((i) => i.state !== 'working').forEach((i) => void store.remove(i)) }, t('clear'));
  const saveAllButton = h('button', { class: 'btn', type: 'button', onclick: () => void saveAll() }, icon.down(), t('saveAll'));
  const actions = h('div', { class: 'actions' }, clear, saveAllButton);
  const zone = h('div', { class: 'zone-slot' });
  const banner = h('div', { class: 'update', role: 'status', hidden: true });
  const pdfDesk = createDesk(() => picker.click());

  // ── Drop zone, or the picture being worked on (background removal) ──────
  let zoneKey = '';
  let editor: Editor | null = null;
  let benchUrl = '';
  let benchProgress: HTMLElement | null = null;
  let benchModel: HTMLElement | null = null;
  const closeEditor = () => {
    const e = editor;
    editor = null;
    void e?.dispose(); // applies pending touch-ups first
  };
  const freeBench = () => (benchUrl && URL.revokeObjectURL(benchUrl), (benchUrl = ''), (benchProgress = benchModel = null));

  const selectedPicture = (): Item | null => {
    if (store.settings.task !== 'removebg') return null;
    return store.items.find((i) => i.id === store.selected && i.settings.task === 'removebg') ?? null;
  };

  const dropZone = (task: Task) =>
    h(
      'button',
      { class: 'zone', type: 'button', onclick: () => picker.click() },
      h('span', { class: 'zone-plus' }, icon.plus()),
      h('span', { class: 'zone-title' }, t('drop')),
      h('span', { class: 'zone-sub' }, t('browse')),
      h('span', { class: 'zone-kinds' }, ...KINDS[task].map(([c, label, formats]) => h('span', { class: 'kind', title: formats }, categoryIcon[c](), t(label)))),
    );

  /** Background removal: the picture in place of the zone, the original while it is processed, then the editor. */
  const bench = (item: Item) => {
    const r = item.result;
    const head = h(
      'div',
      { class: 'bench-head' },
      h('span', { class: 'bench-name', title: item.file.name }, item.file.name),
      h('span', { class: 'editor-spacer' }),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => picker.click() }, icon.plus(), t('bench.add')),
      item.state === 'done' && r ? h('button', { class: 'btn small', type: 'button', onclick: () => void save(item) }, icon.down(), t('save')) : null,
    );
    if (item.state === 'done' && r?.optimized) {
      editor = createEditor(item);
      return h('div', { class: 'bench' }, head, editor.el);
    }
    benchUrl = URL.createObjectURL(pictureOf(item));
    const busy = item.state === 'waiting' || item.state === 'working';
    benchProgress = h('div', { class: 'bench-bar' });
    return h(
      'div',
      { class: 'bench' },
      head,
      h(
        'div',
        { class: `bench-view checker${busy ? ' busy' : ''}` },
        h('img', { src: benchUrl, alt: '' }),
        busy
          ? h('div', { class: 'bench-status', role: 'status' }, h('span', { class: 'zone-plus spin', 'aria-hidden': 'true' }), h('b', null, t(item.state === 'working' ? 'bench.working' : 'bench.waiting')), (benchModel = h('small', null)), benchProgress)
          : h('div', { class: 'bench-status failed', role: 'alert' }, h('b', null, reasonText(r?.reason ?? item.reason))),
      ),
    );
  };

  /** Rebuilt only when what it shows changes, so focus, zoom and brush strokes are kept. */
  const renderZone = () => {
    const task = store.settings.task;
    const pic = selectedPicture();
    const key = !headersOk() ? 'misconfig' : store.guard !== 'on' ? store.guard : task === 'pdf' && desk.files.length ? 'pdf' : pic ? `pic:${pic.id}:${pic.state}:${!!pic.result?.optimized}` : `drop:${task}`;
    if (key === 'pdf') pdfDesk.render();
    if (benchProgress && pic?.state === 'working') benchProgress.style.setProperty('--p', String(progressOf(pic, performance.now())));
    if (key === zoneKey) return void (benchModel && (benchModel.textContent = store.model.state === 'ready' ? '' : modelText()));
    zoneKey = key;
    closeEditor();
    freeBench();
    if (key === 'misconfig' || key === 'failed') replace(zone, h('div', { class: 'zone blocked', role: 'alert' }, h('span', { class: 'zone-title' }, t(key === 'misconfig' ? 'misconfig' : 'guard.failed'))));
    else if (key === 'pending' || key === 'slow')
      replace(
        zone,
        h('div', { class: 'zone loading', 'aria-busy': 'true', role: 'status' }, h('span', { class: 'zone-plus spin', 'aria-hidden': 'true' }), h('span', { class: 'zone-title' }, t('guard.pending')), h('span', { class: 'zone-sub' }, t(key === 'slow' ? 'guard.slow' : 'guard.pendingSub'))),
      );
    else if (key === 'pdf') replace(zone, pdfDesk.el);
    else if (pic) {
      replace(zone, bench(pic));
      if (benchModel) benchModel.textContent = store.model.state === 'ready' ? '' : modelText();
    } else replace(zone, dropZone(task));
  };

  /** Conversion: one choice for every waiting file of a family; choosing starts them. */
  const renderConvert = () => {
    const held = store.items.filter((i) => i.held);
    if (!held.length) return void replace(modes);
    const groups = new Map<Group, Item[]>();
    for (const i of held) {
      const g = groupOf(i.file.name);
      if (g) groups.set(g, [...(groups.get(g) ?? []), i]);
    }
    replace(
      modes,
      ...[...groups].filter(([, items]) => items.length > 1).map(([g, items]) => {
        const all = [...new Set(items.flatMap((i) => targetsFor(i.file.name)))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
        return h(
          'div',
          { class: 'target' },
          h('span', null, t('convert.all').replace('{kind}', t(`group.${g}`))),
          h('div', { class: 'seg' }, ...all.map((o) => h('button', { type: 'button', onclick: () => store.choose(items, o as ImageTarget | MediaTarget) }, o.toUpperCase()))),
        );
      }),
    );
  };

  /** "A new version is available": only for an upgrade, and never while files are being processed. */
  const renderBanner = () => {
    banner.hidden = store.update === 'none';
    if (store.update === 'none') return;
    const stale = store.update === 'stale';
    const busy = !stale && pending();
    replace(
      banner,
      h('span', null, t(stale ? 'update.stale' : busy ? 'update.busy' : 'update.available')),
      h('button', { class: 'btn small', type: 'button', disabled: busy, onclick: () => store.applyUpdate() }, t(stale ? 'update.reloadPage' : 'update.apply')),
    );
  };

  replace(
    root,
    // The animated background stays behind the page, never behind the footer.
    h(
      'div',
      { class: 'page' },
      wavesHost,
      h(
        'header',
        { class: 'bar' },
        h('span', { class: 'brand' }, logo(), h('span', { class: 'wordmark' }, 'Local', h('b', null, 'Kit'))),
        h('nav', { class: 'bar-right' }, h('span', { class: 'langs' }, lang('fr'), lang('en')), infoButton),
      ),
      banner,
      h('main', { class: 'main' }, tasks, title, lede, badge, zone, h('div', { class: 'mode' }, modes, hint), list, actions),
    ),
    h(
      'footer',
      { class: 'foot' },
      h('span', null, 'LocalKit © Safran 2026'),
      h('span', { class: 'foot-center' }, t('footer')),
      h('a', { class: 'link', href: `mailto:${CONTACT}?subject=LocalKit` }, icon.mail(), t('contact')),
    ),
    h('div', { class: 'veil' }, veil),
    panel.el,
    picker,
  );

  const rows = new Map<string, ReturnType<typeof row>>();
  const render = () => {
    renderZone();
    renderBanner();
    const task = store.settings.task;
    replace(tasks, choice('task', TASKS, (v) => t(`task.${v}`), 'tasks-seg'));
    if (task === 'compress') {
      title.textContent = t('title');
      lede.textContent = t('sub');
      veil.textContent = t('release');
      replace(modes, choice('mode', MODES, (m) => t(m)));
      hint.textContent = t(`hint.${store.settings.mode}`);
    } else if (task === 'convert') {
      title.textContent = t('title.convert');
      lede.textContent = t('sub.convert');
      veil.textContent = t('release.convert');
      hint.textContent = store.items.some((i) => i.held) ? '' : t('convert.hint');
    } else if (task === 'pdf') {
      title.textContent = t('title.pdf');
      lede.textContent = t('sub.pdf');
      veil.textContent = t('release.pdf');
      replace(modes);
      hint.textContent = desk.files.length ? '' : t('hint.pdf');
    } else {
      title.textContent = t('title.removebg');
      lede.textContent = t('sub.removebg');
      veil.textContent = t('release.removebg');
      replace(modes);
      hint.textContent = selectedPicture() ? '' : `${t('hint.removebg')} ${modelText()}`;
    }
    // Waiting conversions show their choices whatever the tab, so they are never stuck.
    if (task !== 'compress') renderConvert();
    for (const item of store.items) if (!rows.has(item.id)) rows.set(item.id, row(item));
    for (const [id, r] of rows) if (!store.items.some((i) => i.id === id)) r.dispose(), rows.delete(id);
    replace(list, ...store.items.map((i) => rows.get(i.id)!.el));
    rows.forEach((r) => r.update());
    // While files are processing, the button counts them all and waits; afterwards it counts what will be saved.
    const busy = pending();
    const count = busy ? store.items.length : savable().length;
    actions.hidden = store.items.length < 2;
    saveAllButton.hidden = count < 2;
    (saveAllButton as HTMLButtonElement).disabled = busy;
    replace(saveAllButton, icon.down(), t('saveAll', count));
    // Orange: a request was blocked by the protection. The development server's live reload
    // (a WebSocket inside workers) is always blocked, so only production counts.
    infoButton.classList.toggle('warn', !headersOk() || (import.meta.env.PROD && store.network.some((n) => n.blocked)));
    document.body.classList.toggle('has-files', store.items.length > 0);
    // A picture on screen: the title steps back so the picture fits in the window.
    document.body.classList.toggle('has-bench', !!selectedPicture());
    panel.render();
    waves.wake();
  };
  const off = store.on(render);
  unmount = () => (off(), rows.forEach((r) => r.dispose()), closeEditor(), freeBench());
  render();
}

/** Animated background behind the page (not the footer); still while files are processed. Moved into each new page. */
const wavesHost = document.createElement('div');
wavesHost.className = 'waves';
wavesHost.setAttribute('aria-hidden', 'true');
const waves = mountWaves(
  wavesHost,
  {
    cellSize: 7,
    dotSize: 0.55,
    color: '#d3dff3',
    hoverColor: '#1557c3',
    backgroundColor: '#ffffff',
    speed: 0.5,
    scale: 1.8,
    contrast: 0.9,
    brightness: 0.4,
    fade: 0.29,
    splashRadius: 20,
    splashStrength: 0.4,
    introDuration: 1.6,
  },
  pending,
);

/** Scroll bars stay hidden until something scrolls. Installed once. */
const timers = new WeakMap<Element, number>();
document.addEventListener(
  'scroll',
  (e) => {
    const el = e.target === document ? document.documentElement : (e.target as Element);
    el.classList.add('scrolling');
    clearTimeout(timers.get(el));
    timers.set(el, window.setTimeout(() => el.classList.remove('scrolling'), 900));
  },
  { capture: true, passive: true },
);

/** Drag and drop anywhere on the window. Installed once. */
let depth = 0;
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => hasFiles(e) && (e.preventDefault(), depth++ === 0 && document.body.classList.add('dragging')));
window.addEventListener('dragover', (e) => hasFiles(e) && e.preventDefault());
window.addEventListener('dragleave', () => --depth <= 0 && ((depth = 0), document.body.classList.remove('dragging')));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  depth = 0;
  document.body.classList.remove('dragging');
  if (e.dataTransfer?.files.length) store.add(e.dataTransfer.files);
});
