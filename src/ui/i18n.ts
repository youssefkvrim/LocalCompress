/** French first, English on request. Each entry: [français, English]. */
import type { Reason } from '../lib/types';
import type { Category } from '../lib/detect';

export type Lang = 'fr' | 'en';

const TEXT = {
  title: ['Compressez vos fichiers.', 'Compress your files.'],
  titleEnd: ['Ils restent ici.', 'They stay here.'],
  sub: ['Images, PDF, présentations, vidéos… Tout se passe dans votre navigateur.', 'Images, PDFs, presentations, videos… Everything happens in your browser.'],
  drop: ['Déposez vos fichiers ici', 'Drop your files here'],
  browse: ['ou cliquez pour les choisir', 'or click to choose them'],
  release: ['Relâchez pour compresser', 'Release to compress'],
  lossless: ['Sans perte', 'Lossless'],
  balanced: ['Équilibré', 'Balanced'],
  compact: ['Compact', 'Compact'],
  'hint.lossless': ['Qualité identique, au pixel près.', 'Identical quality, pixel for pixel.'],
  'hint.balanced': ['Beaucoup plus léger, différence invisible.', 'Much lighter, no visible difference.'],
  'hint.compact': ['Le plus léger possible, qualité réduite.', 'As light as possible, reduced quality.'],
  save: ['Enregistrer', 'Save'],
  saveAll: ['Tout enregistrer (.zip)', 'Save all (.zip)'],
  clear: ['Tout effacer', 'Clear all'],
  remove: ['Retirer', 'Remove'],
  waiting: ['En attente', 'Waiting'],
  verified: ['Vérifié', 'Verified'],
  identical: ['qualité identique', 'identical quality'],
  info: ['Informations', 'Information'],
  close: ['Fermer', 'Close'],
  footer: ['Les fichiers restent sur votre navigateur, rien n’est envoyé à un serveur.', 'Your files stay in your browser, nothing is sent to a server.'],
  contact: ['Un bug, une idée ?', 'A bug, an idea?'],

  'doc.privacy': ['Confidentialité', 'Privacy'],
  'doc.privacyText': [
    'LocalCompress fonctionne entièrement dans votre navigateur, sur cet ordinateur. Aucun fichier n’est envoyé, stocké ni analysé sur un serveur. L’application continue de fonctionner sans connexion.',
    'LocalCompress runs entirely in your browser, on this computer. No file is ever sent, stored or analysed on a server. The application keeps working without a connection.',
  ],
  uploads: ['envois', 'uploads'],
  external: ['serveurs externes', 'external servers'],
  blocked: ['tentatives bloquées', 'blocked attempts'],
  offline: ['Prêt à fonctionner hors ligne', 'Ready to work offline'],
  notOffline: ['Mode hors ligne en préparation', 'Offline mode not ready yet'],
  misconfig: ['Configuration du serveur incomplète : prévenez l’administrateur.', 'Incomplete server configuration: tell your administrator.'],
  'doc.settings': ['Réglages', 'Settings'],
  'set.meta': ['Retirer les informations cachées', 'Remove hidden information'],
  'set.metaHint': ['Position GPS, auteur, appareil. Les étiquettes de confidentialité sont conservées.', 'GPS location, author, device. Confidentiality labels are kept.'],
  'set.macros': ['Accepter les fichiers à macros', 'Accept files with macros'],
  'set.macrosHint': ['.pptm, .xlsm, .docm. Les macros restent intactes.', '.pptm, .xlsm, .docm. Macros stay intact.'],
  'doc.modes': ['Les trois modes', 'The three modes'],
  'doc.modesText': [
    'Sans perte : le contenu reste identique, seule la façon de le ranger change. Équilibré : les images et vidéos sont réencodées, la différence ne se voit pas. Compact : le plus léger possible, la qualité baisse un peu. Un fichier n’est proposé que s’il est vraiment plus léger.',
    'Lossless: the content stays identical, only the way it is stored changes. Balanced: images and videos are re-encoded, the difference cannot be seen. Compact: as light as possible, quality drops a little. A file is only offered when it is really lighter.',
  ],
  'doc.formats': ['Formats pris en charge', 'Supported formats'],
  'doc.checks': ['Vérifications', 'Checks'],
  'doc.checksText': [
    'Avant d’être proposé, chaque résultat est rouvert et contrôlé : image décodée et comparée pixel par pixel en mode sans perte, archive relue entrée par entrée (CRC-32), document rouvert et liens internes vérifiés, vidéo relue du début à la fin. Au moindre doute, l’original est conservé. L’original n’est jamais modifié.',
    'Before it is offered, every result is reopened and checked: images decoded and compared pixel by pixel in lossless mode, archives re-read entry by entry (CRC-32), documents reopened and internal links verified, videos read from start to end. At the slightest doubt, the original is kept. The original is never modified.',
  ],
  'doc.technical': ['Détails techniques', 'Technical details'],
  'doc.engines': [
    'Moteurs : JPEG sans perte (Huffman optimal, progressif), MozJPEG, OxiPNG, libdeflate, libwebp, libavif, FLAC, WebCodecs (H.264, AAC, HEVC), pdf-lib, Mediabunny.',
    'Engines: lossless JPEG (optimal Huffman, progressive), MozJPEG, OxiPNG, libdeflate, libwebp, libavif, FLAC, WebCodecs (H.264, AAC, HEVC), pdf-lib, Mediabunny.',
  ],
  requests: ['Requêtes observées', 'Observed requests'],
  storage: ['Stockage temporaire sur cet ordinateur', 'Temporary storage on this computer'],
  purge: ['Vider', 'Empty'],
  verify: [
    'Ce panneau montre ce que l’application observe d’elle-même. La référence reste une vérification indépendante (capture réseau).',
    'This panel shows what the application observes about itself. An independent check (network capture) remains the reference.',
  ],
  'doc.contact': ['Contact', 'Contact'],
  'doc.contactText': ['Un bug, une idée de format ou d’amélioration ? Écrivez au développeur :', 'A bug, an idea for a format or an improvement? Write to the developer:'],
} satisfies Record<string, [string, string]>;

const CATEGORIES: Record<Category, [string, string]> = {
  image: ['Image', 'Image'],
  pdf: ['PDF', 'PDF'],
  presentation: ['Présentation', 'Presentation'],
  spreadsheet: ['Tableur', 'Spreadsheet'],
  document: ['Document', 'Document'],
  video: ['Vidéo', 'Video'],
  audio: ['Audio', 'Audio'],
  archive: ['Archive', 'Archive'],
  other: ['Fichier', 'File'],
};

const FORMATS: Record<Exclude<Category, 'other'>, string> = {
  image: 'JPEG, PNG, WebP, AVIF, HEIC, BMP, TIFF, GIF',
  pdf: 'PDF',
  presentation: 'PPTX, ODP, PPTM',
  spreadsheet: 'XLSX, ODS, XLSM',
  document: 'DOCX, ODT, DOCM',
  video: 'MP4, MOV, MKV, WebM',
  audio: 'WAV, MP3, M4A',
  archive: 'ZIP',
};

const REASONS: Record<Reason, [string, string]> = {
  'already-optimal': ['Déjà compact, rien à gagner.', 'Already compact, nothing to gain.'],
  'video-lossless': ['Une vidéo ne peut pas être allégée sans perte. Choisissez Équilibré.', 'A video cannot be made lighter losslessly. Choose Balanced.'],
  animated: ['Image animée, laissée telle quelle.', 'Animated image, left as is.'],
  'too-large': ['Fichier trop volumineux.', 'File too large.'],
  unreadable: ['Fichier illisible.', 'Unreadable file.'],
  encrypted: ['Protégé par mot de passe, non modifié.', 'Password protected, not modified.'],
  signed: ['Document signé : le modifier casserait la signature.', 'Signed document: changing it would break the signature.'],
  macro: ['Fichier à macros, désactivé dans les Informations.', 'File with macros, disabled in Information.'],
  'unsafe-paths': ['Contenu suspect, refusé.', 'Suspicious content, refused.'],
  'no-codec': ['Format non pris en charge sur cet ordinateur.', 'Format not supported on this computer.'],
  unsupported: ['Format non pris en charge.', 'Unsupported format.'],
  validation: ['Le résultat n’a pas passé la vérification. L’original est intact.', 'The result failed verification. The original is untouched.'],
  quota: ['Espace disque insuffisant.', 'Not enough disk space.'],
  corrupt: ['Fichier endommagé ou illisible.', 'Damaged or unreadable file.'],
};

let lang: Lang = (() => {
  try {
    return localStorage.getItem('localcompress.lang') === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
})();
document.documentElement.lang = lang;

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem('localcompress.lang', l);
  } catch {
    /* keep in memory */
  }
}

const pick = ([fr, en]: readonly [string, string]) => (lang === 'fr' ? fr : en);
export const t = (k: keyof typeof TEXT) => pick(TEXT[k]);
export const reasonText = (r: Reason = 'unsupported') => pick(REASONS[r]);
export const categoryText = (c: Category) => pick(CATEGORIES[c]);
export const formatList = () => Object.entries(FORMATS).map(([c, f]) => [categoryText(c as Category), f] as const);

export function bytes(n: number): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < 4) (n /= 1000), i++;
  const digits = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

export function percent(fraction: number): string {
  const v = (fraction * 100).toLocaleString(lang, { maximumFractionDigits: fraction >= 0.1 ? 0 : 1 });
  return lang === 'fr' ? `-${v} %` : `-${v}%`;
}
