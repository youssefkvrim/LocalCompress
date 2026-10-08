/** One line per file: category, name, sizes, saving, action. */
import { categoryOf } from '../lib/detect';
import { safeName } from '../lib/names';
import type { Step } from '../lib/types';
import { categoryIcon, h, icon, replace } from './dom';
import { save, store, type Item } from './store';
import { bytes, categoryText, getLang, percent, reasonText, t } from './i18n';

/** Share of the bar given to each step: compression is most of the work. */
const SPAN: Record<Step, [number, number]> = { compress: [0, 0.8], verify: [0.8, 0.95], finish: [0.95, 1] };

/**
 * Where the bar should be now. The engine's own progress is used when it
 * reports one; otherwise the bar eases towards the end of the current step
 * (never reaching it), so the user always sees that work is going on.
 */
function target(item: Item, now: number): number {
  const [from, to] = SPAN[item.step];
  const elapsed = (now - item.stepAt) / 1000;
  const eased = 0.9 * (1 - Math.exp(-elapsed / 4));
  const fraction = item.step === 'compress' && item.progress > 0 ? Math.max(item.progress, eased * 0.3) : eased;
  return from + (to - from) * Math.min(0.98, fraction);
}

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
    h('div', { class: 'row-text' }, h('span', { class: 'row-name', title: safeName(item.file.name) }, safeName(item.file.name)), meta),
    gain,
    action,
    bar,
    note,
  );
  let shown = 0;
  let animating = false;

  /** Smoothly move the bar while the item is being processed. */
  function animate() {
    if (item.state !== 'working') return void (animating = false);
    shown += (Math.max(shown, target(item, performance.now())) - shown) * 0.08;
    bar.style.setProperty('--p', String(shown));
    gain.textContent = `${Math.round(shown * 100)}${getLang() === 'fr' ? ' %' : '%'}`;
    note.textContent = `${t(`step.${item.step}`)}…`;
    requestAnimationFrame(animate);
  }

  function update() {
    const r = item.result;
    el.dataset.state = item.state;
    el.dataset.optimized = String(!!r?.optimized);
    const sizes = r?.optimized ? `${bytes(r.inputSize)} → ${bytes(r.outputSize)}` : bytes(item.file.size);
    meta.textContent = `${categoryText(category)} · ${sizes}`;

    if (item.state === 'working') {
      if (!animating) (animating = true), requestAnimationFrame(animate);
    } else if (r?.optimized) {
      gain.textContent = percent(1 - r.outputSize / r.inputSize);
      note.textContent = `${t('verified')}${r.lossless ? `, ${t('identical')}` : ''}`;
    } else {
      gain.textContent = item.state === 'waiting' ? t('waiting') : '';
      note.textContent = item.state === 'done' || item.state === 'failed' ? reasonText(r?.reason ?? item.reason) : '';
    }
    replace(
      action,
      r ? h('button', { class: `btn small${r.optimized ? '' : ' ghost'}`, type: 'button', onclick: () => void save(item) }, icon.down(), t('save')) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('remove'), title: t('remove'), onclick: () => void store.remove(item) }, icon.close()),
    );
  }

  update();
  return { el, update };
}
