// Ordonnance : quelle version d'un médicament remettre (dosage du comprimé, plaquettes) selon le poids
// de l'animal et la durée du traitement. Calcul pur, sans DOM : testable seul.
//
// Un médicament du catalogue :
//   name, species ('CN' | 'CT' | absent), min (+ max) en mg/kg, basis ('intake' par prise | 'day' par jour),
//   perDay (prises par jour), note, link, formats[]
// Un dosage en stock (format) :
//   name, mg (par comprimé), perBlister (comprimés par plaquette), blisters (plaquettes par boîte),
//   split ('none' | 'half' | 'quarter' : plus petit morceau possible), price (la boîte, facultatif), unit ('cp' | 'gél.')

export const MAX_PER_INTAKE = 6; // au-delà, on ne propose plus ce dosage : trop de comprimés à donner d'un coup
export const DEFAULT_PREFS = { tol: 0.1, split: 'half', dispense: 'blister', rank: 'waste' };
export const TOLERANCES = [0.05, 0.1, 0.15, 0.2];
export const SPLITS = ['none', 'half', 'quarter'];
export const DISPENSES = ['box', 'blister', 'unit'];
export const RANKS = ['waste', 'cost', 'pills', 'exact'];

const SPLIT_STEP = { none: 1, half: 0.5, quarter: 0.25 };
const SPLIT_RANK = { none: 0, half: 1, quarter: 2 };
const EPS = 1e-9;

export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// --- calcul -------------------------------------------------------------------------

// Dose cible par prise, en mg (fourchette si min et max sont renseignés).
export function target(drug, weight) {
  const perIntake = (kg) => (drug.basis === 'day' ? kg / drug.perDay : kg) * weight;
  const lo = perIntake(drug.min);
  const hi = isNum(drug.max) && drug.max > drug.min ? perIntake(drug.max) : lo;
  return { lo, hi, mid: (lo + hi) / 2, ranged: hi > lo };
}

// Écart de la dose avec la cible : 0 dans la fourchette, sinon en fraction de la borne la plus proche.
function deviation(dose, t) {
  if (dose < t.lo) return (dose - t.lo) / t.lo;
  if (dose > t.hi) return (dose - t.hi) / t.hi;
  return 0;
}

function stepOf(format, prefs) {
  const rank = Math.min(SPLIT_RANK[format.split] ?? 0, SPLIT_RANK[prefs.split] ?? 0);
  return [1, 0.5, 0.25][rank];
}

// Le meilleur nombre de comprimés par prise pour un dosage : le plus proche du milieu de la cible
// parmi ceux qui respectent la tolérance. Sans aucun qui la respecte, le plus proche tout court.
// La borne haute d'une fourchette (dose max) n'est jamais dépassée.
function bestTablets(format, t, prefs) {
  const step = stepOf(format, prefs);
  const floor = t.lo * (1 - prefs.tol);
  const ceiling = t.ranged ? t.hi : t.lo * (1 + prefs.tol);
  let inside = null;
  let nearest = null;
  for (let q = step * 4; q <= MAX_PER_INTAKE * 4; q += step * 4) {
    const tablets = q / 4;
    const dose = tablets * format.mg;
    const gap = Math.abs(dose - t.mid);
    if (dose >= floor - EPS * t.lo && dose <= ceiling + EPS * ceiling && (!inside || gap < inside.gap - EPS)) {
      inside = { tablets, q, dose, gap };
    }
    if (!nearest || gap < nearest.gap - EPS) nearest = { tablets, q, dose, gap };
  }
  const pick = inside ?? nearest;
  return { ...pick, ok: Boolean(inside) };
}

// Ce qu'il faut remettre pour couvrir `days` jours avec ce nombre de comprimés par prise.
function supplyFor(format, q, perDay, days, prefs) {
  const totalQuarters = q * perDay * days;
  const need = Math.ceil(totalQuarters / 4); // comprimés entiers entamés
  const perBlister = format.perBlister;
  if (!(perBlister > 0)) return { need, totalQuarters, packs: null };
  const blisters = format.blisters > 0 ? format.blisters : 1;
  const perBox = perBlister * blisters;

  let count;
  let unit;
  let remitted;
  if (prefs.dispense === 'box') {
    unit = 'box';
    count = Math.ceil(need / perBox);
    remitted = count * perBox;
  } else if (prefs.dispense === 'unit') {
    unit = 'unit';
    count = need;
    remitted = need;
  } else {
    unit = 'blister';
    count = Math.ceil(need / perBlister);
    remitted = count * perBlister;
  }
  const leftoverQuarters = remitted * 4 - totalQuarters;
  let cost = null;
  if (isNum(format.price) && format.price >= 0) {
    cost = unit === 'box' ? count * format.price
      : unit === 'blister' ? (count * format.price) / blisters
        : (count * format.price) / perBox;
  }
  return {
    need,
    totalQuarters,
    unit,
    count,
    remitted,
    perBlister,
    blisters,
    perBox,
    leftover: leftoverQuarters / 4,
    leftoverMg: (leftoverQuarters / 4) * format.mg,
    extraDays: Math.floor(leftoverQuarters / (q * perDay)),
    cost,
    packs: true,
  };
}

const ready = (drug) => isNum(drug.min) && drug.min > 0
  && Number.isInteger(drug.perDay) && drug.perDay >= 1;
const usable = (format) => isNum(format.mg) && format.mg > 0;

// Ordre de préférence entre deux propositions qui respectent la tolérance.
function compare(a, b, prefs) {
  const waste = (o) => (o.supply?.packs ? o.supply.leftoverMg : Infinity);
  const cost = (o) => o.supply?.cost ?? Infinity;
  const keys = {
    waste: (o) => [waste(o), o.q, Math.abs(o.dev), !o.whole],
    cost: (o) => [cost(o), waste(o), o.q, Math.abs(o.dev)],
    pills: (o) => [o.q, !o.whole, waste(o), Math.abs(o.dev)],
    exact: (o) => [Math.abs(o.gap), o.q, waste(o), !o.whole],
  };
  const ka = (keys[prefs.rank] ?? keys.waste)(a);
  const kb = (keys[prefs.rank] ?? keys.waste)(b);
  for (let i = 0; i < ka.length; i++) {
    const x = Number(ka[i]);
    const y = Number(kb[i]);
    if (Math.abs(x - y) > EPS * Math.max(1, Math.abs(x))) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Plan complet pour un médicament.
 * ctx : { weight, days, prefs }. days peut être null : on ne calcule alors que la dose par prise.
 * Renvoie { status, target, options, skipped } ; status vaut 'weight' (poids manquant), 'drug'
 * (posologie incomplète), 'formats' (aucun dosage utilisable) ou 'ok'.
 */
export function plan(drug, ctx) {
  const prefs = { ...DEFAULT_PREFS, ...ctx.prefs };
  if (!ready(drug)) return { status: 'drug', options: [], skipped: 0 };
  const formats = drug.formats.filter(usable);
  const skipped = drug.formats.length - formats.length;
  if (!formats.length) return { status: 'formats', options: [], skipped };
  if (!(ctx.weight > 0)) return { status: 'weight', options: [], skipped };

  const t = target(drug, ctx.weight);
  const days = Number.isInteger(ctx.days) && ctx.days > 0 ? ctx.days : null;
  const options = formats.map((format) => {
    const pick = bestTablets(format, t, prefs);
    return {
      format,
      ...pick,
      whole: Number.isInteger(pick.tablets),
      perKg: pick.dose / ctx.weight,
      dev: deviation(pick.dose, t),
      supply: days ? supplyFor(format, pick.q, drug.perDay, days, prefs) : null,
    };
  });

  const inside = options.filter((o) => o.ok).sort((a, b) => compare(a, b, prefs));
  const outside = options.filter((o) => !o.ok).sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev));
  return { status: 'ok', target: t, options: [...inside, ...outside], skipped };
}

// --- textes -------------------------------------------------------------------------

const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

// 1.5 -> « 1½ », 0.25 -> « ¼ »
export function tabletText(tablets) {
  const whole = Math.floor(tablets + EPS);
  const fraction = FRACTIONS[Math.round((tablets - whole) * 100) / 100];
  return `${whole > 0 || !fraction ? whole : ''}${fraction ?? ''}`;
}

// Version dite à voix haute, pour les lecteurs d'écran.
export function tabletSpeech(tablets, unit = 'comprimé') {
  const whole = Math.floor(tablets + EPS);
  const part = { 0.25: 'un quart', 0.5: 'demi', 0.75: 'trois quarts' }[Math.round((tablets - whole) * 100) / 100];
  if (!part) return `${whole} ${unit}${whole > 1 ? 's' : ''}`;
  if (!whole) return `${part === 'demi' ? 'un demi' : part} ${unit}`;
  return `${whole} ${unit}${whole > 1 ? 's' : ''} et ${part}`;
}

// --- catalogue ----------------------------------------------------------------------

const optNum = (v) => (isNum(v) ? v : null);
const optInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

export function normalizeFormat(raw = {}) {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    mg: optNum(raw.mg),
    perBlister: optInt(raw.perBlister),
    blisters: optInt(raw.blisters) ?? 1,
    split: SPLITS.includes(raw.split) ? raw.split : 'none',
    price: isNum(raw.price) && raw.price >= 0 ? raw.price : undefined,
    unit: raw.unit === 'gél.' ? 'gél.' : 'cp',
  };
}

export function normalizeDrug(raw = {}) {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    species: raw.species === 'CN' || raw.species === 'CT' ? raw.species : undefined,
    min: optNum(raw.min),
    max: isNum(raw.max) ? raw.max : undefined,
    basis: raw.basis === 'day' ? 'day' : 'intake',
    perDay: optInt(raw.perDay),
    note: typeof raw.note === 'string' ? raw.note : '',
    link: typeof raw.link === 'string' && /^https:\/\//.test(raw.link) ? raw.link : undefined,
    formats: Array.isArray(raw.formats) ? raw.formats.filter((f) => f && typeof f === 'object').map(normalizeFormat) : [],
  };
}

export function normalizePrefs(raw = {}) {
  return {
    tol: TOLERANCES.includes(raw.tol) ? raw.tol : DEFAULT_PREFS.tol,
    split: SPLITS.includes(raw.split) ? raw.split : DEFAULT_PREFS.split,
    dispense: DISPENSES.includes(raw.dispense) ? raw.dispense : DEFAULT_PREFS.dispense,
    rank: RANKS.includes(raw.rank) ? raw.rank : DEFAULT_PREFS.rank,
  };
}

// --- index Med'Vet (medvet-oral.json, généré par tools/build-medvet-index.py) ---------

export const LINK_PREFIX = 'https://med-vet.fr/produits/medicament/';
export const fold = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const prepare = (text) => fold(text).replace(/,/g, '.');

// Produits qui contiennent tous les mots cherchés (dans la marque, le nom ou le principe actif).
// Ceux dont la marque commence par le premier mot passent devant.
export function searchIndex(products, query, limit = 30) {
  const words = prepare(query).split(/[^a-z0-9.]+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const product of products) {
    product.h ??= prepare(`${product.b} ${product.d} ${product.a.map((a) => a[0]).join(' ')}`);
    if (words.every((w) => product.h.includes(w))) hits.push(product);
  }
  const first = (p) => (prepare(p.b).startsWith(words[0]) ? 0 : 1);
  return hits.sort((a, b) => first(a) - first(b)).slice(0, limit);
}

const mgText = (n) => String(n).replace('.', ',');

export function productName(product) {
  return product.m != null ? `${product.b} ${mgText(product.m)} mg` : product.d;
}

// Libellé lisible d'un conditionnement du produit : [plaquettes, comprimés par plaquette, texte d'origine]
export function packText(pack, unit = 'cp') {
  const [blisters, per, text] = pack;
  if (!blisters) return text || 'Conditionnement à saisir';
  const what = unit === 'gél.' ? 'gélule' : 'comprimé';
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  return blisters === 1 ? `${plural(per, what)}` : `${plural(blisters, 'plaquette')} de ${per}`;
}

export function formatFromProduct(product, pack) {
  return normalizeFormat({
    name: productName(product),
    mg: product.m,
    perBlister: pack[1],
    blisters: pack[0] ?? 1,
    split: ['none', 'half', 'quarter'][product.x] ?? 'none',
    unit: product.u,
  });
}

export function drugFromProduct(product, pack) {
  return normalizeDrug({
    name: product.b,
    link: product.l ? (product.l.startsWith('https://') ? product.l : LINK_PREFIX + product.l) : undefined,
    formats: [formatFromProduct(product, pack)],
  });
}
