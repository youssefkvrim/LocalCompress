/**
 * Tiny DOM builder. The UI never parses HTML strings — every node is built
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

/** 1.5px stroke icon set, drawn on a 24px grid. */
export const icon = {
  lock: () =>
    s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' },
      s('rect', { x: 5, y: 10.5, width: 14, height: 10, rx: 2 }),
      s('path', { d: 'M8 10.5V7.5a4 4 0 0 1 8 0v3' })),
  down: () => s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' }, s('path', { d: 'M12 4v14M6 12l6 6 6-6M5 21h14' })),
  plus: () => s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' }, s('path', { d: 'M12 5v14M5 12h14' })),
  close: () => s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' }, s('path', { d: 'M6 6l12 12M18 6L6 18' })),
  check: () => s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' }, s('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })),
  sliders: () =>
    s('svg', { viewBox: '0 0 24 24', class: 'i', 'aria-hidden': 'true' },
      s('path', { d: 'M4 7h10M18 7h2M4 17h4M12 17h8' }),
      s('circle', { cx: 16, cy: 7, r: 2 }),
      s('circle', { cx: 10, cy: 17, r: 2 })),
};
