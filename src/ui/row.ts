/** One line per file: category, name, sizes, saving, action. */
import { categoryOf } from '../lib/detect';
import { categoryIcon, h, icon, replace } from './dom';
import { save, store, type Item } from './store';
import { bytes, categoryText, getLang, percent, reasonText, t } from './i18n';

export function row(item: Item) {
  const category = categoryOf(item.file.name);
  const meta = h('span', { class: 'row-meta' });
  const gain = h('span', { class: 'row-gain' });
  const action = h('div', { class: 'row-action' });
  const note = h('p', { class: 'row-note' });
  const bar = h('div', { class: 'row-bar' });
  const el = h(
    'li',
    { class: 'row' },
    h('span', { class: 'row-icon' }, categoryIcon[category]()),
    h('div', { class: 'row-text' }, h('span', { class: 'row-name', title: item.file.name }, item.file.name), meta),
    gain,
    action,
    bar,
    note,
  );

  function update() {
    const r = item.result;
    el.dataset.state = item.state;
    el.dataset.optimized = String(!!r?.optimized);
    bar.style.setProperty('--p', String(item.state === 'working' ? item.progress : 0));
    const sizes = r?.optimized ? `${bytes(r.inputSize)} → ${bytes(r.outputSize)}` : bytes(item.file.size);
    meta.textContent = `${categoryText(category)} · ${sizes}`;

    if (r?.optimized) {
      gain.textContent = percent(1 - r.outputSize / r.inputSize);
      note.textContent = `${t('verified')}${r.lossless ? `, ${t('identical')}` : ''}`;
    } else {
      gain.textContent = item.state === 'waiting' ? t('waiting') : item.state === 'working' ? `${Math.round(item.progress * 100)}${getLang() === 'fr' ? ' %' : '%'}` : '';
      note.textContent = item.state === 'done' || item.state === 'failed' ? reasonText(r?.reason ?? item.reason) : '';
    }
    replace(
      action,
      r?.optimized ? h('button', { class: 'btn small', type: 'button', onclick: () => void save(item) }, icon.down(), t('save')) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('remove'), title: t('remove'), onclick: () => void store.remove(item) }, icon.close()),
    );
  }

  update();
  return { el, update };
}
