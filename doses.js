// Doses lues dans le texte « Posologie » d'une fiche Med'Vet, proposées d'un toucher. Calcul pur, sans DOM.
//
// tools/build-medvet-index.py ne propose d'office qu'une dose sans ambiguïté (70 textes sur 742). Ici, on liste au
// contraire chaque dose en mg/kg trouvée, avec sa phrase d'origine et ce qui la module (phase, condition, rythme),
// et c'est la vétérinaire qui choisit. Rien n'est jamais appliqué sans son toucher.
//
// Une dose lue :
//   min, max    mg/kg (max seulement pour une fourchette)
//   perDay      prises par jour, ou null quand le texte ne le dit pas clairement (à préciser)
//   basis       'intake' (par prise ou injection) ou 'day' (par jour, à répartir en perDay prises)
//   species     'CN', 'CT' ou null (texte commun aux deux espèces, sans titre « Chiens : » / « Chats : »)
//   sentence    la phrase du RCP, telle qu'écrite
//   tags        ce qui demande de lire le contexte (voir TAG_LABEL)
//   tap         false quand le rythme n'est pas quotidien : rien n'est appliqué, la dose est seulement montrée

const PNUM = '(\\d+(?:\\.\\d+)?)';
const KG = '(?:/|\\s+par\\s+|\\s*/\\s*)\\s*(?:kg|kilo(?:gramme)?s?)\\b';
const DOSE = PNUM + '(?:(?:\\s*mg)?\\s*(?:a|-|–|—|et)\\s*' + PNUM + ")?\\s*mg\\s*(?:de\\s+|d')?[^.;:\\d|]{0,40}?" + KG;
const ASSOC = PNUM + "\\s*mg\\s*d'\\s*amoxicilline\\s*et\\s*(?:de\\s*)?" + PNUM + "\\s*mg\\s*d'\\s*acide\\s*clavulanique\\s*" + KG;
const DAY_AFTER = /^\s*(?:de\s+poids\s+(?:corporel|vif)\s*)?(?:et\s+)?(?:\/\s*j(?:our)?\b|par\s+jour|par\s+24\s*h)/;

const FREQ = [
  [/\b(?:une|1)\s*fois\s*(?:par|\/|dans\s+la)\s*(?:jour|journee|24\s*h)|\btoutes?\s*les\s*24\s*(?:h|heures)|\btous\s*les\s*jours|\b(?:une|1)\s*(?:seule\s*)?(?:prise|administration|injection|dose)s?\s*(?:unique\s*)?(?:quotidienne|par\s*jour)|\b1\s*x\s*\/\s*j/, 1],
  [/\b(?:deux|2)\s*fois\s*(?:par|\/|dans\s+la)\s*(?:jour|journee|24\s*h)|\btoutes?\s*les\s*12\s*(?:h|heures)|\bmatin\s*et\s*soir|\b2\s*x\s*\/\s*j|\b(?:deux|2)\s*(?:prises|administrations|injections)\s*(?:quotidiennes|par\s*jour)/, 2],
  [/\b(?:trois|3)\s*fois\s*(?:par|\/|dans\s+la)\s*(?:jour|journee)|\btoutes?\s*les\s*8\s*(?:h|heures)|\b3\s*x\s*\/\s*j|\b(?:trois|3)\s*(?:prises|administrations|injections)\s*(?:quotidiennes|par\s*jour)/, 3],
  [/\b(?:quatre|4)\s*fois\s*(?:par|\/|dans\s+la)\s*(?:jour|journee)|\btoutes?\s*les\s*6\s*(?:h|heures)|\b4\s*x\s*\/\s*j|\b(?:quatre|4)\s*(?:prises|administrations|injections)\s*(?:quotidiennes|par\s*jour)/, 4],
];
const COUNTS = { deux: 2, 2: 2, trois: 3, 3: 3, quatre: 4, 4: 4 };
const SPLIT = /a\s*repartir|reparti|divise|en\s*(deux|2|trois|3|quatre|4)\s*(?:prises|fois|administrations|injections)/;
const SPLIT_COUNT = /en\s*(deux|2|trois|3|quatre|4)\s*(?:prises|fois|administrations|injections)/;
const MAY = /\bpeu(?:t|vent)\b|pourr|possible|\bou\b/;

const OTHER_UNIT = /(?:u|m)?cg\s*\/\s*kg|microgramme|ug\s*\/\s*kg|\bui\s*\/\s*kg|\/\s*m2|surface\s*corporelle/;
const OTHER_SPECIES = /\b(?:bovins?|porcins?|equins?|chevaux|cheval|volailles?|ovins?|caprins?|veaux?|moutons?|lapins?|rongeurs?|furets?|oiseaux|poulets?|dindes?|vaches?|truies?|poneys?|cochons?|reptiles?)\b/;
// rythme qui n'est pas « tant de fois par jour » : la dose est montrée, pas appliquée
const OFF_RHYTHM = /tous\s*les\s*(?:\d+|deux|trois)\s*jours|toutes\s*les\s*(?:36|48|72)\s*h|par\s*semaine|hebdomad|par\s*mois|tous\s*les\s*mois|chaque\s*mois|un\s*mois|mensuel|jours?\s*(?:sur|un\s*sur)\s*(?:deux|2)|alterne|plus\s*tard|intervalle\s*(?:d'administration|entre|de\s*(?:dose|dosage|traitement|\d))|etre\s*repet|a\s*repeter|repeter|renouvel/;
// fourchette de prises par jour : la dose est appliquée, le nombre de prises reste à préciser
const RANGE_RHYTHM = /\d+\s*(?:a|-)\s*\d+\s*fois|(?:une|1)\s*(?:a|ou|-)\s*(?:deux|2|trois|3)\s*fois|(?:deux|2)\s*(?:a|ou|-)\s*(?:trois|3|quatre|4)\s*fois|toutes\s*les\s*\d+\s*(?:a|-)\s*\d+\s*h/;
const PHASES = /de\s*charge|d'entretien|entretien|dose\s*initiale|traitement\s*initial|initialement|phase|premier\s*jour|premiere?\s*(?:dose|administration|injection|prise|semaine)|titrat|palier|ensuite|dans\s*un\s*second\s*temps|\bjour\s*1\b|\bj\s*1\b|semaine\s*\d|toutes\s*les\s*\d+\s*semaines|puis\s+(?:\d|la\s*dose|une\s*dose|reduire|diminuer|passer)/;
const CONDITION = /\bsi\b|selon|en\s*fonction|suivant|ajust|adapt|augment|reduit|reduire|diminu|gravite|insuffisan|chiots?\b|chatons?\b|jeunes?\b|gestant|allait|\bage\b|senior|obes|apres\s*\d|avant\s*\d|maximal|minimal/;
const SINGLE = /\bunique\b|une\s*seule\s*(?:fois|dose|administration|injection)/;
// rappel d'une administration : seul ce genre de mot compte dans la phrase d'après
const REPEAT = /plus\s*tard|intervalle|etre\s*repet|a\s*repeter|repeter|renouvel/;
const DOUBLE = /doubl/;
const TABLET_EQ = new RegExp('(\\d+(?:\\.\\d+)?\\s*(?:a|-)\\s*)?\\b(?:un|1|une)\\s*(?:comprime|gelule|capsule|cp)s?\\b[^.;\\d]{0,30}?\\bpour\\s*' + PNUM + '\\s*kg', 'g');
const VOLUME_EQ = new RegExp('(?:^|[^\\d.])(\\d+(?:\\.\\d+)?\\s*(?:a|-)\\s*)?' + PNUM + '\\s*ml\\b[^.;\\d]{0,40}?(?:/|pour|par)\\s*(?:' + PNUM + '\\s*)?kg', 'g');

export const TAG_LABEL = {
  phase: 'Phase du traitement : lire le contexte',
  condition: 'Dose qui dépend d’une condition',
  double: 'Dose doublée',
  single: 'Dose unique : durée d’un jour',
  max: 'Dose maximale : pas une dose à appliquer',
  wide: 'Fourchette large',
  rhythm: 'Rythme particulier : à saisir à la main',
  split: 'Répartition en prises au choix',
  range: 'Rythme en fourchette : prises à préciser',
  mismatch: 'Ne colle pas avec l’équivalence du RCP',
  confirmed: 'Recoupée avec l’équivalence du RCP',
};
// ce qui doit faire hésiter : trie les doses (les moins douteuses d'abord)
const WARNING = new Set(['phase', 'condition', 'double', 'single', 'wide', 'split', 'range', 'mismatch']);

const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/’/g, "'").replace(/µ/g, 'u').replace(/(\d),(\d)/g, '$1.$2');
const number = (s) => Number(s);
const compact = (n) => Math.round(n * 1e6) / 1e6;

// Les phrases d'un texte, telles qu'écrites (même découpage que tools/build-medvet-index.py).
export const sentencesOf = (text) => String(text).replace(/([.;:])[ \t]+/g, '$1\n').split(/\n+/).filter((s) => s.trim());

function freqsIn(sn) {
  const found = new Set(FREQ.filter(([rx]) => rx.test(sn)).map(([, n]) => n));
  const m = SPLIT_COUNT.exec(sn);
  if (m) found.add(COUNTS[m[1]]);
  return found;
}

// Species d'une phrase : celle qu'elle nomme, sinon celle du titre « Chiens : » en cours.
function speciesIn(sn) {
  const dog = /\bchiens?\b|\bchiots?\b|\bcanin/.test(sn);
  const cat = /\bchats?\b|\bchatons?\b|\bfelin/.test(sn);
  if (dog && !cat) return 'CN';
  if (cat && !dog) return 'CT';
  return dog && cat ? 'both' : null;
}
const isTitle = (sn) => sn.length <= 70 && /:\s*$/.test(sn);
const isHeading = (sn) => /^\s*(?:pour\s+(?:les?\s+)?)?(?:chiens?|chats?)\s*(?:\(.*\))?\s*:?\s*$/.test(sn) || /^\s*(?:chiens?|chats?)\s*:/.test(sn);

// opts : { species: 'CN' | 'CT' (le patient ; vide = tout garder), assoc: true pour amoxicilline + acide clavulanique
//          (dose = somme des deux), strength: mg par comprimé, conc: mg/mL (recoupement avec « 1 comprimé pour 10 kg ») }
export function readDoses(text, opts = {}) {
  const sentences = sentencesOf(text);
  const norms = sentences.map(norm);
  const textFreqs = new Set(FREQ.filter(([rx]) => norms.some((s) => rx.test(s))).map(([, n]) => n));
  const textFreq = textFreqs.size === 1 ? [...textFreqs][0] : null;

  const all = norms.join('\n');
  const checks = [];
  if (opts.strength) for (const m of all.matchAll(TABLET_EQ)) if (!m[1]) checks.push(opts.strength / number(m[2]));
  if (opts.conc) for (const m of all.matchAll(VOLUME_EQ)) if (!m[1]) checks.push((number(m[2]) / (m[3] ? number(m[3]) : 1)) * opts.conc);

  const out = [];
  let heading = null;
  let skipSection = false; // sous un titre « Chez les bovins : », jusqu'au titre suivant
  norms.forEach((sn, i) => {
    if (isHeading(sn)) heading = speciesIn(sn) === 'both' ? null : speciesIn(sn);
    if (isTitle(sn)) skipSection = OTHER_SPECIES.test(sn);
    if (skipSection) return;
    const named = speciesIn(sn);
    const species = named === 'both' ? null : named ?? heading;
    if (opts.species && species && species !== opts.species) return;
    if (OTHER_UNIT.test(sn) || OTHER_SPECIES.test(sn)) return;

    const raw = [];
    if (opts.assoc) {
      for (const m of sn.matchAll(new RegExp(ASSOC, 'g'))) raw.push({ lo: number(m[1]) + number(m[2]), hi: null, start: m.index, end: m.index + m[0].length });
    } else {
      for (const m of sn.matchAll(new RegExp(DOSE, 'g'))) {
        raw.push({ lo: number(m[1]), hi: m[2] ? number(m[2]) : null, start: m.index, end: m.index + m[0].length });
      }
    }
    let from = 0; // fin de la dose précédente : ce qui précède celle-ci s'arrête là
    for (const [n, d] of raw.entries()) {
      const before = sn.slice(from, d.start);
      from = d.end;
      if (!(d.lo > 0)) continue;
      let { lo, hi } = d;
      if (hi != null && hi <= lo) hi = null;

      const near = [norms[i - 1], sn, norms[i + 1]].filter((s) => s != null).join(' ');
      const tags = [];
      const isMax = /maxim/.test(before);
      const offRhythm = OFF_RHYTHM.test(sn) || REPEAT.test(norms[i + 1] ?? '');
      const single = !offRhythm && SINGLE.test(sn);
      if (isMax) tags.push('max');
      else if (offRhythm) tags.push('rhythm');
      else if (single) tags.push('single');
      if (PHASES.test(near)) tags.push('phase');
      if (CONDITION.test(sn)) tags.push('condition');
      if (DOUBLE.test(sn)) tags.push('double');
      if (hi != null && hi / lo > 2) tags.push('wide');

      // prises par jour : la phrase, puis la suivante, la précédente, enfin le texte entier s'il n'en dit qu'un
      let perDay = null;
      let rangeFreq = RANGE_RHYTHM.test(sn);
      // dans un tableau (cellules séparées par « | »), les lignes voisines parlent d'autres doses : on ne leur emprunte rien
      const neighbours = sn.includes('|') ? [] : [norms[i + 1], norms[i - 1]];
      for (const candidate of [sn, ...neighbours]) {
        if (candidate == null) continue;
        const f = freqsIn(candidate);
        if (f.size === 1) { perDay = [...f][0]; break; }
        if (f.size > 1) { rangeFreq = true; break; }
      }
      if (perDay == null && !rangeFreq && textFreq) perDay = textFreq;
      if (perDay == null || rangeFreq) { perDay = null; if (rangeFreq && !tags.includes('rhythm')) tags.push('range'); }

      if (single && perDay == null) perDay = 1;
      // « dose quotidienne conseillée de 0,5 mg/kg » ou « 0,5 mg/kg par jour » : c'est la dose du jour
      const daily = n === 0 && /dose\s+(?:quotidienne|journaliere)|par\s+jour|\/\s*jour|par\s+24\s*h/.test(before) && !/par\s+prise|par\s+administration/.test(sn.slice(d.end, d.end + 40));
      let basis = DAY_AFTER.test(sn.slice(d.end, d.end + 60)) || daily ? 'day' : 'intake';
      if (basis === 'day' && perDay === 1) basis = 'intake';
      if (basis === 'day' && perDay > 1) {
        // « peut être répartie » laisse le choix : le nombre de prises n'est pas imposé
        const splits = norms.filter((s) => SPLIT.test(s));
        if (!splits.length || splits.some((s) => MAY.test(s))) { perDay = null; tags.push('split'); }
      }

      // dose de la prise, pour recouper avec « 1 comprimé pour 10 kg »
      let confirmed = false;
      if (checks.length && perDay) {
        const per = (v) => (basis === 'day' ? v / perDay : v);
        const [a, b] = [per(lo), per(hi ?? lo)];
        confirmed = checks.some((c) => a * 0.88 <= c && c <= b * 1.12);
      }
      out.push({ min: compact(lo), max: hi == null ? undefined : compact(hi), perDay, basis, species: opts.species ?? species, sentence: sentences[i].trim(), tags, tap: !offRhythm && !isMax, confirmed, checked: checks.length > 0 });
    }
  });

  // même dose redite (reprise dans une autre phrase) : une seule fois
  const seen = new Map();
  for (const d of out) {
    const key = [d.min, d.max, d.perDay, d.basis, d.species].join('|');
    if (!seen.has(key)) seen.set(key, d);
    else if (d.confirmed) seen.get(key).confirmed = true;
  }
  const doses = [...seen.values()];
  // aucune dose ne colle avec l'équivalence du RCP : probablement une dose exprimée en sel ou en base
  if (doses.length && doses.every((d) => d.checked && !d.confirmed && d.perDay)) for (const d of doses) d.tags.push('mismatch');
  for (const d of doses) {
    if (d.confirmed) d.tags.push('confirmed');
    delete d.checked;
  }
  return doses;
}

// Rapproche les doses des fiches de plusieurs marques d'une même substance.
// sources : [{ name, link, doses: readDoses(...) }] -> groupes triés, les plus sûres d'abord.
// Deux doses sont la même quand elles donnent la même quantité par prise et le même nombre de prises.
export function groupDoses(sources) {
  const perIntake = (d) => (d.basis === 'day' && d.perDay ? { lo: d.min / d.perDay, hi: (d.max ?? d.min) / d.perDay } : { lo: d.min, hi: d.max ?? d.min });
  const groups = new Map();
  for (const src of sources) {
    for (const d of src.doses) {
      const p = perIntake(d);
      const key = d.perDay
        ? ['i', compact(p.lo).toFixed(4), compact(p.hi).toFixed(4), d.perDay, d.species ?? ''].join('|')
        : ['d', d.basis, d.min, d.max ?? '', d.species ?? ''].join('|');
      let g = groups.get(key);
      if (!g) {
        g = { ...d, tags: [...d.tags], names: [], links: [] };
        groups.set(key, g);
      }
      if (!g.names.includes(src.name)) { g.names.push(src.name); g.links.push(src.link); }
      if (d.confirmed && !g.tags.includes('confirmed')) { g.tags.push('confirmed'); g.confirmed = true; }
    }
  }
  const list = [...groups.values()];
  const warnings = (g) => g.tags.filter((t) => WARNING.has(t)).length;
  list.sort((a, b) =>
    (b.tap - a.tap) || (b.confirmed - a.confirmed) || (warnings(a) - warnings(b))
    || (b.names.length - a.names.length) || (a.min - b.min));
  return list;
}
