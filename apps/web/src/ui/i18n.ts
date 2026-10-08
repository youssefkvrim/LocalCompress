import type { Reason } from '@localcompress/core';

export type Lang = 'fr' | 'en';

const fr = {
  tagline: 'Le fichier reste ici.',
  sub: 'Compression sur ce poste. Rien n’est envoyé.',
  drop: 'Déposez vos fichiers',
  browse: 'Parcourir',
  release: 'Relâchez.',
  releaseSub: 'Le fichier reste ici.',
  'mode.lossless': 'Sans perte',
  'mode.balanced': 'Équilibré',
  'mode.compression': 'Compact',
  'hint.lossless': 'Contenu identique au bit près. Aucune perte de qualité.',
  'hint.balanced': 'Bien plus léger, différence invisible à l’œil.',
  'hint.compression': 'Le plus léger possible, perte de qualité visible.',
  save: 'Enregistrer',
  cancel: 'Annuler',
  remove: 'Retirer',
  clear: 'Tout effacer',
  waiting: 'En attente',
  working: 'En cours',
  checking: 'Vérification',
  failed: 'Échec',
  cancelled: 'Annulé',
  lossless: 'sans perte',
  verified: 'vérifié',
  local: 'Local',
  'panel.privacy': 'Confidentialité',
  'panel.settings': 'Réglages',
  close: 'Fermer',
  statement: 'Vos fichiers sont traités sur ce poste. Ils ne sont jamais envoyés à un serveur.',
  'n.uploads': 'envois',
  'n.external': 'serveurs externes',
  'n.blocked': 'tentatives bloquées',
  offlineReady: 'Fonctionne hors ligne',
  offlineNot: 'Mode hors ligne indisponible',
  misconfig: 'Configuration serveur incomplète : les en-têtes de sécurité sont absents. Prévenez l’administrateur.',
  technical: 'Détails techniques',
  network: 'Requêtes observées',
  enforcement: 'Protections actives',
  engines: 'Moteurs',
  workstation: 'Ce poste',
  scratch: 'Stockage temporaire local',
  purge: 'Vider',
  verify: 'Vérifier soi-même',
  verifyText: 'Coupez le réseau après le premier chargement : l’application fonctionne toujours. Une capture réseau pendant un traitement ne montre aucun envoi.',
  observedOnly: 'Ce panneau indique ce que l’application observe d’elle-même ; la vérification indépendante (capture réseau) reste la référence.',
  'set.video': 'Codec vidéo',
  'set.image': 'Format des images',
  'set.keep': 'Conserver le format',
  'set.meta': 'Retirer les métadonnées',
  'set.metaHint': 'GPS, auteur, appareil. Les étiquettes de sensibilité sont conservées.',
  'set.sha': 'Empreintes SHA-256',
  'set.shaHint': 'Pour la traçabilité de l’original et du résultat.',
  'set.macros': 'Autoriser les fichiers à macros',
  'set.macrosHint': '.pptm .xlsm .docm — le code VBA reste intact. Soumis à validation sécurité.',
  'set.note': 'Réglages conservés dans ce navigateur uniquement.',
  engine: 'Moteur',
  checks: 'Vérifications',
  original: 'Original',
  result: 'Résultat',
  before: 'Avant',
  after: 'Après',
} as const;

type Key = keyof typeof fr;

const en: Record<Key, string> = {
  tagline: 'The file stays here.',
  sub: 'Compressed on this workstation. Nothing is sent.',
  drop: 'Drop your files',
  browse: 'Browse',
  release: 'Release.',
  releaseSub: 'The file stays here.',
  'mode.lossless': 'Lossless',
  'mode.balanced': 'Balanced',
  'mode.compression': 'Compact',
  'hint.lossless': 'Bit-identical content. No quality loss.',
  'hint.balanced': 'Much lighter, no visible difference.',
  'hint.compression': 'As small as possible, visible quality loss.',
  save: 'Save',
  cancel: 'Cancel',
  remove: 'Remove',
  clear: 'Clear all',
  waiting: 'Waiting',
  working: 'Working',
  checking: 'Verifying',
  failed: 'Failed',
  cancelled: 'Cancelled',
  lossless: 'lossless',
  verified: 'verified',
  local: 'Local',
  'panel.privacy': 'Privacy',
  'panel.settings': 'Settings',
  close: 'Close',
  statement: 'Your files are processed on this workstation. They are never sent to a server.',
  'n.uploads': 'uploads',
  'n.external': 'external hosts',
  'n.blocked': 'blocked attempts',
  offlineReady: 'Works offline',
  offlineNot: 'Offline mode unavailable',
  misconfig: 'Incomplete server configuration: security headers are missing. Tell your administrator.',
  technical: 'Technical details',
  network: 'Observed requests',
  enforcement: 'Active protections',
  engines: 'Engines',
  workstation: 'This workstation',
  scratch: 'Local temporary storage',
  purge: 'Empty',
  verify: 'Verify it yourself',
  verifyText: 'Disconnect the network after the first load: the app keeps working. A network capture during processing shows no upload.',
  observedOnly: 'This panel shows what the application observes about itself; independent verification (network capture) remains the reference.',
  'set.video': 'Video codec',
  'set.image': 'Image format',
  'set.keep': 'Keep format',
  'set.meta': 'Remove metadata',
  'set.metaHint': 'GPS, author, device. Sensitivity labels are kept.',
  'set.sha': 'SHA-256 checksums',
  'set.shaHint': 'Traceability of original and result.',
  'set.macros': 'Allow macro-enabled files',
  'set.macrosHint': '.pptm .xlsm .docm — VBA stays intact. Subject to security approval.',
  'set.note': 'Settings are kept in this browser only.',
  engine: 'Engine',
  checks: 'Checks',
  original: 'Original',
  result: 'Result',
  before: 'Before',
  after: 'After',
};

const REASONS: Record<Lang, Record<Reason, string>> = {
  fr: {
    'already-optimal': 'Déjà optimisé — rien à gagner.',
    'archive-compressed': 'Archive déjà compressée — rien à gagner.',
    'video-lossless': 'Une vidéo ne peut pas être réduite sans perte. Choisissez Équilibré.',
    'video-efficient': 'Vidéo déjà bien compressée.',
    animated: 'Image animée — laissée telle quelle.',
    'too-large': 'Fichier trop volumineux pour ce traitement.',
    unreadable: 'Fichier illisible.',
    encrypted: 'Document protégé par mot de passe — non modifié.',
    signed: 'Document signé — le modifier invaliderait la signature.',
    macro: 'Fichier à macros — désactivé (voir Réglages).',
    'unsafe-paths': 'Contenu suspect — refusé.',
    'no-encoder': 'Aucun encodeur vidéo disponible sur ce poste.',
    'no-decoder': 'Codec vidéo non pris en charge sur ce poste.',
    unsupported: 'Format non pris en charge.',
    validation: 'Le résultat n’a pas passé la vérification — l’original est intact.',
    quota: 'Espace disque insuffisant pour préparer le résultat.',
    corrupt: 'Fichier endommagé.',
  },
  en: {
    'already-optimal': 'Already optimised — nothing to gain.',
    'archive-compressed': 'Archive already compressed — nothing to gain.',
    'video-lossless': 'Video cannot be reduced losslessly. Choose Balanced.',
    'video-efficient': 'Video is already well compressed.',
    animated: 'Animated image — left as is.',
    'too-large': 'File too large for this processing.',
    unreadable: 'Unreadable file.',
    encrypted: 'Password-protected document — not modified.',
    signed: 'Signed document — changing it would break the signature.',
    macro: 'Macro-enabled file — disabled (see Settings).',
    'unsafe-paths': 'Suspicious content — refused.',
    'no-encoder': 'No video encoder available on this workstation.',
    'no-decoder': 'Video codec not supported on this workstation.',
    unsupported: 'Unsupported format.',
    validation: 'The result failed verification — the original is untouched.',
    quota: 'Not enough disk space to stage the result.',
    corrupt: 'Damaged file.',
  },
};

const CHECKS_FR: Record<string, string> = {
  'Output decodes': 'Le résultat s’ouvre',
  'Dimensions verified': 'Dimensions identiques',
  'Format verified': 'Format vérifié',
  'Coefficients identical': 'Données JPEG identiques',
  'Pixels identical': 'Pixels identiques',
  'Archive reopens': 'L’archive s’ouvre',
  'Structure preserved': 'Structure conservée',
  'CRC-32 verified': 'Contrôle CRC-32',
  'Container verified': 'Conteneur vérifié',
  'Video stream present': 'Piste vidéo présente',
  'Resolution verified': 'Résolution vérifiée',
  'Duration verified': 'Durée identique',
  'Audio stream': 'Piste audio',
  'Frames decode (start / middle / end)': 'Images lisibles (début, milieu, fin)',
  'PDF header / trailer': 'Structure PDF',
  'Reopens and parses': 'Le PDF s’ouvre',
  'Page count preserved': 'Nombre de pages identique',
  'Page resources resolve': 'Ressources des pages',
  'Package reopens': 'Le document s’ouvre',
  'Part names & order preserved': 'Contenu et ordre conservés',
  '[Content_Types].xml': 'Types de contenu',
  'Relationships resolve': 'Liens internes valides',
  'VBA project untouched': 'Macros intactes',
};

let lang: Lang = (() => {
  try {
    const v = localStorage.getItem('localcompress.lang');
    return v === 'en' ? 'en' : 'fr';
  } catch {
    return 'fr';
  }
})();

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem('localcompress.lang', l);
  } catch {
    /* ignore */
  }
}
document.documentElement.lang = lang;

export const t = (k: Key): string => (lang === 'fr' ? fr[k] : en[k]);
export const reasonText = (r: Reason | undefined): string => REASONS[lang][r ?? 'unsupported'];
export const checkLabel = (label: string): string => (lang === 'fr' ? (CHECKS_FR[label] ?? label) : label);

const UNITS: Record<Lang, string[]> = { fr: ['o', 'Ko', 'Mo', 'Go', 'To'], en: ['B', 'KB', 'MB', 'GB', 'TB'] };
export function bytes(n: number): string {
  let i = 0;
  let v = n;
  while (v >= 1000 && i < 4) (v /= 1000), i++;
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v)} ${UNITS[lang][i]}`;
}
export function percent(fraction: number): string {
  const v = new Intl.NumberFormat(lang, { maximumFractionDigits: fraction >= 0.1 ? 0 : 1 }).format(fraction * 100);
  return lang === 'fr' ? `−${v} %` : `−${v}%`;
}
