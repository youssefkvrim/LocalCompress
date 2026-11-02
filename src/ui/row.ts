/** One line per file: category (or thumbnail), name, sizes, saving or format, action. */
import { categoryOf } from '../lib/detect';
import { safeName } from '../lib/names';
import type { ImageTarget, MediaTarget, Step } from '../lib/types';
import { categoryIcon, h, icon, replace } from './dom';
import { fileOf, pictureOf, save, store, targetsFor, type Item } from './store';
import { bytes, categoryText, getLang, percent, reasonText, t } from './i18n';

/** Share of the bar given to each step: the work itself is most of it. */
const SPAN: Record<Step, [number, number]> = { compress: [0, 0.8], convert: [0, 0.8], removebg: [0, 0.8], verify: [0.8, 0.95], finish: [0.95, 1] };

/**
 * Where the bar should be now. The engine's own progress is used when it
 * reports one; otherwise the bar eases towards the end of the current step
 * (never reaching it), so the user always sees that work is going on.
 */
export function progressOf(item: Item, now: number): number {
  const [from, to] = SPAN[item.step];
  const elapsed = (now - item.stepAt) / 1000;
  const eased = 0.9 * (1 - Math.exp(-elapsed / 4));
  const fraction = item.step !== 'verify' && item.step !== 'finish' && item.progress > 0 ? Math.max(item.progress, eased * 0.3) : eased;
  return from + (to - from) * Math.min(0.98, fraction);
}

export function row(item: Item) {
  const category = categoryOf(item.file.name);
  const task = item.settings.task;
  const picture = task === 'removebg' && category === 'image';
  const meta = h('span', { class: 'row-meta' });
  const gain = h('span', { class: 'row-gain' });
  const action = h('div', { class: 'row-action' });
  const note = h('p', { class: 'row-note' });
  const warning = h('p', { class: 'row-warn', role: 'note' });
  const bar = h('div', { class: 'row-bar' });
  // Built once and only shown or hidden, so typing is never interrupted by a refresh.
  const secret = h('input', { type: 'password', class: 'unlock-input', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('unlock.label'), placeholder: t('unlock.label') }) as HTMLInputElement;
  const submit = () => {
    const value = secret.value;
    secret.value = '';
    if (value) store.unlock(item, value);
  };
  secret.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), submit()));
  const unlock = h('div', { class: 'unlock', hidden: true }, secret, h('button', { class: 'btn small', type: 'button', onclick: submit }, t('unlock.open')));
  // Conversion: the formats for this file, chosen before anything starts.
  const formats = h('div', { class: 'row-formats', hidden: true });
  const options = targetsFor(item.file.name);

  // Background removal: a thumbnail of the picture (the original, then the result) instead of an icon.
  const thumb = h('img', { alt: '', decoding: 'async' }) as HTMLImageElement;
  const iconSlot = h('span', { class: `row-icon${picture ? ' thumb checker' : ''}` }, picture ? thumb : categoryIcon[category]());
  let shownKey: unknown = null;
  const show = (key: unknown, blob: () => Promise<Blob> | Blob) => {
    if (key === shownKey) return;
    shownKey = key;
    void Promise.resolve(blob()).then((b) => {
      if (key !== shownKey) return;
      if (thumb.src) URL.revokeObjectURL(thumb.src);
      thumb.src = URL.createObjectURL(b);
    });
  };

  const el = h(
    'li',
    { class: `row${picture ? ' selectable' : ''}` },
    iconSlot,
    h('div', { class: 'row-text' }, h('span', { class: 'row-name', title: safeName(item.file.name) }, safeName(item.file.name)), meta),
    gain,
    action,
    bar,
    formats,
    note,
    unlock,
    warning,
  );
  // A picture's row shows it in the workspace above.
  if (picture) el.addEventListener('click', (e) => !(e.target as Element).closest('button, input') && store.select(item));
  let shown = 0;
  let animating = false;

  /** Smoothly move the bar while the item is being processed. */
  function animate() {
    if (item.state !== 'working') return void (animating = false);
    shown += (Math.max(shown, progressOf(item, performance.now())) - shown) * 0.08;
    bar.style.setProperty('--p', String(shown));
    gain.textContent = `${Math.round(shown * 100)}${getLang() === 'fr' ? ' %' : '%'}`;
    note.textContent = `${t(`step.${item.step}`)}…`;
    requestAnimationFrame(animate);
  }

  function update() {
    const r = item.result;
    el.dataset.state = item.state;
    el.dataset.optimized = String(!!r?.optimized);
    el.classList.toggle('selected', picture && store.selected === item.id);
    warning.hidden = !r?.active;
    warning.textContent = r?.active ? t('active') : '';
    const locked = item.state === 'done' && (r?.reason === 'password' || r?.reason === 'password-wrong');
    if (locked && unlock.hidden) queueMicrotask(() => secret.focus());
    unlock.hidden = !locked;
    const sizes = r?.optimized ? `${bytes(r.inputSize)} → ${bytes(item.edited?.blob.size ?? r.outputSize)}` : bytes(item.file.size);
    meta.textContent = `${categoryText(category)} · ${sizes}${task === 'compress' ? '' : ` · ${t(`task.${task}`)}`}`;
    note.title = item.message ?? '';

    if (picture) {
      const cutOut = item.state === 'done' && !!r?.optimized;
      if (cutOut) show(item.edited ?? item.result, () => fileOf(item));
      else show(item.file, () => pictureOf(item));
    }

    formats.hidden = !item.held;
    if (item.held) {
      replace(
        formats,
        h('span', null, t('convert.to')),
        h(
          'div',
          { class: 'seg mini-text', role: 'radiogroup', 'aria-label': t('convert.to') },
          ...options.map((o) => h('button', { type: 'button', role: 'radio', class: o === item.target ? 'on' : '', 'aria-checked': String(o === item.target), onclick: () => store.choose([item], o as ImageTarget | MediaTarget) }, o.toUpperCase())),
        ),
      );
      gain.textContent = item.target ? `→ ${item.target.toUpperCase()}` : '';
      note.textContent = item.target ? t('waiting') : t('convert.pick');
    } else if (item.state === 'working') {
      if (!animating) (animating = true), requestAnimationFrame(animate);
    } else if (r?.optimized && task !== 'compress') {
      gain.textContent = `→ ${r.outputName.split('.').pop()!.toUpperCase()}`;
      note.textContent = task === 'convert' ? `${t('converted')}${r.lossless ? `, ${t('identical')}` : ''}` : t(item.edited ? 'touchedUp' : 'cutout');
    } else if (r?.optimized) {
      gain.textContent = percent(1 - r.outputSize / r.inputSize);
      note.textContent = `${t('verified')}${r.lossless ? `, ${t('identical')}` : ''}`;
    } else {
      const becomes = task === 'removebg' ? 'png' : task === 'convert' ? item.target : '';
      gain.textContent = item.state === 'waiting' ? (becomes ? `→ ${becomes.toUpperCase()}` : t('waiting')) : '';
      note.textContent = item.state === 'done' || item.state === 'failed' ? reasonText(r?.reason ?? item.reason) : '';
    }
    const cutOut = picture && item.state === 'done' && !!r?.optimized;
    replace(
      action,
      cutOut && store.selected !== item.id ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => (store.select(item), document.querySelector('.zone-slot')?.scrollIntoView({ behavior: 'smooth', block: 'center' })) }, icon.brush(), t('edit.open')) : null,
      r ? h('button', { class: `btn small${r.optimized ? '' : ' ghost'}`, type: 'button', onclick: () => void save(item) }, icon.down(), t('save')) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('remove'), title: t('remove'), onclick: () => void store.remove(item) }, icon.close()),
    );
  }

  /** The row leaves the list: free the thumbnail. */
  function dispose() {
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.removeAttribute('src');
    shownKey = null;
  }

  update();
  return { el, update, dispose };
}
