import { purgeScratch, scratchUsage, type Capabilities, type Settings } from '@localcompress/core';
import { cspString } from '@localcompress/security';
import { h, icon, replace } from './dom';
import { store } from './store';
import { bytes, t } from './i18n';

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __ENGINES__: Record<string, string>;

type Tab = 'privacy' | 'settings';

/** True when the production security headers are demonstrably in force. */
export const headersOk = () => !import.meta.env.PROD || (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;

export class Panel {
  el: HTMLElement;
  private body = h('div', { class: 'panel-body' });
  private tabs = h('nav', { class: 'tabs', role: 'tablist' });
  private tab: Tab = 'privacy';
  private counters = h('div', { class: 'counters' });
  private netList = h('tbody');
  private storage = h('span', { class: 'mono' }, '…');

  constructor() {
    this.el = h(
      'aside',
      { class: 'panel', 'aria-hidden': 'true' },
      h('div', { class: 'panel-scrim', onclick: () => this.close() }),
      h(
        'div',
        { class: 'panel-sheet', role: 'dialog', 'aria-modal': 'true' },
        h('header', { class: 'panel-head' }, this.tabs, h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => this.close() }, icon.close())),
        this.body,
      ),
    );
    store.onNetwork(() => this.el.classList.contains('open') && this.tab === 'privacy' && this.renderNetwork());
  }

  show(tab: Tab) {
    this.tab = tab;
    const tabBtn = (id: Tab, label: string) =>
      h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => this.show(id) }, label);
    replace(this.tabs, tabBtn('privacy', t('panel.privacy')), tabBtn('settings', t('panel.settings')));
    this.el.classList.add('open');
    this.el.setAttribute('aria-hidden', 'false');
    if (tab === 'privacy') this.renderPrivacy();
    else this.renderSettings();
  }

  close() {
    this.el.classList.remove('open');
    this.el.setAttribute('aria-hidden', 'true');
  }

  private renderPrivacy() {
    const sw = store.swState === 'active';
    replace(
      this.body,
      h('p', { class: 'statement' }, t('statement')),
      headersOk() ? null : h('p', { class: 'warn' }, t('misconfig')),
      this.counters,
      h('p', { class: 'line' }, sw ? icon.check() : icon.close(), sw ? t('offlineReady') : t('offlineNot')),
      h(
        'details',
        { class: 'tech' },
        h('summary', null, t('technical')),
        h('h4', null, t('network')),
        h('div', { class: 'net-wrap' }, h('table', { class: 'net' }, this.netList)),
        h('h4', null, t('enforcement')),
        h(
          'ul',
          { class: 'kv' },
          kv('CSP', 'connect-src self · no remote origin'),
          kv('Trusted Types', 'enforced'),
          kv('Egress guard', 'GET of app files only'),
          kv('Service worker', sw ? `firewall + offline (${store.swCache})` : store.swState),
          kv('COOP / COEP', headersOk() ? 'ok' : 'missing'),
        ),
        h('code', { class: 'csp' }, cspString(true)),
        h('h4', null, t('engines')),
        h('ul', { class: 'kv' }, ...Object.entries(__ENGINES__).map(([k, v]) => kv(k, v))),
        h('h4', null, t('workstation')),
        store.capabilities ? caps(store.capabilities) : null,
        h('h4', null, t('scratch')),
        h('div', { class: 'row-line' }, this.storage, h('button', { class: 'btn ghost', type: 'button', onclick: () => void this.purge() }, t('purge'))),
        h('h4', null, t('verify')),
        h('p', { class: 'muted' }, t('verifyText')),
        h('p', { class: 'muted' }, t('observedOnly')),
        h('p', { class: 'muted mono' }, `v${__APP_VERSION__} · ${__BUILD_ID__}`),
      ),
    );
    this.renderNetwork();
    void scratchUsage().then((u) => (this.storage.textContent = `${u.files} · ${bytes(u.bytes)}`));
  }

  private renderNetwork() {
    const net = store.network;
    const uploads = net.filter((n) => n.verdict === 'allowed' && n.method && n.method !== 'GET' && n.method !== 'HEAD').length;
    const external = net.filter((n) => {
      try {
        const u = new URL(n.url, location.href);
        return n.verdict === 'allowed' && u.origin !== location.origin && u.protocol !== 'blob:' && u.protocol !== 'data:';
      } catch {
        return false;
      }
    }).length;
    const blocked = net.filter((n) => n.verdict === 'blocked').length;
    const c = (v: number, label: string, good: boolean) => h('div', { class: `counter ${good ? 'good' : 'bad'}` }, h('b', null, String(v)), h('span', null, label));
    replace(this.counters, c(uploads, t('n.uploads'), uploads === 0), c(external, t('n.external'), external === 0), c(blocked, t('n.blocked'), true));
    replace(
      this.netList,
      ...net
        .slice(-100)
        .reverse()
        .map((n) => h('tr', { class: n.verdict }, h('td', null, n.scope), h('td', { class: 'url' }, `${n.method ?? 'GET'} ${short(n.url)}`), h('td', null, n.verdict === 'blocked' ? `✕ ${n.reason ?? ''}` : '✓'))),
    );
  }

  private async purge() {
    await purgeScratch();
    const u = await scratchUsage();
    this.storage.textContent = `${u.files} · ${bytes(u.bytes)}`;
  }

  private renderSettings() {
    const st = store.settings;
    const set = (patch: Partial<Settings>) => {
      store.setSettings(patch);
      this.renderSettings();
    };
    replace(
      this.body,
      choice(t('set.video'), [['avc', 'H.264'], ['hevc', 'H.265'], ['av1', 'AV1']], st.videoCodec, (v) => set({ videoCodec: v as Settings['videoCodec'] })),
      choice(t('set.image'), [['keep', t('set.keep')], ['webp', 'WebP'], ['avif', 'AVIF']], st.imageTarget, (v) => set({ imageTarget: v as Settings['imageTarget'] })),
      toggle(t('set.meta'), t('set.metaHint'), st.stripMetadata, (v) => set({ stripMetadata: v })),
      toggle(t('set.sha'), t('set.shaHint'), st.checksums, (v) => set({ checksums: v })),
      toggle(t('set.macros'), t('set.macrosHint'), st.allowMacros, (v) => set({ allowMacros: v })),
      h('p', { class: 'muted' }, t('set.note')),
    );
  }
}

const kv = (k: string, v: string) => h('li', null, h('span', null, k), h('b', null, v));

function short(u: string) {
  try {
    const url = new URL(u, location.href);
    return url.origin === location.origin ? url.pathname : url.href;
  } catch {
    return u;
  }
}

function caps(c: Capabilities) {
  const f = (k: string, ok: boolean) => h('li', { class: ok ? 'ok' : 'off' }, ok ? icon.check() : icon.close(), k);
  return h(
    'ul',
    { class: 'caps' },
    f('WebAssembly SIMD', c.wasmSimd),
    f('WebAssembly threads', c.wasmThreads),
    f('WebCodecs', c.webCodecs),
    f('OPFS', c.opfs),
    f('File System Access', c.fileSystemAccess),
    f(`${c.hardwareConcurrency} cores`, true),
  );
}

function choice(label: string, options: [string, string][], value: string, onChange: (v: string) => void) {
  return h(
    'fieldset',
    { class: 'choice' },
    h('legend', null, label),
    h(
      'div',
      { class: 'seg small' },
      ...options.map(([v, l]) => h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': String(v === value), onclick: () => onChange(v) }, l)),
    ),
  );
}

function toggle(label: string, hint: string, value: boolean, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked: value }) as HTMLInputElement;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, h('span', { class: 't-text' }, h('b', null, label), h('small', null, hint)), input, h('span', { class: 't-ui', 'aria-hidden': 'true' }));
}
