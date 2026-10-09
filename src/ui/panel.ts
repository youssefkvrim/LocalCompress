/**
 * The Informations page: privacy, settings, modes, formats, checks, the
 * tools LocalCompress is built on, temporary storage and contact.
 */
import { usage } from '../lib/scratch';
import type { Settings } from '../lib/types';
import { h, icon, replace } from './dom';
import { headersOk, store } from './store';
import { bytes, formatList, getLang, pickText, t } from './i18n';

declare const __VERSION__: string;
export const CONTACT = 'youssef.karim@safrangroup.com';


/** Public projects LocalCompress is built on: [name, [fr, en], link]. */
const TOOLS: [string, [string, string], string][] = [
  ['Mediabunny', ['Lit et réencode les vidéos et les sons.', 'Reads and re-encodes videos and sounds.'], 'https://github.com/Vanilagy/mediabunny'],
  ['pdf-lib', ['Ouvre et réécrit les fichiers PDF.', 'Opens and rewrites PDF files.'], 'https://github.com/Hopding/pdf-lib'],
  ['jSquash', ['Compresse les images (MozJPEG, OxiPNG).', 'Compresses images (MozJPEG, OxiPNG).'], 'https://github.com/jamsinclair/jSquash'],
  ['libdeflate', ['Compresse les archives et documents, plus fort que le ZIP classique.', 'Compresses archives and documents, harder than classic ZIP.'], 'https://github.com/ebiggers/libdeflate'],
  ['hash-wasm', ['Calcule l’empreinte qui prouve qu’un fichier n’a pas changé.', 'Computes the fingerprint that proves a file has not changed.'], 'https://github.com/Daninet/hash-wasm'],
];

/** Remove every finished file (from the list and the disk); waiting and running files stay. */
async function emptyStorage() {
  for (const item of store.items.filter((i) => i.state === 'done' || i.state === 'failed')) await store.remove(item);
}

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

  const open = () => (el.classList.add('open'), render());
  const close = () => el.classList.remove('open');
  document.addEventListener('keydown', (e) => e.key === 'Escape' && el.isConnected && close());

  function render() {
    if (!el.classList.contains('open')) return;
    const storage = h('span', null, '…');
    void usage().then((b) => (storage.textContent = bytes(b)));
    const section = (title: string, ...content: (Node | null)[]) => h('section', null, h('h3', null, title), ...content);

    replace(
      body,
      section(
        t('doc.privacy'),
        h('p', null, t('doc.privacyText')),
        h('p', null, t('doc.privacyText2')),
        h('p', null, t('doc.privacyText3')),
        headersOk() ? null : h('p', { class: 'warn' }, t('misconfig')),
        import.meta.env.PROD && store.guard === 'on' ? h('p', { class: 'line' }, icon.check(), t('offline')) : null,
      ),
      section(t('doc.settings'), toggle('set.meta', 'set.metaHint', 'stripMetadata'), toggle('set.macros', 'set.macrosHint', 'allowMacros')),
      section(t('doc.modes'), ...(['lossless', 'balanced', 'compact'] as const).map((m) => h('p', null, h('b', null, `${t(m)}${getLang() === 'fr' ? ' :' : ':'} `), t(`mode.${m}`)))),
      section(t('doc.formats'), h('dl', { class: 'formats' }, ...formatList().flatMap(([c, f]) => [h('dt', null, c), h('dd', null, f)]))),
      section(t('doc.checks'), h('p', null, t('doc.checksText'))),
      section(
        t('doc.tools'),
        h('p', null, t('doc.toolsText')),
        h(
          'ul',
          { class: 'tools' },
          ...TOOLS.map(([name, text, url]) =>
            h('li', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, name, icon.external()), h('span', null, pickText(text))),
          ),
        ),
      ),
      section(
        t('storage'),
        h('p', { class: 'line spread' }, storage, h('button', { class: 'icon-btn danger', type: 'button', 'aria-label': t('purge'), title: t('purge'), onclick: () => void emptyStorage().then(render) }, icon.trash())),
      ),
      section(t('doc.contact'), h('p', null, t('doc.contactText')), h('a', { class: 'btn ghost', href: `mailto:${CONTACT}?subject=LocalCompress` }, icon.mail(), CONTACT)),
      h('p', { class: 'version' }, `LocalCompress ${__VERSION__}`),
    );
  }

  function toggle(label: 'set.meta' | 'set.macros', hint: 'set.metaHint' | 'set.macrosHint', key: keyof Settings) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: !!store.settings[key] }) as HTMLInputElement;
    input.addEventListener('change', () => store.set({ [key]: input.checked }));
    return h('label', { class: 'toggle' }, h('span', null, h('b', null, t(label)), h('small', null, t(hint))), input, h('span', { class: 't-ui', 'aria-hidden': 'true' }));
  }

  return { el, open, render };
}
