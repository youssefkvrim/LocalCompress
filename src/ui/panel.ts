/** Side panel: privacy (what the app observes about itself) and settings. */
import { purgeSession, usage } from '../lib/scratch';
import { cspString } from '../security/csp';
import type { Settings } from '../lib/types';
import { h, icon, replace } from './dom';
import { store } from './store';
import { bytes, t } from './i18n';

declare const __VERSION__: string;

/** Production must run cross-origin isolated: proof the security headers arrived. */
export const headersOk = () => !import.meta.env.PROD || crossOriginIsolated;

export function panel() {
  const body = h('div', { class: 'panel-body' });
  const tabs = h('nav', { class: 'tabs' });
  const el = h(
    'aside',
    { class: 'panel' },
    h('div', { class: 'panel-scrim', onclick: () => close() }),
    h('div', { class: 'panel-sheet', role: 'dialog', 'aria-modal': 'true' }, h('header', { class: 'panel-head' }, tabs, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => close() }, icon.close())), body),
  );
  let tab: 'privacy' | 'settings' = 'privacy';
  let techOpen = false;

  function show(which: typeof tab) {
    tab = which;
    replace(
      tabs,
      ...(['privacy', 'settings'] as const).map((id) => h('button', { class: 'tab', type: 'button', 'aria-selected': String(id === tab), onclick: () => show(id) }, t(id))),
    );
    el.classList.add('open');
    render();
  }

  function close() {
    el.classList.remove('open');
  }

  function render() {
    if (!el.classList.contains('open')) return;
    if (tab === 'settings') return replace(body, toggle('set.meta', 'set.metaHint', 'stripMetadata'), toggle('set.macros', 'set.macrosHint', 'allowMacros'));

    const net = store.network;
    const count = (f: (n: (typeof net)[number]) => boolean) => net.filter(f).length;
    const uploads = count((n) => !n.blocked && n.method !== 'GET' && n.method !== 'HEAD');
    const external = count((n) => !n.blocked && /^https?:/.test(n.url) && new URL(n.url).origin !== location.origin);
    const blocked = count((n) => n.blocked);
    const counter = (v: number, label: string, good: boolean) => h('div', { class: `counter ${good ? 'good' : 'bad'}` }, h('b', null, String(v)), h('span', null, label));
    const storage = h('span', null, '…');
    void usage().then((b) => (storage.textContent = bytes(b)));

    replace(
      body,
      h('p', { class: 'statement' }, t('statement')),
      headersOk() ? null : h('p', { class: 'warn' }, t('misconfig')),
      h('div', { class: 'counters' }, counter(uploads, t('uploads'), !uploads), counter(external, t('external'), !external), counter(blocked, t('blocked'), true)),
      h('p', { class: 'line' }, store.offline ? icon.check() : icon.close(), t(store.offline ? 'offline' : 'online')),
      h(
        'details',
        { class: 'tech', open: techOpen, ontoggle: (e: Event) => (techOpen = (e.target as HTMLDetailsElement).open) },
        h('summary', null, t('technical')),
        h('h4', null, t('requests')),
        h('ul', { class: 'net' }, ...net.slice(-100).reverse().map((n) => h('li', { class: n.blocked ? 'blocked' : '' }, `${n.blocked ? '✕' : '✓'} ${n.scope} ${n.method} ${short(n.url)}${n.why ? ` — ${n.why}` : ''}`))),
        h('h4', null, 'CSP'),
        h('code', { class: 'csp' }, cspString(true)),
        h('h4', null, t('storage')),
        h('p', { class: 'line spread' }, storage, h('button', { class: 'btn ghost', type: 'button', onclick: () => void purgeSession().then(render) }, t('purge'))),
        h('p', { class: 'muted' }, t('verify')),
        h('p', { class: 'muted' }, `LocalCompress ${__VERSION__}`),
      ),
    );
  }

  function toggle(label: 'set.meta' | 'set.macros', hint: 'set.metaHint' | 'set.macrosHint', key: keyof Settings) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: !!store.settings[key] }) as HTMLInputElement;
    input.addEventListener('change', () => store.set({ [key]: input.checked }));
    return h('label', { class: 'toggle' }, h('span', null, h('b', null, t(label)), h('small', null, t(hint))), input, h('span', { class: 't-ui', 'aria-hidden': 'true' }));
  }

  return { el, show, close, render };
}

function short(u: string) {
  try {
    const url = new URL(u, location.href);
    return url.origin === location.origin ? url.pathname : url.href;
  } catch {
    return u;
  }
}
