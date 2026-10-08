import type { Preset } from '@localcompress/core';
import { h, icon, replace } from './dom';
import { store } from './store';
import { enqueue, discard } from './runner';
import { JobCard } from './job-card';
import { Panel, headersOk } from './panel';
import { getLang, setLang, t } from './i18n';

const MODES: Preset[] = ['lossless', 'balanced', 'compression'];
let globalsInstalled = false;

export function mountApp(root: HTMLElement) {
  const panel = new Panel();
  const input = h('input', { type: 'file', multiple: true, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' }) as HTMLInputElement;
  input.addEventListener('change', () => {
    if (input.files?.length) enqueue(input.files);
    input.value = '';
  });

  // ── Header ──────────────────────────────────────────────────────────
  const status = h('button', { class: 'status', type: 'button', onclick: () => panel.show('privacy') }, h('i', { class: 'dot' }), h('span', null, t('local')));
  const updateStatus = () => {
    const bad = store.network.some((n) => n.verdict === 'blocked') || !headersOk();
    status.classList.toggle('warn', bad);
  };
  store.onNetwork(updateStatus);
  updateStatus();
  const langBtn = (l: 'fr' | 'en') =>
    h('button', { class: `lang ${getLang() === l ? 'on' : ''}`, type: 'button', 'aria-pressed': String(getLang() === l), onclick: () => switchLang(root, l) }, l.toUpperCase());

  const header = h(
    'header',
    { class: 'bar' },
    h('span', { class: 'brand' }, h('span', { class: 'mark', 'aria-hidden': 'true' }), 'LocalCompress'),
    h(
      'nav',
      { class: 'bar-right' },
      h('span', { class: 'langs' }, langBtn('fr'), h('span', { class: 'sep' }, '/'), langBtn('en')),
      status,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('panel.settings'), title: t('panel.settings'), onclick: () => panel.show('settings') }, icon.sliders()),
    ),
  );

  // ── Drop zone ───────────────────────────────────────────────────────
  const zone = h(
    'button',
    { class: 'zone', type: 'button', onclick: () => input.click() },
    h('span', { class: 'zone-plus' }, icon.plus()),
    h('span', { class: 'zone-title' }, t('drop')),
    h('span', { class: 'zone-sub' }, t('browse')),
  );

  // ── Mode ────────────────────────────────────────────────────────────
  const seg = h('div', { class: 'seg', role: 'radiogroup' });
  const hint = h('p', { class: 'hint' });
  const renderMode = () => {
    const cur = MODES.includes(store.settings.preset) ? store.settings.preset : 'lossless';
    replace(
      seg,
      ...MODES.map((m) =>
        h('button', { type: 'button', role: 'radio', class: m === cur ? 'on' : '', 'aria-checked': String(m === cur), onclick: () => store.setSettings({ preset: m }) }, t(`mode.${m}` as 'mode.lossless')),
      ),
    );
    hint.textContent = t(`hint.${cur}` as 'hint.lossless');
  };

  // ── List ────────────────────────────────────────────────────────────
  const list = h('ul', { class: 'list' });
  const clear = h('button', { class: 'clear', type: 'button', onclick: () => store.jobs.filter((j) => j.state !== 'running').forEach((j) => void discard(j)) }, t('clear'));
  const cards = new Map<string, JobCard>();
  const renderList = () => {
    for (const j of store.jobs) {
      let c = cards.get(j.id);
      if (!c) {
        c = new JobCard(j);
        cards.set(j.id, c);
        list.append(c.el);
      }
      c.update();
    }
    for (const [id, c] of cards) if (!store.jobs.some((j) => j.id === id)) c.destroy(), cards.delete(id);
    clear.hidden = store.jobs.length < 2;
    document.body.classList.toggle('has-jobs', store.jobs.length > 0);
  };

  const veil = h('div', { class: 'veil', 'aria-hidden': 'true' }, h('p', null, t('release'), h('br'), h('em', null, t('releaseSub'))));

  replace(
    root,
    header,
    h(
      'main',
      { class: 'main' },
      title(t('tagline')),
      h('p', { class: 'lede' }, icon.lock(), t('sub')),
      zone,
      h('div', { class: 'mode' }, seg, hint),
      list,
      clear,
    ),
    veil,
    panel.el,
    input,
  );

  let lastPreset = '';
  const unsub = store.subscribe(() => {
    if (store.settings.preset !== lastPreset) (lastPreset = store.settings.preset), renderMode();
    renderList();
  });
  (root as HTMLElement & { __unmount?: () => void }).__unmount = () => {
    unsub();
    cards.forEach((c) => c.destroy());
  };
  renderMode();
  renderList();
  installGlobals(panel);
  requestAnimationFrame(() => document.body.classList.add('ready'));
}

/** Last word set in italic serif: "Le fichier reste *ici.*" */
function title(text: string) {
  const words = text.split(' ');
  return h('h1', { class: 'title' }, words.slice(0, -1).join(' ') + ' ', h('em', null, words[words.length - 1]));
}

function switchLang(root: HTMLElement, l: 'fr' | 'en') {
  if (l === getLang()) return;
  setLang(l);
  (root as HTMLElement & { __unmount?: () => void }).__unmount?.();
  mountApp(root);
}

let currentPanel: Panel;
function installGlobals(panel: Panel) {
  currentPanel = panel;
  if (globalsInstalled) return;
  globalsInstalled = true;
  document.addEventListener('keydown', (e) => e.key === 'Escape' && currentPanel.close());
  let depth = 0;
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) (depth = 0), document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) enqueue(files);
  });
}
