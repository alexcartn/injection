// Douleur aiguë : grilles publiées, calcul des scores et historique par patient.
// Module sans accès à la page : app.js s'occupe de l'affichage.
//
// Étapes selon l'espèce :
//   chien  sédation, puis douleur (4AVet)
//   chat   faciès (Feline Grimace Scale), puis douleur (4AVet)
//   lapin  faciès (Rabbit Grimace Scale)
//
// Chaque grille (scale) :
//   id, title, short  nom complet et nom court
//   items             { id, label, hint?, levels: [{ value, label? }], abbr? } ; abbr = item gardé dans la version abrégée
//   compact           niveaux affichés côte à côte (libellés courts ou absents)
//   source            d'où viennent les items et les libellés
//   advice, link      conseil d'usage affiché sous le titre de l'étape, et lien vers la fiche de référence (optionnel)
// Un niveau sans label n'affiche que son chiffre. Les libellés des niveaux de 4AVet ne sont pas repris ici :
// la grille d'origine n'a pas pu être consultée. Les compléter dans A4V ci-dessous.

const lv = (value, label) => (label ? { value, label } : { value });

const FGS_LEVELS = [lv(0, 'Absent'), lv(1, 'Modéré ou doute'), lv(2, 'Évident')];

export const FGS = {
  id: 'fgs',
  title: 'Faciès félin (Feline Grimace Scale)',
  short: 'Faciès',
  compact: true,
  naAllowed: true,
  minScored: 3, // choix de l'appli : en dessous, pas de verdict
  cutoff: 0.39, // rapport somme / maximum au-delà duquel l'analgésie de secours est conseillée
  source: 'Evangelista et coll., Sci Rep 2019 ; seuil d’analgésie de secours : 0,39 sur 1.',
  items: [
    { id: 'ears', label: 'Position des oreilles', hint: 'Pointes écartées et tournées vers l’extérieur.' },
    { id: 'orbit', label: 'Plissement orbitaire', hint: 'Yeux plissés (hauteur de paupière sous 50 % de la largeur de l’œil) ou paupières serrées.' },
    { id: 'muzzle', label: 'Tension du museau', hint: 'Museau aplati et étiré, de rond à elliptique.' },
    { id: 'whiskers', label: 'Position des moustaches', hint: 'Projetées vers l’avant, écartées du visage, dressées.' },
    { id: 'head', label: 'Position de la tête', hint: 'Sous la ligne des épaules, ou inclinée vers le bas.' },
  ].map((item) => ({ ...item, levels: FGS_LEVELS })),
};

const RGS_LEVELS = [lv(0, 'Absent'), lv(1, 'Modéré'), lv(2, 'Évident')];

// Les définitions illustrées de chaque item ne sont que sur l'affiche du NC3Rs : seuls les noms des items sont repris ici.
export const RGS = {
  id: 'rgs',
  title: 'Faciès du lapin (Rabbit Grimace Scale)',
  short: 'Grimace',
  compact: true,
  naAllowed: true,
  minScored: 3, // choix de l'appli : en dessous, pas de verdict
  source: 'Keating et coll., PLoS One 2012 (5 items de 0 à 2, pas de seuil d’analgésie publié) ; affiche et conseils d’usage du NC3Rs.',
  advice: 'À scorer sur un animal éveillé, après une courte observation, pour ne pas noter une expression passagère. Pas de seuil d’analgésie publié : le score se lit avec l’examen clinique.',
  link: { url: 'https://nc3rs.org.uk/rabbit-grimace-scale', text: 'Affiche NC3Rs avec les images de chaque item' },
  items: [
    { id: 'orbit', label: 'Plissement orbitaire' },
    { id: 'cheek', label: 'Aplatissement des joues' },
    { id: 'nose', label: 'Forme du nez' },
    { id: 'whiskers', label: 'Position des moustaches' },
    { id: 'ears', label: 'Forme et position des oreilles' },
  ].map((item) => ({ ...item, levels: RGS_LEVELS })),
};

export const SEDATION = {
  id: 'sed',
  title: 'Sédation (chien)',
  short: 'Sédation',
  source: 'Grille de Grint et coll., adaptée de Young 1990 et Kuusela 2000, reprise par Wagner et coll., BMC Vet Res 2017. Version abrégée (4 items, 0 à 12) validée dans la même étude.',
  items: [
    { id: 'posture', abbr: true, label: 'Posture spontanée', levels: [
      lv(0, 'Debout'), lv(1, 'Fatigué mais debout'), lv(2, 'Couché, capable de se relever'),
      lv(3, 'Couché, se relève difficilement'), lv(4, 'Incapable de se relever'),
    ] },
    { id: 'palpebral', label: 'Réflexe palpébral', levels: [
      lv(0, 'Vif'), lv(1, 'Lent, balayage cornéen complet'), lv(2, 'Lent, balayage cornéen partiel'), lv(3, 'Absent'),
    ] },
    { id: 'eyes', abbr: true, label: 'Position des yeux', levels: [
      lv(0, 'Centrés'),
      lv(1, 'Tournés vers l’avant ou le bas, non masqués par la troisième paupière'),
      lv(2, 'Tournés vers l’avant ou le bas, masqués par la troisième paupière'),
    ] },
    { id: 'jaw', label: 'Relâchement de la mâchoire et de la langue', levels: [
      lv(0, 'Tonus normal, réflexe nauséeux fort'), lv(1, 'Tonus réduit, réflexe nauséeux encore modéré'),
      lv(2, 'Tonus très réduit, réflexe nauséeux faible'), lv(3, 'Tonus perdu, pas de réflexe nauséeux'),
    ] },
    { id: 'noise', abbr: true, label: 'Réaction à un bruit', hint: 'Claquement de mains, ou clicker à environ 1,5 m de la tête.', levels: [
      lv(0, 'Sursaut normal (tête tournée vers le bruit, crispation)'), lv(1, 'Sursaut réduit (tête peu tournée, crispation minime)'),
      lv(2, 'Sursaut minimal'), lv(3, 'Aucune réaction'),
    ] },
    { id: 'lateral', label: 'Résistance quand on le couche sur le côté', levels: [
      lv(0, 'Se débat beaucoup, refuse parfois la position'), lv(1, 'Se débat un peu mais accepte la position'),
      lv(2, 'Se débat à peine, se laisse faire'), lv(3, 'Ne se débat pas'),
    ] },
    { id: 'attitude', abbr: true, label: 'Aspect général et attitude', levels: [
      lv(0, 'Excité'), lv(1, 'Éveillé, normal'), lv(2, 'Tranquille'), lv(3, 'Stuporeux'),
    ] },
  ],
};

const A4V_LEVELS = [lv(0, 'Aucune douleur'), lv(1), lv(2), lv(3, 'Douleur maximale')];

export const A4V = {
  id: 'a4v',
  title: 'Douleur aiguë (4AVet)',
  short: 'Douleur',
  compact: true,
  advice: 'Chaque item va de 0 (aucune douleur) à 3 (douleur maximale). Le détail de chaque niveau n’est pas repris ici.',
  source: 'Items : Rialland et coll., PLoS One 2012 (6 items de 0 à 3). Classes d’intensité : Le Point Vétérinaire n° 330, 2012. Aucun seuil d’analgésie validé pour cette grille (WSAVA).',
  bands: [
    { to: 0, text: 'Pas de douleur', tone: 'ok' },
    { to: 5, text: 'Douleur légère', tone: 'info' },
    { to: 10, text: 'Douleur modérée', tone: 'alert' },
    { to: 18, text: 'Douleur sévère', tone: 'alert' },
  ],
  items: [
    { id: 'global', label: 'Appréciation subjective globale' },
    { id: 'attitude', label: 'Attitude générale' },
    { id: 'interactive', label: 'Comportement interactif' },
    { id: 'gait', label: 'Évaluation de la locomotion' },
    { id: 'wound', label: 'Réaction à la manipulation de la plaie chirurgicale' },
    { id: 'intensity', label: 'Intensité de cette réaction' },
  ].map((item) => ({ ...item, levels: A4V_LEVELS })),
};

export const SCALES = { fgs: FGS, rgs: RGS, sed: SEDATION, a4v: A4V };
export const FLOWS = { CN: ['sed', 'a4v'], CT: ['fgs', 'a4v'], LP: ['rgs'] };
export const PAIN_SPECIES = { CN: 'Chien', CT: 'Chat', LP: 'Lapin' };

export const NA = 'na';

// Les items d'une grille : pour la sédation, la version abrégée ne garde que les items marqués abbr.
export const activeItems = (scale, full = false) =>
  scale.id === 'sed' && !full ? scale.items.filter((item) => item.abbr) : scale.items;

export const maxOf = (item) => Math.max(...item.levels.map((l) => l.value));

// answers : { [itemId]: valeur numérique ou NA }. Renvoie la somme, le maximum des items notés et si tout est répondu.
export function scoreScale(scale, answers = {}, { full = false } = {}) {
  const items = activeItems(scale, full);
  let sum = 0;
  let max = 0;
  let scored = 0;
  let answered = 0;
  for (const item of items) {
    const a = answers[item.id];
    if (a === undefined) continue;
    answered += 1;
    if (a === NA) continue;
    scored += 1;
    sum += a;
    max += maxOf(item);
  }
  const totalMax = items.reduce((n, item) => n + maxOf(item), 0);
  const complete = answered === items.length && scored >= (scale.minScored ?? items.length);
  return { sum, max, totalMax, scored, answered, count: items.length, complete, ratio: max ? sum / max : null };
}

// Lecture du score d'une grille, une fois complet : { text, tone, alert }.
// tone : 'ok' (rien à signaler), 'info', 'alert' (à traiter) ; alert vaut true quand la grille conseille d'agir.
export function readScore(scale, score) {
  if (!score.complete) return null;
  if (scale.id === 'fgs') {
    const over = score.ratio >= scale.cutoff;
    return over
      ? { text: 'Seuil d’analgésie de secours atteint', tone: 'alert', alert: true }
      : { text: 'Sous le seuil d’analgésie de secours', tone: 'ok', alert: false };
  }
  if (scale.id === 'a4v') {
    const band = scale.bands.find((b) => score.sum <= b.to);
    return { text: band.text, tone: band.tone, alert: band.tone === 'alert' };
  }
  if (scale.id === 'rgs') return { text: 'Pas de seuil d’analgésie validé', tone: 'info', alert: false };
  return { text: 'Plus la sédation est marquée, moins l’expression de la douleur est fiable', tone: 'info', alert: false };
}

// --- historique ------------------------------------------------------------------------------------
// Une évaluation enregistrée : { t, name, species, fgs?, sed?, a4v?, alert } ; chaque grille : { sum, max, ratio?, full? }.
// L'historique ne garde que les 14 derniers jours : le suivi sert à l'hospitalisation, pas aux archives.

export const HISTORY_DAYS = 14;
export const MAX_ENTRIES = 300;

const DAY_MS = 24 * 3600 * 1000;

export function pruneHistory(entries, now = Date.now()) {
  const kept = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && typeof e.name === 'string' && Number.isFinite(e.t) && e.t > now - HISTORY_DAYS * DAY_MS && e.t <= now + DAY_MS,
  );
  return kept.sort((a, b) => a.t - b.t).slice(-MAX_ENTRIES);
}

// Fabrique l'entrée à enregistrer à partir des réponses en cours. Renvoie null si aucune grille n'est complète.
export function buildEntry({ name, species, answers, full = false, now = Date.now() }) {
  const entry = { t: now, name, species, alert: false };
  let any = false;
  for (const id of FLOWS[species] ?? []) {
    const scale = SCALES[id];
    const score = scoreScale(scale, answers[id], { full });
    if (!score.complete) continue;
    any = true;
    entry[id] = { sum: score.sum, max: score.max };
    if (id === 'fgs') entry[id].ratio = score.ratio;
    if (id === 'sed') entry[id].full = full;
    if (readScore(scale, score)?.alert) entry.alert = true;
  }
  return any ? entry : null;
}
