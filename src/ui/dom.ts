/**
 * Tiny DOM builder. The UI never parses HTML strings: every node is built
 * with createElement/textContent, which is what lets the CSP enforce
 * Trusted Types with a policy that rejects all HTML.
 */
type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null> & { class?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, children);
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElement {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  append(el, children);
  return el;
}

function apply(el: HTMLElement, attrs: Attrs | null) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
}

function append(el: Element, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

export function replace(el: Element, ...children: Child[]) {
  clear(el);
  append(el, children);
}

/** Line icon on a 24px grid, drawn from path data. */
const line = (...d: string[]) => () => s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' }, ...d.map((p) => s('path', { d: p })));

export const icon = {
  down: line('M12 4v12M7 11l5 5 5-5M5 20h14'),
  plus: line('M12 5v14M5 12h14'),
  close: line('M6 6l12 12M18 6 6 18'),
  check: line('M5 12.5l4.5 4.5L19 7.5'),
  info: line('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5M12 8h.01'),
  mail: line('M4 6h16v12H4z', 'M4 7l8 6 8-6'),
};

/** One icon per category of file, as the user sees them. */
export const categoryIcon: Record<string, () => SVGElement> = {
  image: line('M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15.5 9.5h.01'),
  pdf: line('M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 13h6M10 17h4'),
  presentation: line('M3 4h18v12H3z', 'M12 16v4M8 20h8', 'M8 12V9M12 12V7M16 12v-2'),
  spreadsheet: line('M4 4h16v16H4z', 'M4 10h16M4 15h16M10 4v16'),
  document: line('M7 3h7l5 5v13H7z', 'M14 3v5h5', 'M10 12h6M10 15h6M10 18h4'),
  video: line('M4 6h12v12H4z', 'M16 10l4-2v8l-4-2'),
  audio: line('M9 18V6l10-2v12', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'),
  archive: line('M4 7h16v13H4z', 'M3 4h18v3H3z', 'M10 11h4'),
  other: line('M7 3h7l5 5v13H7z', 'M14 3v5h5'),
};

/** The LocalCompress mark, same drawing as public/icon.svg. */
export function logo() {
  const g = (attrs: Record<string, string | number>, ...d: string[]) => s('g', attrs, ...d.map((p) => s('path', { d: p })));
  return s(
    'svg',
    { viewBox: '0 0 60 64', class: 'logo', 'aria-hidden': 'true', fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    g({ stroke: 'var(--navy)', 'stroke-width': 5 }, 'M10 24V10a6 6 0 0 1 6-6h18l16 16v4', 'M10 40v14a6 6 0 0 0 6 6h28a6 6 0 0 0 6-6V40', 'M30 24v16'),
    g({ fill: 'var(--navy)', stroke: 'var(--navy)', 'stroke-width': 2 }, 'M34 4v12a4 4 0 0 0 4 4h12z'),
    g({ stroke: 'var(--blue)', 'stroke-width': 5 }, 'M3 32h13M58 32H44'),
    g({ fill: 'var(--blue)', stroke: 'var(--blue)', 'stroke-width': 3 }, 'M17 25.5 23.5 32 17 38.5z', 'M43 25.5 36.5 32 43 38.5z'),
  );
}
