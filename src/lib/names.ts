/**
 * A file name safe to show and to write. Removes control characters and
 * the invisible bidirectional overrides that can disguise an extension
 * ("invoice‮gpj.exe" displays as "invoiceexe.jpg"), and characters that
 * would become paths or are forbidden on Windows when a ZIP is extracted.
 */
export function safeName(name: string): string {
  const clean = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  return clean.slice(0, 200) || 'file';
}
