/**
 * The Informations page: privacy, settings, modes, formats, checks,
 * technical details and contact. Everything a curious user may want,
 * kept out of the main screen.
 */
import { purgeSession, usage } from '../lib/scratch';
import { cspString } from '../security/csp';
import type { Settings } from '../lib/types';
import { h, icon, replace } from './dom';
import { store } from './store';
import { bytes, formatList, t } from './i18n';

declare const __VERSION__: string;
export const CONTACT = 'youssef.karim@safrangroup.com';

/** Production must run cross-origin isolated: proof the security headers arrived. */
export const headersOk = () => !import.meta.env.PROD || crossOriginIsolated;

export function panel() {
  const body = h('div', { class: 'panel-body' });
  const el = h(
    'aside',
    { class: 'panel' },
    h('div', { class: 'panel-scrim', onclick: () => close() }),
    h(
      'div',
      { class: 'panel-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('info') },
      h('header', { class: 'panel-head' }, h('h2', null, t('info')), h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => close() }, icon.close())),
      body,
    ),
  );
  let techOpen = false;

  const open = () => (el.classList.add('open'), render());
  const close = () => el.classList.remove('open');
  document.addEventListener('keydown', (e) => e.key === 'Escape' && el.isConnected && close());

  function render() {
    if (!el.classList.contains('open')) return;
    const net = store.network;
    const count = (f: (n: (typeof net)[number]) => boolean) => net.filter(f).length;
    const uploads = count((n) => !n.blocked && n.method !== 'GET' && n.method !== 'HEAD');
    const external = count((n) => !n.blocked && /^https?:/.test(n.url) && new URL(n.url).origin !== location.origin);
    const counter = (v: number, label: string, good: boolean) => h('div', { class: `counter ${good ? 'good' : 'bad'}` }, h('b', null, String(v)), h('span', null, label));
    const storage = h('span', null, '…');
    void usage().then((b) => (storage.textContent = bytes(b)));
    const section = (title: string, ...content: (Node | null)[]) => h('section', null, h('h3', null, title), ...content);

    replace(
      body,
      section(
        t('doc.privacy'),
        h('p', null, t('doc.privacyText')),
        headersOk() ? null : h('p', { class: 'warn' }, t('misconfig')),
        h('div', { class: 'counters' }, counter(uploads, t('uploads'), !uploads), counter(external, t('external'), !external), counter(count((n) => n.blocked), t('blocked'), true)),
        h('p', { class: 'line' }, store.offline ? icon.check() : icon.info(), t(store.offline ? 'offline' : 'notOffline')),
      ),
      section(t('doc.settings'), toggle('set.meta', 'set.metaHint', 'stripMetadata'), toggle('set.macros', 'set.macrosHint', 'allowMacros')),
      section(t('doc.modes'), h('p', null, t('doc.modesText'))),
      section(t('doc.formats'), h('dl', { class: 'formats' }, ...formatList().flatMap(([c, f]) => [h('dt', null, c), h('dd', null, f)]))),
      section(t('doc.checks'), h('p', null, t('doc.checksText'))),
      section(
        t('doc.contact'),
        h('p', null, t('doc.contactText')),
        h('a', { class: 'btn ghost', href: `mailto:${CONTACT}?subject=LocalCompress` }, icon.mail(), CONTACT),
      ),
      h(
        'details',
        { class: 'tech', open: techOpen, ontoggle: (e: Event) => (techOpen = (e.target as HTMLDetailsElement).open) },
        h('summary', null, t('doc.technical')),
        h('p', null, t('doc.engines')),
        h('h4', null, t('requests')),
        h('ul', { class: 'net' }, ...net.slice(-100).reverse().map((n) => h('li', { class: n.blocked ? 'blocked' : '' }, `${n.blocked ? '✕' : '✓'} ${n.scope} ${n.method} ${short(n.url)}${n.why ? `: ${n.why}` : ''}`))),
        h('h4', null, 'Content-Security-Policy'),
        h('code', { class: 'csp' }, cspString(true)),
        h('h4', null, t('storage')),
        h('p', { class: 'line spread' }, storage, h('button', { class: 'btn ghost small', type: 'button', onclick: () => void purgeSession().then(render) }, t('purge'))),
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

  return { el, open, render };
}

function short(u: string) {
  try {
    const url = new URL(u, location.href);
    return url.origin === location.origin ? url.pathname : url.href;
  } catch {
    return u;
  }
}
