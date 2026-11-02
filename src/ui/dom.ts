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
  trash: line('M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'),
  external: line('M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'),
  undo: line('M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'),
  minus: line('M5 12h14'),
  expand: line('M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'),
  shrink: line('M4 14h6v6', 'M20 10h-6V4', 'M14 10l7-7', 'M3 21l7-7'),
  shield: line('M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'),
  redo: line('M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'),
  reset: line('M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'),
  fit: line('M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'),
  eye: line('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
  eraser: line('M7 21h13', 'M16.5 3.5l4 4a1.5 1.5 0 0 1 0 2.1L11 19H7l-3.5-3.5a1.5 1.5 0 0 1 0-2.1l10.9-9.9a1.5 1.5 0 0 1 2.1 0z', 'M9.5 9.5l5 5'),
  brush: line('M9.1 14.9a3 3 0 0 0-4.2 0C3.5 16.3 4 19 2.5 20.5c2.5.8 5.6.5 7-.9a3 3 0 0 0-.4-4.7z', 'M9 15l11.5-11.5a1.5 1.5 0 0 1 2 2L11 17'),
  hand: line('M18 11V6a2 2 0 0 0-4 0', 'M14 10V4a2 2 0 0 0-4 0v2', 'M10 10.5V6a2 2 0 0 0-4 0v8', 'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15'),
};

const assetIcon = (name: string) => () => h('img', { class: 'i-asset', src: `/${name}.png`, alt: '', 'aria-hidden': 'true' });

/** One icon per category of file, as the user sees them. */
export const categoryIcon: Record<string, () => HTMLElement> = {
  image: assetIcon('image'),
  pdf: assetIcon('pdf'),
  presentation: assetIcon('documents'),
  spreadsheet: assetIcon('documents'),
  document: assetIcon('documents'),
  video: assetIcon('video'),
  audio: assetIcon('music'),
  archive: assetIcon('archive'),
  other: assetIcon('documents'),
};

/**
 * The LocalKit mark, same drawing as public/logo.svg: a page with a chevron
 * (the file goes through), two lighter pages behind it (one kit, several
 * tools). Rounded corners come from a stroke of the fill colour.
 */
export function logo() {
  const page = (d: string, color: string) => s('path', { d, fill: color, stroke: color });
  return s(
    'svg',
    { viewBox: '0 0 62 72', class: 'logo', 'aria-hidden': 'true', 'stroke-width': 6, 'stroke-linejoin': 'round' },
    page('M46 15 57 18v39l-11 3z', 'var(--blue-tint)'),
    page('M36 9 47 12v50l-11 3z', 'var(--blue-mid)'),
    page('M5 20 36 6v60L5 53z', 'var(--blue)'),
    s('path', { d: 'M15 29l9 9-9 9', fill: 'none', stroke: 'var(--white)', 'stroke-linecap': 'round' }),
  );
}
