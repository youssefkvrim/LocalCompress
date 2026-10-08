/** French first, English on request. Each entry: [français, English]. */
import type { Reason } from '../lib/types';

export type Lang = 'fr' | 'en';

const TEXT = {
  tagline: ['Le fichier reste ici.', 'The file stays here.'],
  sub: ['Compression sur ce poste. Rien n’est envoyé.', 'Compressed on this workstation. Nothing is sent.'],
  drop: ['Déposez vos fichiers', 'Drop your files'],
  browse: ['Parcourir', 'Browse'],
  release: ['Relâchez.', 'Release.'],
  lossless: ['Sans perte', 'Lossless'],
  balanced: ['Équilibré', 'Balanced'],
  compact: ['Compact', 'Compact'],
  'hint.lossless': ['Contenu identique au bit près. Aucune perte de qualité.', 'Bit-identical content. No quality loss.'],
  'hint.balanced': ['Bien plus léger, différence invisible à l’œil.', 'Much lighter, no visible difference.'],
  'hint.compact': ['Le plus léger possible, perte de qualité visible.', 'As small as possible, visible quality loss.'],
  save: ['Enregistrer', 'Save'],
  remove: ['Retirer', 'Remove'],
  clear: ['Tout effacer', 'Clear all'],
  waiting: ['En attente', 'Waiting'],
  verified: ['vérifié', 'verified'],
  identical: ['sans perte', 'lossless'],
  local: ['Local', 'Local'],
  privacy: ['Confidentialité', 'Privacy'],
  settings: ['Réglages', 'Settings'],
  close: ['Fermer', 'Close'],
  statement: ['Vos fichiers sont traités sur ce poste. Ils ne sont jamais envoyés à un serveur.', 'Your files are processed on this workstation. They are never sent to a server.'],
  uploads: ['envois', 'uploads'],
  external: ['serveurs externes', 'external hosts'],
  blocked: ['tentatives bloquées', 'blocked attempts'],
  offline: ['Fonctionne hors ligne', 'Works offline'],
  online: ['Mode hors ligne pas encore prêt', 'Offline mode not ready yet'],
  misconfig: ['Configuration serveur incomplète : en-têtes de sécurité absents. Prévenez l’administrateur.', 'Incomplete server configuration: security headers missing. Tell your administrator.'],
  technical: ['Détails techniques', 'Technical details'],
  requests: ['Requêtes observées', 'Observed requests'],
  storage: ['Stockage temporaire', 'Temporary storage'],
  purge: ['Vider', 'Empty'],
  verify: [
    'Ce panneau montre ce que l’application observe d’elle-même. Pour le vérifier : coupez le réseau après le premier chargement, l’application fonctionne toujours ; une capture réseau pendant un traitement ne montre aucun envoi.',
    'This panel shows what the application observes about itself. To verify: disconnect the network after the first load, the app keeps working; a network capture during processing shows no upload.',
  ],
  'set.meta': ['Retirer les métadonnées', 'Remove metadata'],
  'set.metaHint': ['GPS, auteur, appareil. Les étiquettes de sensibilité sont conservées.', 'GPS, author, device. Sensitivity labels are kept.'],
  'set.macros': ['Autoriser les fichiers à macros', 'Allow macro-enabled files'],
  'set.macrosHint': ['.pptm .xlsm .docm — le code VBA reste intact. Soumis à validation sécurité.', '.pptm .xlsm .docm — VBA stays intact. Subject to security approval.'],
  engine: ['Moteur', 'Engine'],
  checks: ['Vérifications', 'Checks'],
  original: ['Original', 'Original'],
  result: ['Résultat', 'Result'],
} satisfies Record<string, [string, string]>;

const REASONS: Record<Reason, [string, string]> = {
  'already-optimal': ['Déjà optimisé — rien à gagner.', 'Already optimised — nothing to gain.'],
  'video-lossless': ['Une vidéo ne peut pas être réduite sans perte. Choisissez Équilibré.', 'Video cannot be reduced losslessly. Choose Balanced.'],
  animated: ['Image animée — laissée telle quelle.', 'Animated image — left as is.'],
  'too-large': ['Fichier trop volumineux pour ce traitement.', 'File too large for this processing.'],
  unreadable: ['Fichier illisible.', 'Unreadable file.'],
  encrypted: ['Document protégé par mot de passe — non modifié.', 'Password-protected document — not modified.'],
  signed: ['Document signé — le modifier invaliderait la signature.', 'Signed document — changing it would break the signature.'],
  macro: ['Fichier à macros — désactivé (voir Réglages).', 'Macro-enabled file — disabled (see Settings).'],
  'unsafe-paths': ['Contenu suspect — refusé.', 'Suspicious content — refused.'],
  'no-codec': ['Codec vidéo indisponible sur ce poste.', 'Video codec unavailable on this workstation.'],
  unsupported: ['Format non pris en charge.', 'Unsupported format.'],
  validation: ['Le résultat n’a pas passé la vérification — l’original est intact.', 'The result failed verification — the original is untouched.'],
  quota: ['Espace disque insuffisant.', 'Not enough disk space.'],
  corrupt: ['Fichier endommagé ou illisible.', 'Damaged or unreadable file.'],
};

const CHECKS: Record<string, string> = {
  'Output decodes': 'Le résultat s’ouvre',
  'Coefficients identical': 'Données JPEG identiques',
  'Pixels identical': 'Pixels identiques',
  'Archive reopens': 'L’archive s’ouvre',
  'Structure preserved': 'Structure conservée',
  'CRC-32 verified': 'Contrôle CRC-32',
  'Video stream present': 'Piste vidéo présente',
  'Resolution verified': 'Résolution vérifiée',
  'Duration verified': 'Durée identique',
  'Audio stream': 'Piste audio',
  'Frames decode (start / middle / end)': 'Images lisibles (début, milieu, fin)',
  'Reopens and parses': 'Le PDF s’ouvre',
  'Page count preserved': 'Nombre de pages identique',
  'Package reopens': 'Le document s’ouvre',
  'Relationships resolve': 'Liens internes valides',
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
export const checkText = (label: string) => (lang === 'fr' ? (CHECKS[label] ?? label) : label);

export function bytes(n: number): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < 4) (n /= 1000), i++;
  const digits = i === 0 || n >= 100 ? 0 : 1;
  return `${n.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${units[i]}`;
}

export function percent(fraction: number): string {
  const v = (fraction * 100).toLocaleString(lang, { maximumFractionDigits: fraction >= 0.1 ? 0 : 1 });
  return lang === 'fr' ? `−${v} %` : `−${v}%`;
}
