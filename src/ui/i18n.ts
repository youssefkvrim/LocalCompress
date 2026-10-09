/** French first, English on request. Each entry: [français, English]. */
import type { Reason } from '../lib/types';
import type { Category } from '../lib/detect';

export type Lang = 'fr' | 'en';

const TEXT = {
  title: ['Compressez vos fichiers.', 'Compress your files.'],
  sub: ['Images, PDF, documents, vidéos et archives.', 'Images, PDFs, documents, videos and archives.'],
  sub2: ['Adapté aux documents classifiés C1, C2 et C3.', 'Suitable for C1, C2 and C3 classified documents.'],
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
  saveAll: ['Enregistrer les {n} (.zip)', 'Save all {n} (.zip)'],
  clear: ['Tout effacer', 'Clear all'],
  remove: ['Retirer', 'Remove'],
  waiting: ['En attente', 'Waiting'],
  'step.compress': ['Compression', 'Compressing'],
  'step.verify': ['Vérification', 'Verifying'],
  'step.finish': ['Finalisation', 'Finishing'],
  verified: ['Vérifié', 'Verified'],
  identical: ['qualité identique', 'identical quality'],
  active: [
    'Contient des macros, des objets intégrés ou des liens externes : copiés tels quels, le fichier n’est pas nettoyé.',
    'Contains macros, embedded objects or external links: copied as they are, the file is not cleaned.',
  ],
  info: ['Informations', 'Information'],
  close: ['Fermer', 'Close'],
  footer: ['Vos fichiers restent dans votre navigateur, rien n’est envoyé à un serveur.', 'Your files stay in your browser, nothing is sent to a server.'],
  contact: ['Un bug, une idée ?', 'A bug, an idea?'],

  'doc.privacy': ['Confidentialité', 'Privacy'],
  'doc.privacyText': [
    'Vous pouvez y déposer des documents C1, C2 et C3 : le traitement se fait entièrement sur cet ordinateur, sans compte ni connexion, et l’application fonctionne aussi hors ligne.',
    'You can use it for C1, C2 and C3 documents: processing happens entirely on this computer, with no account and no connection, and the application also works offline.',
  ],
  'doc.privacyText2': [
    'Les fichiers ne quittent jamais le navigateur. Aucune information n’est collectée : ni nom de fichier, ni statistique, ni traceur. Une empreinte SHA-256 de chaque fichier et de son résultat est calculée sur cet ordinateur, pour en garantir la traçabilité.',
    'Files never leave the browser. No information is collected: no file names, no statistics, no trackers. A SHA-256 fingerprint of each file and of its result is computed on this computer, for traceability.',
  ],
  'doc.privacyText3': [
    'LocalCompress est conçu pour une confidentialité maximale : il évite de recourir à des outils tiers hébergés sur des serveurs externes, ou à des logiciels opaques.',
    'LocalCompress is designed for maximum privacy: it avoids relying on third-party tools hosted on external servers, or on opaque software.',
  ],
  offline: ['Prêt à fonctionner hors ligne', 'Ready to work offline'],
  'guard.pending': ['Préparation de la protection…', 'Setting up protection…'],
  'guard.pendingSub': ['Vos fichiers ne quitteront pas cet ordinateur.', 'Your files will not leave this computer.'],
  'guard.slow': ['Premier lancement : l’application s’installe pour fonctionner hors ligne, encore quelques secondes.', 'First launch: the application is installing itself to work offline, a few more seconds.'],
  'guard.failed': [
    'La protection n’a pas pu démarrer : le traitement est désactivé par sécurité. Rechargez la page ; si le problème persiste, prévenez l’administrateur.',
    'Protection could not start: processing is disabled for safety. Reload the page; if the problem persists, tell your administrator.',
  ],
  'update.available': ['Une nouvelle version de LocalCompress est disponible.', 'A new version of LocalCompress is available.'],
  'update.busy': ['Une nouvelle version est disponible : elle pourra être installée une fois vos fichiers terminés.', 'A new version is available: it can be installed once your files are done.'],
  'update.apply': ['Mettre à jour', 'Update'],
  'update.stale': ['LocalCompress a été mis à jour dans un autre onglet. Enregistrez vos résultats, puis rechargez cette page pour continuer.', 'LocalCompress was updated in another tab. Save your results, then reload this page to continue.'],
  'update.reloadPage': ['Recharger', 'Reload'],
  misconfig: ['Configuration du serveur incomplète : le traitement est désactivé par sécurité. Prévenez l’administrateur.', 'Incomplete server configuration: processing is disabled for safety. Tell your administrator.'],
  'doc.settings': ['Réglages', 'Settings'],
  'set.meta': ['Effacer la localisation et l’auteur', 'Erase location and author'],
  'set.metaHint': [
    'La position GPS, le nom de l’auteur et le modèle d’appareil sont retirés des fichiers. Attention : dans les images et les vidéos, une classification (C1, C2, C3) enregistrée dans ces informations peut aussi être retirée. Laissez désactivé pour les documents classifiés.',
    'GPS position, author name and device model are removed from files. Warning: in images and videos, a classification (C1, C2, C3) stored in this information can be removed too. Leave off for classified documents.',
  ],
  'set.macros': ['Accepter les fichiers avec macros', 'Accept files with macros'],
  'set.macrosHint': ['Les fichiers .pptm, .xlsm et .docm sont aussi compressés. Leurs macros restent intactes.', '.pptm, .xlsm and .docm files are compressed too. Their macros stay intact.'],
  'doc.modes': ['Les trois modes', 'The three modes'],
  'mode.lossless': ['le contenu reste identique, seule la façon de le ranger change.', 'the content stays identical, only the way it is stored changes.'],
  'mode.balanced': ['les images et vidéos sont réencodées, la différence ne se voit pas.', 'images and videos are re-encoded, the difference cannot be seen.'],
  'mode.compact': [
    'le plus léger possible, la qualité baisse un peu. Un fichier n’est proposé que s’il est vraiment plus léger.',
    'as light as possible, quality drops a little. A file is only offered when it is really lighter.',
  ],
  'doc.formats': ['Formats pris en charge', 'Supported formats'],
  'doc.checks': ['Vérifications', 'Checks'],
  'doc.checksText': [
    'Avant d’être proposé, chaque résultat est rouvert et contrôlé : image comparée pixel par pixel en mode sans perte, archive relue entrée par entrée, document rouvert et liens internes vérifiés, vidéo relue du début à la fin. Au moindre doute, l’original est conservé.',
    'Before it is offered, every result is reopened and checked: images compared pixel by pixel in lossless mode, archives re-read entry by entry, documents reopened and internal links verified, videos read from start to end. At the slightest doubt, the original is kept.',
  ],
  'doc.tools': ['Outils utilisés', 'Tools used'],
  'doc.toolsText': ['LocalCompress s’appuie sur ces projets open source et maintenus à jour :', 'LocalCompress relies on these open-source, actively maintained projects:'],
  storage: ['Stockage temporaire sur cet ordinateur', 'Temporary storage on this computer'],
  purge: ['Vider le stockage temporaire', 'Empty temporary storage'],
  'doc.contact': ['Contact', 'Contact'],
  'doc.contactText': ['Un bug ou une idée d’amélioration ? Écrivez à un développeur :', 'A bug or an idea for an improvement? Write to a developer:'],
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

/** Only what is actually compressed today. */
const FORMATS: Partial<Record<Category, string>> = {
  image: 'JPEG, PNG',
  pdf: 'PDF',
  presentation: 'PPTX, PPTM, ODP',
  spreadsheet: 'XLSX, XLSM, ODS',
  document: 'DOCX, DOCM, ODT',
  video: 'MP4, MOV, MKV, WebM',
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
  'unsafe-paths': ['Noms de fichiers dangereux ou ambigus à l’intérieur : laissé tel quel.', 'Dangerous or ambiguous file names inside: left as is.'],
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
export const t = (k: keyof typeof TEXT, n?: number) => pick(TEXT[k]).replace('{n}', String(n ?? ''));
export const pickText = pick;
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
