/** French first, English on request. Each entry: [français, English]. */
import type { Reason } from '../lib/types';
import type { Category } from '../lib/detect';

export type Lang = 'fr' | 'en';

const TEXT = {
  title: ['Compressez vos fichiers.', 'Compress your files.'],
  sub: ['Images, PDF, documents, vidéos et archives.', 'Images, PDFs, documents, videos and archives.'],
  drop: ['Déposez vos fichiers ici', 'Drop your files here'],
  browse: ['ou cliquez pour les choisir', 'or click to choose them'],
  release: ['Relâchez pour compresser', 'Release to compress'],
  'task.compress': ['Compresser', 'Compress'],
  'task.convert': ['Convertir', 'Convert'],
  'task.removebg': ['Supprimer l’arrière-plan', 'Remove background'],
  'task.pdf': ['Atelier PDF', 'PDF tools'],
  'title.pdf': ['Travaillez vos PDF.', 'Work on your PDFs.'],
  'sub.pdf': [
    'Fusionner, diviser, organiser les pages, pivoter ou ajouter un filigrane, sans envoyer vos documents.',
    'Merge, split, organise pages, rotate or add a watermark, without uploading your documents.',
  ],
  'release.pdf': ['Relâchez pour ouvrir dans l’atelier PDF', 'Release to open in the PDF tools'],
  'hint.pdf': ['Déposez un ou plusieurs PDF, puis choisissez un outil.', 'Drop one or more PDFs, then choose a tool.'],
  'pdf.add': ['Ajouter des PDF', 'Add PDFs'],
  'pdf.clear': ['Tout retirer', 'Remove all'],
  'pdf.tool.merge': ['Fusionner', 'Merge'],
  'pdf.tool.split': ['Diviser', 'Split'],
  'pdf.tool.organize': ['Organiser', 'Organise'],
  'pdf.tool.rotate': ['Pivoter', 'Rotate'],
  'pdf.tool.watermark': ['Filigrane', 'Watermark'],
  'pdf.reading': ['Lecture…', 'Reading…'],
  'pdf.selectHint': ['Cliquez sur un fichier de la liste pour le choisir.', 'Click a file in the list to choose it.'],
  'pdf.mergeHint': ['Les PDF sont assemblés dans l’ordre de la liste ; les flèches changent cet ordre.', 'PDFs are joined in the order of the list; the arrows change that order.'],
  'pdf.mergeNeed': ['Ajoutez au moins deux PDF à fusionner.', 'Add at least two PDFs to merge.'],
  'pdf.splitEach': ['Une page par fichier', 'One page per file'],
  'pdf.splitRanges': ['Par plages', 'By ranges'],
  'pdf.rangesPlaceholder': ['ex. 1-3, 5, 8-', 'e.g. 1-3, 5, 8-'],
  'pdf.splitHint': ['Chaque plage devient un PDF ; s’il y en a plusieurs, ils sont regroupés dans un ZIP.', 'Each range becomes a PDF; several are bundled in a ZIP.'],
  'pdf.badRanges': ['Plages invalides. Exemple : 1-3, 5, 8- (8- = jusqu’à la fin).', 'Invalid ranges. Example: 1-3, 5, 8- (8- = to the end).'],
  'pdf.organizeHint': ['Glissez les pages pour changer l’ordre, pivotez-les ou retirez-les.', 'Drag pages to reorder them, rotate or remove them.'],
  'pdf.nothingLeft': ['Gardez au moins une page.', 'Keep at least one page.'],
  'pdf.rotateLeft': ['Pivoter à gauche', 'Rotate left'],
  'pdf.rotateRight': ['Pivoter à droite', 'Rotate right'],
  'pdf.moveUp': ['Avancer', 'Move earlier'],
  'pdf.moveDown': ['Reculer', 'Move later'],
  'pdf.delete': ['Retirer la page', 'Remove the page'],
  'pdf.restore': ['Garder la page', 'Keep the page'],
  'pdf.rotateHint': ['Toutes les pages sont pivotées. Pour certaines pages seulement, utilisez Organiser.', 'Every page is rotated. For some pages only, use Organise.'],
  'pdf.wmText': ['Texte', 'Text'],
  'pdf.wmOpacity': ['Opacité', 'Opacity'],
  'pdf.wmSize': ['Taille', 'Size'],
  'pdf.wmSmall': ['Petit', 'Small'],
  'pdf.wmMedium': ['Moyen', 'Medium'],
  'pdf.wmLarge': ['Grand', 'Large'],
  'pdf.wmHint': ['Le texte est placé en diagonale, au centre de chaque page.', 'The text is placed diagonally in the middle of every page.'],
  'pdf.wmEmpty': ['Saisissez le texte du filigrane.', 'Type the watermark text.'],
  'pdf.apply': ['Appliquer et enregistrer', 'Apply and save'],
  'pdf.working': ['Traitement…', 'Working…'],
  'pdf.done': ['Enregistré. Le résultat a été rouvert et vérifié.', 'Saved. The result was reopened and checked.'],
  'pdf.onlyPdf': ['Seuls les fichiers PDF sont acceptés dans l’atelier PDF.', 'Only PDF files are accepted in the PDF tools.'],
  'pdf.encrypted': ['PDF protégé par mot de passe : le déverrouillage arrive dans une prochaine version.', 'Password-protected PDF: unlocking comes in a next version.'],
  'pdf.corrupt': ['PDF illisible ou endommagé.', 'Unreadable or damaged PDF.'],
  'pdf.invalid': ['Le résultat n’a pas passé la vérification. L’original est intact.', 'The result failed verification. The original is untouched.'],
  'title.convert': ['Convertissez vos fichiers.', 'Convert your files.'],
  'sub.convert': ['Images en JPEG, PNG, WebP ou PDF, et PDF en images. Vidéos et sons en MP4, WebM, M4A ou WAV.', 'Pictures to JPEG, PNG, WebP or PDF, and PDFs to pictures. Videos and sounds to MP4, WebM, M4A or WAV.'],
  'release.convert': ['Relâchez pour convertir', 'Release to convert'],
  'title.removebg': ['Supprimez le fond d’une image.', 'Remove the background of a picture.'],
  'sub.removebg': [
    'Le sujet reste, l’arrière-plan disparaît : PNG transparent, à la même taille. Vous pouvez retoucher le résultat au pinceau avant de l’enregistrer.',
    'The subject stays, the background goes: a transparent PNG, same size. You can touch up the result with a brush before saving it.',
  ],
  'release.removebg': ['Relâchez pour supprimer le fond', 'Release to remove the background'],
  'to.images': ['Images et PDF en', 'Pictures and PDFs to'],
  'to.media': ['Vidéos et sons en', 'Videos and sounds to'],
  'hint.removebg': ['Pour les photos de personnes, d’objets ou de produits.', 'For photos of people, objects or products.'],
  'step.convert': ['Conversion', 'Converting'],
  'step.removebg': ['Suppression du fond', 'Removing background'],
  converted: ['Converti et vérifié', 'Converted and verified'],
  cutout: ['Arrière-plan supprimé', 'Background removed'],
  touchedUp: ['Arrière-plan supprimé, retouché', 'Background removed, touched up'],
  'edit.open': ['Retoucher', 'Touch up'],
  'edit.title': ['Retoucher', 'Touch up'],
  'edit.erase': ['Effacer', 'Erase'],
  'edit.restore': ['Restaurer', 'Restore'],
  'edit.move': ['Déplacer', 'Move'],
  'edit.size': ['Taille', 'Size'],
  'edit.hardness': ['Douceur', 'Softness'],
  'edit.undo': ['Annuler', 'Undo'],
  'edit.redo': ['Rétablir', 'Redo'],
  'edit.reset': ['Revenir au résultat automatique', 'Back to the automatic result'],
  'edit.compare': ['Maintenir pour voir l’original', 'Hold to see the original'],
  'edit.bg': ['Fond d’aperçu', 'Preview background'],
  'edit.fit': ['Ajuster à l’écran', 'Fit to screen'],
  'edit.apply': ['Valider', 'Apply'],
  'edit.cancel': ['Fermer sans changer', 'Close without changes'],
  'edit.loading': ['Ouverture de l’image…', 'Opening the picture…'],
  'edit.zoomIn': ['Zoom avant', 'Zoom in'],
  'edit.zoomOut': ['Zoom arrière', 'Zoom out'],
  'edit.full': ['Plein écran', 'Full screen'],
  'edit.exitFull': ['Quitter le plein écran (Échap)', 'Exit full screen (Esc)'],
  'edit.original': ['Original', 'Original'],
  'edit.help': [
    'Effacer (E) retire une zone, Restaurer (R) la remet. Ctrl + molette : zoom ; barre d’espace ou Déplacer : glisser l’image ; [ et ] : taille du pinceau ; Ctrl+Z : annuler. Les retouches sont appliquées à l’enregistrement.',
    'Erase (E) removes an area, Restore (R) brings it back. Ctrl + wheel: zoom; space bar or Move: drag the picture; [ and ]: brush size; Ctrl+Z: undo. Touch-ups are applied when you save.',
  ],
  'edit.helpFull': [
    'Effacer (E) retire une zone, Restaurer (R) la remet. Molette : zoom ; barre d’espace ou Déplacer : glisser l’image ; [ et ] : taille du pinceau ; Ctrl+Z : annuler ; Échap : quitter le plein écran.',
    'Erase (E) removes an area, Restore (R) brings it back. Wheel: zoom; space bar or Move: drag the picture; [ and ]: brush size; Ctrl+Z: undo; Esc: exit full screen.',
  ],
  local: [
    'Traitement 100 % local · Tout se passe dans le navigateur · Aucun fichier n’est envoyé à un serveur.',
    '100% local processing · Everything happens in your browser · No file is sent to a server.',
  ],
  'kinds.image': ['Images', 'Images'],
  'kinds.pdf': ['PDF', 'PDF'],
  'kinds.document': ['Documents', 'Documents'],
  'kinds.video': ['Vidéos', 'Videos'],
  'kinds.audio': ['Sons', 'Sounds'],
  'kinds.archive': ['Archives', 'Archives'],
  'convert.to': ['Convertir en', 'Convert to'],
  'convert.all': ['Tous les fichiers {kind} en', 'All {kind} files to'],
  'convert.pick': ['Choisissez un format : la conversion démarre aussitôt.', 'Choose a format: the conversion starts right away.'],
  'convert.hint': ['Déposez vos fichiers puis choisissez le format : la conversion démarre aussitôt.', 'Drop your files, then choose the format: the conversion starts right away.'],
  'group.image': ['images', 'picture'],
  'group.pdf': ['PDF', 'PDF'],
  'group.video': ['vidéos', 'video'],
  'group.audio': ['sons', 'sound'],
  'bench.add': ['Autre image', 'Another picture'],
  'bench.working': ['Suppression de l’arrière-plan…', 'Removing the background…'],
  'bench.waiting': ['En attente…', 'Waiting…'],
  'model.ready': ['Le modèle d’analyse est prêt.', 'The analysis model is ready.'],
  'model.loading': ['Le modèle d’analyse se télécharge en arrière-plan{p}.', 'The analysis model is downloading in the background{p}.'],
  'model.firstUse': ['Le modèle d’analyse (environ {mb} Mo) est chargé à la première utilisation.', 'The analysis model (about {mb} MB) loads on first use.'],
  'model.unavailable': ['Le modèle de suppression d’arrière-plan n’est pas disponible sur ce serveur.', 'The background-removal model is not available on this server.'],
  'contact.button': ['Écrire au support', 'Contact support'],
  'doc.blocked': ['Requêtes bloquées', 'Blocked requests'],
  'doc.blockedText': [
    'La protection a bloqué ces requêtes : aucune donnée n’est sortie. Si cela se répète, signalez-le avec le bouton ci-dessous.',
    'The protection blocked these requests: no data left. If it happens again, report it with the button below.',
  ],
  'unlock.label': ['Mot de passe du PDF', 'PDF password'],
  'unlock.open': ['Ouvrir', 'Open'],
  'doc.convert': ['Conversions', 'Conversions'],
  'doc.convertText': [
    'Images (JPEG, PNG, WebP, AVIF, GIF, BMP, SVG) vers JPEG, PNG, WebP ou PDF ; un JPEG est placé dans le PDF tel quel, sans perte. PDF vers JPEG, PNG ou WebP : une image par page à 150 dpi, regroupées dans un ZIP s’il y a plusieurs pages. Vidéos (MP4, MOV, MKV, WebM) et sons (MP3, WAV, M4A, Ogg, FLAC) vers MP4, WebM, M4A ou WAV ; les pistes déjà au bon format sont recopiées sans réencodage.',
    'Pictures (JPEG, PNG, WebP, AVIF, GIF, BMP, SVG) to JPEG, PNG, WebP or PDF; a JPEG goes into the PDF as it is, losslessly. PDF to JPEG, PNG or WebP: one picture per page at 150 dpi, in a ZIP when there are several pages. Videos (MP4, MOV, MKV, WebM) and sounds (MP3, WAV, M4A, Ogg, FLAC) to MP4, WebM, M4A or WAV; tracks already in the right format are copied without re-encoding.',
  ],
  'doc.removebg': ['Suppression de l’arrière-plan', 'Background removal'],
  'doc.removebgText': [
    'Un modèle d’analyse d’image (IS-Net, open source) sépare le sujet du fond, ici, dans le navigateur, avec la carte graphique quand elle est disponible (sinon en mode CPU). Les contours sont ensuite affinés sur l’image en pleine résolution, et vous pouvez retoucher le résultat au pinceau. Le modèle fait partie de l’application : il se télécharge en arrière-plan, est vérifié comme tous ses fichiers, et aucune image n’est envoyée.',
    'An image analysis model (IS-Net, open source) separates the subject from the background, here, in the browser, on the graphics card when available (otherwise on CPU). Edges are then refined on the full-resolution picture, and you can touch up the result with a brush. The model is part of the application: it downloads in the background, is verified like all its files, and no picture is sent anywhere.',
  ],
  'doc.pdfLab': ['Atelier PDF', 'PDF tools'],
  'doc.pdfLabText': [
    'Fusionner plusieurs PDF, diviser (une page par fichier ou par plages), organiser les pages (ordre, rotation, suppression), pivoter tout le document et ajouter un filigrane. Chaque résultat est rouvert et son nombre de pages vérifié avant d’être proposé.',
    'Merge several PDFs, split (one page per file or by ranges), organise pages (order, rotation, removal), rotate the whole document and add a watermark. Every result is reopened and its page count checked before it is offered.',
  ],
  'doc.pdfLabNow': [
    'Prochaines étapes : verrouiller / déverrouiller, signer, OCR.',
    'Next steps: lock / unlock, sign, OCR.',
  ],
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
  info: ['Information', 'Information'],
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
    'LocalKit est conçu pour une confidentialité maximale : il évite de recourir à des outils tiers hébergés sur des serveurs externes, ou à des logiciels opaques.',
    'LocalKit is designed for maximum privacy: it avoids relying on third-party tools hosted on external servers, or on opaque software.',
  ],
  offline: ['Prêt à fonctionner hors ligne', 'Ready to work offline'],
  'guard.pending': ['Préparation de la protection…', 'Setting up protection…'],
  'guard.pendingSub': ['Vos fichiers ne quitteront pas cet ordinateur.', 'Your files will not leave this computer.'],
  'guard.slow': ['Premier lancement : l’application s’installe pour fonctionner hors ligne, encore quelques secondes.', 'First launch: the application is installing itself to work offline, a few more seconds.'],
  'guard.failed': [
    'La protection n’a pas pu démarrer : le traitement est désactivé par sécurité. Rechargez la page ; si le problème persiste, prévenez l’administrateur.',
    'Protection could not start: processing is disabled for safety. Reload the page; if the problem persists, tell your administrator.',
  ],
  'update.available': ['Une nouvelle version de LocalKit est disponible.', 'A new version of LocalKit is available.'],
  'update.busy': ['Une nouvelle version est disponible : elle pourra être installée une fois vos fichiers terminés.', 'A new version is available: it can be installed once your files are done.'],
  'update.apply': ['Mettre à jour', 'Update'],
  'update.stale': ['LocalKit a été mis à jour dans un autre onglet. Enregistrez vos résultats, puis rechargez cette page pour continuer.', 'LocalKit was updated in another tab. Save your results, then reload this page to continue.'],
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
  'doc.toolsText': ['LocalKit s’appuie sur ces projets open source et maintenus à jour :', 'LocalKit relies on these open-source, actively maintained projects:'],
  storage: ['Stockage temporaire sur cet ordinateur', 'Temporary storage on this computer'],
  purge: ['Vider le stockage temporaire', 'Empty temporary storage'],
  'doc.contact': ['Contact', 'Contact'],
  'doc.contactText': ['Un bug ou une idée d’amélioration ? Écrivez au support :', 'A bug or an idea for an improvement? Write to support:'],
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
  macro: ['Fichier à macros, désactivé dans Information.', 'File with macros, disabled in Information.'],
  'unsafe-paths': ['Noms de fichiers dangereux ou ambigus à l’intérieur : laissé tel quel.', 'Dangerous or ambiguous file names inside: left as is.'],
  'no-codec': ['Format non pris en charge sur cet ordinateur.', 'Format not supported on this computer.'],
  unsupported: ['Format non pris en charge.', 'Unsupported format.'],
  validation: ['Le résultat n’a pas passé la vérification. L’original est intact.', 'The result failed verification. The original is untouched.'],
  quota: ['Espace disque insuffisant.', 'Not enough disk space.'],
  corrupt: ['Fichier endommagé ou illisible.', 'Damaged or unreadable file.'],
  'same-format': ['Déjà dans ce format.', 'Already in this format.'],
  'no-subject': ['Aucun sujet distinct du fond n’a été trouvé.', 'No subject distinct from the background was found.'],
  password: [
    'Protégé par mot de passe. Saisissez-le pour convertir ce PDF ; il reste sur cet ordinateur et n’est pas conservé. Sinon, le fichier est laissé tel quel.',
    'Password protected. Type it to convert this PDF; it stays on this computer and is not kept. Otherwise the file is left as is.',
  ],
  'password-wrong': ['Mot de passe incorrect. Réessayez, ou laissez le fichier tel quel.', 'Wrong password. Try again, or leave the file as is.'],
};

let lang: Lang = (() => {
  try {
    // The application was called LocalCompress: its language choice is carried over once.
    const saved = localStorage.getItem('localkit.lang') ?? localStorage.getItem('localcompress.lang');
    localStorage.removeItem('localcompress.lang');
    return saved === 'en' ? 'en' : 'fr';
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
    localStorage.setItem('localkit.lang', l);
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
