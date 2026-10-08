/** The single screen: title, drop zone, mode, list of files. */
import type { Mode } from '../lib/types';
import { h, icon, replace } from './dom';
import { store } from './store';
import { row } from './row';
import { panel as makePanel, headersOk } from './panel';
import { getLang, setLang, t, type Lang } from './i18n';

const MODES: Mode[] = ['lossless', 'balanced', 'compact'];

let unmount = () => {};

export function mountApp(root: HTMLElement) {
  unmount();
  const panel = makePanel();
  const picker = h('input', { type: 'file', multiple: true, hidden: true }) as HTMLInputElement;
  picker.addEventListener('change', () => (store.add(picker.files ?? []), (picker.value = '')));

  const status = h('button', { class: 'status', type: 'button', onclick: () => panel.show('privacy') }, h('i', { class: 'dot' }), h('span', null, t('local')));
  const lang = (l: Lang) => h('button', { class: `lang ${getLang() === l ? 'on' : ''}`, type: 'button', onclick: () => (setLang(l), mountApp(root)) }, l.toUpperCase());
  const modes = h('div', { class: 'seg', role: 'radiogroup' });
  const hint = h('p', { class: 'hint' });
  const list = h('ul', { class: 'list' });
  const clear = h('button', { class: 'clear', type: 'button', onclick: () => store.items.filter((i) => i.state !== 'working').forEach((i) => void store.remove(i)) }, t('clear'));
  const words = t('tagline').split(' ');

  replace(
    root,
    h(
      'header',
      { class: 'bar' },
      h('span', { class: 'brand' }, h('span', { class: 'mark' }), 'LocalCompress'),
      h('nav', { class: 'bar-right' }, lang('fr'), h('span', { class: 'sep' }, '/'), lang('en'), status, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('settings'), onclick: () => panel.show('settings') }, icon.sliders())),
    ),
    h(
      'main',
      { class: 'main' },
      h('h1', { class: 'title' }, `${words.slice(0, -1).join(' ')} `, h('em', null, words.at(-1))),
      h('p', { class: 'lede' }, icon.lock(), t('sub')),
      h('button', { class: 'zone', type: 'button', onclick: () => picker.click() }, h('span', { class: 'zone-plus' }, icon.plus()), h('span', { class: 'zone-title' }, t('drop')), h('span', { class: 'zone-sub' }, t('browse'))),
      h('div', { class: 'mode' }, modes, hint),
      list,
      clear,
    ),
    h('div', { class: 'veil' }, h('p', null, t('release'), h('br'), h('em', null, t('tagline')))),
    panel.el,
    picker,
  );

  // Rows are keyed by item; the whole screen re-renders cheaply on every change.
  const rows = new Map<string, ReturnType<typeof row>>();
  const render = () => {
    replace(modes, ...MODES.map((m) => h('button', { type: 'button', role: 'radio', class: m === store.settings.mode ? 'on' : '', 'aria-checked': String(m === store.settings.mode), onclick: () => store.set({ mode: m }) }, t(m))));
    hint.textContent = t(`hint.${store.settings.mode}`);
    for (const item of store.items) if (!rows.has(item.id)) rows.set(item.id, row(item));
    for (const id of rows.keys()) if (!store.items.some((i) => i.id === id)) rows.delete(id);
    replace(list, ...store.items.map((i) => rows.get(i.id)!.el));
    rows.forEach((r) => r.update());
    clear.hidden = store.items.length < 2;
    status.classList.toggle('warn', !headersOk() || store.network.some((n) => n.blocked));
    document.body.classList.toggle('has-jobs', store.items.length > 0);
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
