/** One line per file: name · sizes · saving · action; details on click. */
import { h, icon, replace } from './dom';
import { save, store, type Item } from './store';
import { bytes, checkText, getLang, percent, reasonText, t } from './i18n';

export function row(item: Item) {
  const name = h('button', { class: 'row-name', type: 'button', title: item.file.name }, item.file.name);
  const sizes = h('span', { class: 'row-sizes' });
  const gain = h('span', { class: 'row-gain' });
  const action = h('div', { class: 'row-action' });
  const note = h('p', { class: 'row-note' });
  const bar = h('div', { class: 'row-bar' });
  const more = h('div', { class: 'row-more', hidden: true });
  const el = h('li', { class: 'row' }, h('div', { class: 'row-main' }, name, sizes, gain, action), bar, note, more);
  name.addEventListener('click', () => item.result && ((more.hidden = !more.hidden), update()));

  function update() {
    const r = item.result;
    el.dataset.state = item.state;
    el.dataset.optimized = String(!!r?.optimized);
    bar.style.setProperty('--p', String(item.state === 'working' ? item.progress : 0));

    if (r?.optimized) {
      sizes.textContent = `${bytes(r.inputSize)} → ${bytes(r.outputSize)}`;
      gain.textContent = percent(1 - r.outputSize / r.inputSize);
      note.textContent = `${r.lossless ? `${t('identical')} · ` : ''}${t('verified')} ✓`;
    } else {
      sizes.textContent = bytes(item.file.size);
      gain.textContent = item.state === 'waiting' ? t('waiting') : item.state === 'working' ? `${Math.round(item.progress * 100)}${getLang() === 'fr' ? ' %' : '%'}` : '—';
      note.textContent = item.state === 'done' || item.state === 'failed' ? reasonText(r?.reason ?? item.reason) : '';
    }

    replace(
      action,
      r?.optimized ? h('button', { class: 'btn', type: 'button', onclick: () => void save(item) }, icon.down(), t('save')) : null,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('remove'), title: t('remove'), onclick: () => void store.remove(item) }, icon.close()),
    );

    if (!more.hidden && r)
      replace(
        more,
        h(
          'dl',
          { class: 'facts' },
          h('dt', null, t('engine')),
          h('dd', null, r.engine || '—'),
          h('dt', null, t('checks')),
          h('dd', null, ...r.checks.map((c) => h('span', { class: c.ok ? 'ok' : 'bad' }, `${c.ok ? '✓' : '✕'} ${checkText(c.label)}`))),
          r.sha256In ? h('dt', null, `SHA-256 · ${t('original')}`) : null,
          r.sha256In ? h('dd', { class: 'hash' }, r.sha256In) : null,
          r.sha256Out ? h('dt', null, `SHA-256 · ${t('result')}`) : null,
          r.sha256Out ? h('dd', { class: 'hash' }, r.sha256Out) : null,
        ),
      );
  }

  update();
  return { el, update };
}
