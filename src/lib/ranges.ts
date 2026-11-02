/**
 * Page ranges typed by the user, 1-based: "1-3, 5, 8-" (8- = to the end).
 * Each range becomes one group of 0-based page indices. Null if anything is invalid.
 */
export function parseRanges(text: string, count: number): number[][] | null {
  const groups: number[][] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)\s*(?:-\s*(\d*))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : m[2] === '' ? count : Number(m[2]);
    if (a < 1 || b > count || a > b) return null;
    groups.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return groups.length ? groups : null;
}
