/** a > b, comparing "major.minor.patch" numerically. */
export function newer(a: string, b: string): boolean {
  const x = a.split('.').map((n) => parseInt(n, 10) || 0);
  const y = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
