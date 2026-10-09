/** The single screen: title, drop zone, mode, list of files, footer. */
import type { Mode } from '../lib/types';
import { h, icon, logo, replace } from './dom';
import { headersOk, pending, savable, saveAll, store } from './store';
import { row } from './row';
import { CONTACT, panel as makePanel } from './panel';
import { getLang, setLang, t, type Lang } from './i18n';

const MODES: Mode[] = ['lossless', 'balanced', 'compact'];

let unmount = () => {};

export function mountApp(root: HTMLElement) {
  unmount();
  const panel = makePanel();
  const picker = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement;
  picker.addEventListener('change', () => (store.add(picker.files ?? []), (picker.value = '')));

  const lang = (l: Lang) => h('button', { class: `lang ${getLang() === l ? 'on' : ''}`, type: 'button', 'aria-pressed': String(getLang() === l), onclick: () => (setLang(l), mountApp(root)) }, l.toUpperCase());
  const infoButton = h('button', { class: 'link', type: 'button', onclick: panel.open }, icon.info(), h('span', null, t('info')));
  const modes = h('div', { class: 'seg', role: 'radiogroup' });
  const hint = h('p', { class: 'hint' });
  const list = h('ul', { class: 'list' });
  const clear = h('button', { class: 'link', type: 'button', onclick: () => store.items.filter((i) => i.state !== 'working').forEach((i) => void store.remove(i)) }, t('clear'));
  const saveAllButton = h('button', { class: 'btn', type: 'button', onclick: () => void saveAll() }, icon.down(), t('saveAll'));
  const actions = h('div', { class: 'actions' }, clear, saveAllButton);
  const zone = h('div', { class: 'zone-slot' });
  const banner = h('div', { class: 'update', role: 'status', hidden: true });
  let shown = '';

  /** The drop zone, or why files cannot be dropped yet. Rebuilt only when that changes, so focus is kept. */
  const renderZone = () => {
    const state = !headersOk() ? 'misconfig' : store.guard;
    if (state === shown) return;
    shown = state;
    if (state === 'on')
      replace(zone, h('button', { class: 'zone', type: 'button', onclick: () => picker.click() }, h('span', { class: 'zone-plus' }, icon.plus()), h('span', { class: 'zone-title' }, t('drop')), h('span', { class: 'zone-sub' }, t('browse'))));
    else if (state === 'pending' || state === 'slow')
      replace(
        zone,
        h('div', { class: 'zone loading', 'aria-busy': 'true', role: 'status' }, h('span', { class: 'zone-plus spin', 'aria-hidden': 'true' }), h('span', { class: 'zone-title' }, t('guard.pending')), h('span', { class: 'zone-sub' }, t(state === 'slow' ? 'guard.slow' : 'guard.pendingSub'))),
      );
    else replace(zone, h('div', { class: 'zone blocked', role: 'alert' }, h('span', { class: 'zone-title' }, t(state === 'misconfig' ? 'misconfig' : 'guard.failed'))));
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
    h(
      'header',
      { class: 'bar' },
      h('span', { class: 'brand' }, logo(), h('span', { class: 'wordmark' }, 'Local', h('b', null, 'Compress'))),
      h('nav', { class: 'bar-right' }, h('span', { class: 'langs' }, lang('fr'), lang('en')), infoButton),
    ),
    banner,
    h(
      'main',
      { class: 'main' },
      h('h1', { class: 'title' }, t('title')),
      h('p', { class: 'lede' }, t('sub'), h('br'), t('sub2')),
      zone,
      h('div', { class: 'mode' }, modes, hint),
      list,
      actions,
    ),
    h(
      'footer',
      { class: 'foot' },
      h('span', null, 'LocalCompress © Safran 2026'),
      h('span', { class: 'foot-center' }, t('footer')),
      h('a', { class: 'link', href: `mailto:${CONTACT}?subject=LocalCompress` }, icon.mail(), t('contact')),
    ),
    h('div', { class: 'veil' }, h('p', null, t('release'))),
    panel.el,
    picker,
  );

  const rows = new Map<string, ReturnType<typeof row>>();
  const render = () => {
    renderZone();
    renderBanner();
    replace(modes, ...MODES.map((m) => h('button', { type: 'button', role: 'radio', class: m === store.settings.mode ? 'on' : '', 'aria-checked': String(m === store.settings.mode), onclick: () => store.set({ mode: m }) }, t(m))));
    hint.textContent = t(`hint.${store.settings.mode}`);
    for (const item of store.items) if (!rows.has(item.id)) rows.set(item.id, row(item));
    for (const id of rows.keys()) if (!store.items.some((i) => i.id === id)) rows.delete(id);
    replace(list, ...store.items.map((i) => rows.get(i.id)!.el));
    rows.forEach((r) => r.update());
    // While files are processing, the button counts them all and waits; afterwards it counts what will be saved.
    const busy = pending();
    const count = busy ? store.items.length : savable().length;
    actions.hidden = store.items.length < 2;
    saveAllButton.hidden = count < 2;
    (saveAllButton as HTMLButtonElement).disabled = busy;
    replace(saveAllButton, icon.down(), t('saveAll', count));
    infoButton.classList.toggle('warn', !headersOk() || store.network.some((n) => n.blocked));
    document.body.classList.toggle('has-files', store.items.length > 0);
    panel.render();
  };
  unmount = store.on(render);
  render();
}

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
