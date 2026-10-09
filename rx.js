// Ordonnance : quel article remettre (dosage du comprimé, flacon, pipette...) selon le poids de l'animal et la
// durée du traitement. Calcul pur, sans DOM : testable seul.
//
// Un médicament du catalogue :
//   name, species ('CN' | 'CT' | absent), min (+ max) en mg/kg, basis ('intake' par prise | 'day' par jour),
//   perDay (prises par jour), note, link, formats[] (dosages saisis à la main : « mon stock »),
//   substance (libellé Med'Vet : l'appli cherche alors parmi tous les articles de la substance),
//   brand (marque : restreint la recherche à cette marque, absente = toutes),
//   route ('oral' comprimés et liquides buvables | 'inj' injectables | 'spot' spot-on : article choisi selon le poids),
//   interval (spot-on : jours entre deux applications, pour compter les pipettes),
//   suggested (true : la posologie vient d'une suggestion Med'Vet que personne n'a encore confirmée ni modifiée)
// Un dosage ou article (format) :
//   name, mg (par comprimé), perBlister (comprimés par plaquette), blisters (plaquettes par boîte),
//   split ('none' | 'half' | 'quarter' : plus petit morceau possible), price (la boîte, facultatif), unit ('cp' | 'gél.'),
//   gtin (code de la boîte, facultatif ; plusieurs codes séparés par des virgules)
// Un liquide (oral ou injectable) a unit 'mL' : conc (mg/mL), volume (mL d'un contenant), bottles (contenants par
// boîte), container ('flacon' par défaut, 'ampoule', 'poche'...), route 'inj' pour un injectable.
// Un spot-on a unit 'pip' : band { lo, hi (null = sans limite), excl (lo exclu) } la tranche de poids du libellé
// (null = non lue), perBox (pipettes par boîte), volume (mL d'une pipette).

export const MAX_PER_INTAKE = 6; // au-delà, on ne propose plus ce dosage : trop de comprimés à donner d'un coup
export const MAX_ML_PER_INTAKE = 30; // volume maximal par prise d'un liquide
export const SYRINGES = [0.01, 0.05, 0.1]; // graduation de la seringue, en mL
export const DEFAULT_PREFS = { tol: 0.1, split: 'half', dispense: 'blister', rank: 'waste', source: 'medvet', syringe: 0.05 };
export const TOLERANCES = [0.05, 0.1, 0.15, 0.2];
export const SPLITS = ['none', 'half', 'quarter'];
export const DISPENSES = ['box', 'blister', 'unit'];
export const RANKS = ['waste', 'cost', 'pills', 'exact'];
export const SOURCES = ['medvet', 'stock']; // tous les articles Med'Vet, ou seulement les dosages saisis
export const ROUTES = ['oral', 'inj', 'spot'];

const SPLIT_STEP = { none: 1, half: 0.5, quarter: 0.25 };
const SPLIT_RANK = { none: 0, half: 1, quarter: 2 };
const EPS = 1e-9;

export const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
export const isLiquid = (format) => format.unit === 'mL';
export const isBand = (format) => format.unit === 'pip';

// --- calcul -------------------------------------------------------------------------

// Dose cible par prise, en mg (fourchette si min et max sont renseignés).
export function target(drug, weight) {
  const perIntake = (kg) => Number(((drug.basis === 'day' ? kg / drug.perDay : kg) * weight).toPrecision(12));
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
    const dose = Number((tablets * format.mg).toPrecision(12)); // sans le bruit de calcul (0,8 x 1,5 = 1,2000000000000002)
    const gap = Math.abs(dose - t.mid);
    if (dose >= floor - EPS * t.lo && dose <= ceiling + EPS * ceiling && (!inside || gap < inside.gap - EPS)) {
      inside = { tablets, q, dose, gap };
    }
    if (!nearest || gap < nearest.gap - EPS) nearest = { tablets, q, dose, gap };
  }
  const pick = inside ?? nearest;
  return { ...pick, ok: Boolean(inside) };
}

// Le meilleur volume par prise d'un liquide, à la graduation de la seringue : même règle que pour les comprimés.
function bestVolume(format, t, prefs) {
  const step = prefs.syringe > 0 ? prefs.syringe : DEFAULT_PREFS.syringe;
  const floor = t.lo * (1 - prefs.tol);
  const ceiling = t.ranged ? t.hi : t.lo * (1 + prefs.tol);
  const maxN = Math.floor(MAX_ML_PER_INTAKE / step + EPS);
  const around = Math.round(t.mid / format.conc / step);
  let inside = null;
  let nearest = null;
  for (let n = Math.min(Math.max(1, around - 2), maxN); n <= Math.min(around + 2, maxN); n++) {
    const amount = Number((n * step).toFixed(6));
    const dose = Number((amount * format.conc).toPrecision(12));
    const gap = Math.abs(dose - t.mid);
    if (dose >= floor - EPS * t.lo && dose <= ceiling + EPS * ceiling && (!inside || gap < inside.gap - EPS)) {
      inside = { amount, dose, gap };
    }
    if (!nearest || gap < nearest.gap - EPS) nearest = { amount, dose, gap };
  }
  const pick = inside ?? nearest;
  return { ...pick, tablets: null, q: pick.amount, ok: Boolean(inside) };
}

// Ce qu'il faut remettre d'un liquide : des flacons (ou des boîtes de flacons), jamais un volume au détail.
function liquidSupplyFor(format, amount, perDay, days, prefs) {
  const total = Number((amount * perDay * days).toFixed(6));
  const bottle = format.volume;
  if (!(bottle > 0)) return { kind: 'liquid', total, packs: null };
  const bottles = format.bottles > 0 ? format.bottles : 1;
  const perBox = bottle * bottles;
  const box = prefs.dispense === 'box';
  const count = Math.ceil(total / (box ? perBox : bottle) - EPS);
  const remitted = count * (box ? perBox : bottle);
  const leftover = Number((remitted - total).toFixed(6));
  let cost = null;
  if (isNum(format.price) && format.price >= 0) cost = box ? count * format.price : (count * format.price) / bottles;
  return {
    kind: 'liquid',
    total,
    unit: box ? 'box' : 'bottle',
    container: format.container ?? 'flacon',
    count,
    remitted,
    bottle,
    bottles,
    perBox,
    leftover,
    leftoverMg: leftover * format.conc,
    extraDays: Math.floor(leftover / (amount * perDay) + EPS),
    cost,
    packs: true,
  };
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
const usable = (format) => (isLiquid(format) ? isNum(format.conc) && format.conc > 0 : isNum(format.mg) && format.mg > 0);

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

// Articles de marques différentes au même dosage, même forme, même conditionnement et même résultat : on n'en
// garde qu'un dans la liste (le premier dans l'ordre), les autres sont rangés dans `same`. Seuls les articles
// Med'Vet (qui ont une marque) sont regroupés.
function groupEquivalents(list) {
  const groups = new Map();
  const signature = (o) => {
    const f = o.format;
    if (isBand(f)) return ['bande', f.species ?? '', f.band ? `${f.band.lo},${f.band.hi},${f.band.excl}` : '', f.volume ?? '', f.boxes?.map((b) => b.blisters).join('/') ?? ''].join('|');
    const liquid = isLiquid(f);
    return [
      liquid ? 'liquide' : f.form ?? '',
      f.species ?? '',
      liquid ? f.conc : f.mg,
      liquid ? o.amount : o.tablets,
      liquid ? f.volume : f.perBlister,
      o.supply?.packs ? `${o.supply.count}/${o.supply.leftover}` : '',
    ].join('|');
  };
  for (const o of list) {
    if (!o.format.brand) { groups.set(Symbol('seul'), o); continue; }
    const key = signature(o);
    const first = groups.get(key);
    if (first) (first.same ??= []).push(o);
    else groups.set(key, o);
  }
  return [...groups.values()];
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
    if (isLiquid(format)) {
      const volume = bestVolume(format, t, prefs);
      return {
        format,
        ...volume,
        whole: true,
        perKg: volume.dose / ctx.weight,
        dev: deviation(volume.dose, t),
        supply: days ? liquidSupplyFor(format, volume.amount, drug.perDay, days, prefs) : null,
      };
    }
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

  const inside = groupEquivalents(options.filter((o) => o.ok).sort((a, b) => compare(a, b, prefs)));
  const outside = groupEquivalents(options.filter((o) => !o.ok).sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev)));
  return { status: 'ok', target: t, options: [...inside, ...outside], skipped };
}

// --- articles choisis selon le poids (spot-on) ----------------------------------------

const inBand = (band, weight) => (band.excl ? weight > band.lo : weight >= band.lo) && (band.hi == null || weight <= band.hi);
const bandGap = (band, weight) => (inBand(band, weight) ? 0 : weight <= band.lo ? band.lo - weight : weight - band.hi);
// Position dans la tranche : 0 au milieu, 0,5 aux bords ; une tranche sans limite haute compte pour 0,5.
const bandCentre = (band, weight) => (band.hi == null ? 0.5 : Math.abs(weight - (band.lo + band.hi) / 2) / Math.max(band.hi - band.lo, EPS));

// Pipettes à fournir pour `applications` applications : la boîte qui laisse le moins de reste.
function bandSupplyFor(format, applications) {
  let best = null;
  for (const box of format.boxes ?? []) {
    const count = Math.ceil(applications / box.blisters);
    const candidate = { count, perBox: box.blisters, gtin: box.gtin, leftover: count * box.blisters - applications };
    if (!best || candidate.leftover < best.leftover || (candidate.leftover === best.leftover && count < best.count)) best = candidate;
  }
  return best ? { kind: 'band', applications, ...best, packs: true } : { kind: 'band', applications, packs: null };
}

/**
 * Spot-on : l'article dont la tranche de poids (lue dans le libellé du produit) contient le poids du patient.
 * ctx : { weight, days } ; drug.interval (jours entre deux applications) permet de compter les pipettes.
 * Renvoie { status ('formats' | 'weight' | 'ok'), options, unread (articles sans tranche lue), applications }.
 * Sans tranche qui contienne le poids, options reprend les plus proches (ok: false).
 */
export function planBand(drug, ctx) {
  const formats = drug.formats.filter(isBand);
  const unread = formats.filter((f) => !f.band).length;
  if (!formats.length) return { status: 'formats', options: [], unread };
  if (!(ctx.weight > 0)) return { status: 'weight', options: [], unread };
  const days = Number.isInteger(ctx.days) && ctx.days > 0 ? ctx.days : null;
  const applications = days && drug.interval > 0 ? Math.ceil(days / drug.interval) : null;
  const options = formats.filter((f) => f.band).map((format) => ({
    format,
    ok: inBand(format.band, ctx.weight),
    gap: bandGap(format.band, ctx.weight),
    centre: bandCentre(format.band, ctx.weight),
    supply: applications ? bandSupplyFor(format, applications) : null,
  }));
  const leftover = (o) => (o.supply?.packs ? o.supply.leftover : Infinity);
  const inside = groupEquivalents(options.filter((o) => o.ok)
    .sort((a, b) => leftover(a) - leftover(b) || a.centre - b.centre || a.format.name.localeCompare(b.format.name, 'fr')));
  const near = groupEquivalents(options.filter((o) => !o.ok).sort((a, b) => a.gap - b.gap));
  return { status: 'ok', options: [...inside, ...near], unread, applications };
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

const CONTAINERS = ['ampoule', 'poche', 'seringue', 'cartouche'];
const validBand = (b) => (b && isNum(b.lo) && (b.hi == null || (isNum(b.hi) && b.hi > b.lo)) ? { lo: b.lo, hi: b.hi ?? null, excl: Boolean(b.excl) } : undefined);

export function normalizeFormat(raw = {}) {
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    mg: optNum(raw.mg),
    perBlister: optInt(raw.perBlister),
    blisters: optInt(raw.blisters) ?? 1,
    split: SPLITS.includes(raw.split) ? raw.split : 'none',
    price: isNum(raw.price) && raw.price >= 0 ? raw.price : undefined,
    unit: raw.unit === 'gél.' ? 'gél.' : raw.unit === 'mL' ? 'mL' : raw.unit === 'pip' ? 'pip' : 'cp',
    container: CONTAINERS.includes(raw.container) ? raw.container : undefined,
    route: raw.route === 'inj' ? 'inj' : undefined,
    band: validBand(raw.band),
    perBox: optInt(raw.perBox) ?? undefined,
    conc: isNum(raw.conc) && raw.conc > 0 ? raw.conc : undefined,
    volume: isNum(raw.volume) && raw.volume > 0 ? raw.volume : undefined,
    bottles: optInt(raw.bottles) ?? undefined,
    gtin: typeof raw.gtin === 'string' && /^\d{8,14}(,\d{8,14})*$/.test(raw.gtin) ? raw.gtin : undefined,
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
    substance: typeof raw.substance === 'string' && raw.substance ? raw.substance : undefined,
    brand: typeof raw.brand === 'string' && raw.brand ? raw.brand : undefined,
    route: ROUTES.includes(raw.route) ? raw.route : 'oral',
    interval: optInt(raw.interval) ?? undefined,
    suggested: raw.suggested === true ? true : undefined,
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
    source: SOURCES.includes(raw.source) ? raw.source : DEFAULT_PREFS.source,
    syringe: SYRINGES.includes(raw.syringe) ? raw.syringe : DEFAULT_PREFS.syringe,
  };
}

// --- index Med'Vet (medvet-oral.json, généré par tools/build-medvet-index.py) ---------

export const LINK_PREFIX = 'https://med-vet.fr/produits/medicament/';
export const fold = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const prepare = (text) => fold(text).replace(/,/g, '.');

// GTIN d'un conditionnement. Med'Vet les donne sur 14 chiffres : le zéro de tête n'est que le remplissage du
// GTIN-13 (l'EAN imprimé sur la boîte), qu'on affiche donc sans lui.
export const gtinShown = (code) => (code.length === 14 && code.startsWith('0') ? code.slice(1) : code);
export const gtinCodes = (codes) => (codes ? codes.split(',').filter(Boolean).map(gtinShown) : []);

// Distance d'édition (insertion, suppression, remplacement, échange de deux lettres voisines).
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Un mot cherché est « proche » d'un mot du produit à une faute de frappe près (deux pour les mots longs).
const near = (word, token) => {
  if (word.length < 4 || Math.abs(word.length - token.length) > 3) return false;
  const allowed = word.length >= 8 ? 2 : 1;
  return Math.min(editDistance(word, token), editDistance(word, token.slice(0, word.length))) <= allowed;
};

// Produits qui contiennent tous les mots cherchés (dans la marque, le nom, le principe actif ou un GTIN).
// Ceux dont la marque commence par le premier mot passent devant. Sans aucun résultat, on essaie à une faute
// de frappe près (« meloxodyl » trouve Meloxidyl) : le tableau renvoyé porte alors approx = true.
export function searchIndex(products, query, limit = 30) {
  const words = prepare(query).split(/[^a-z0-9.]+/).filter(Boolean);
  if (!words.length) return [];
  const hits = [];
  for (const product of products) {
    product.h ??= prepare(`${product.b} ${product.d} ${product.f} ${product.a.map((a) => a[0]).join(' ')} ${product.k.map((k) => k[3] ?? '').join(' ')}`);
    if (words.every((w) => product.h.includes(w))) hits.push(product);
  }
  const first = (p) => (prepare(p.b).startsWith(words[0]) ? 0 : 1);
  if (hits.length) return hits.sort((a, b) => first(a) - first(b)).slice(0, limit);

  const close = [];
  for (const product of products) {
    product.tokens ??= [...new Set(product.h.split(/[^a-z0-9.]+/).filter(Boolean))];
    // les mots avec un chiffre (dosage, GTIN) doivent rester exacts
    if (words.every((w) => (/\d/.test(w) ? product.h.includes(w) : product.h.includes(w) || product.tokens.some((t) => near(w, t))))) close.push(product);
  }
  const result = close.slice(0, limit);
  result.approx = result.length > 0;
  return result;
}

const mgText = (n) => String(n).replace('.', ',');

// --- substances et articles : croiser tout le catalogue Med'Vet ---------------------------

// « Maropitant (sous forme de citrate) » -> « Maropitant » ; « (S)-Méthoprène » reste entier.
const stripNote = (name) => name.replace(/^(\S.*?)\s*\([^()]*\)\s*$/, '$1').trim();
const labelCase = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
// Seules associations dosées en mg d'association : somme des deux substances (voir tools/build-medvet-index.py).
const ASSOCIATIONS = new Map([['acide clavulanique + amoxicilline', 'Amoxicilline + acide clavulanique']]);

// Clé d'une substance : sans précision entre parenthèses, casse ni accents ; les associations sont triées.
export const substanceKey = (label) => label.split('+').map((part) => fold(stripNote(part)).trim()).sort().join(' + ');

export const routeOf = (product) => product.r ?? 'oral';

// { key, label, route } d'un produit. Oral et injectable : il faut un dosage ou une concentration pour une
// posologie en mg/kg, une seule substance (ou l'association amoxicilline + acide clavulanique). Spot-on : choisi
// selon le poids, donc toutes les substances comptent, associées ou non, sans dosage.
export function substanceOf(product) {
  const route = routeOf(product);
  const names = product.a.map((a) => stripNote(a[0]));
  if (names.some((n) => !n)) return null;
  if (route === 'spot') {
    // « S-Methoprene » et « Méthoprène » sont la même substance ; une substance répétée (plusieurs dosages) compte une fois
    const seen = new Map();
    for (const n of names.map((x) => x.replace(/^\(?[RS]\)?[-\s]+/i, ''))) if (!seen.has(fold(n))) seen.set(fold(n), n);
    const sorted = [...seen.values()].sort((a, b) => fold(a).localeCompare(fold(b)));
    return { key: substanceKey(sorted.join('+')), label: sorted.map((n, i) => (i ? n.toLowerCase() : labelCase(n))).join(' + '), route };
  }
  if ((product.m ?? product.c) == null) return null;
  if (names.length === 1) return { key: substanceKey(names[0]), label: labelCase(names[0]), route };
  const key = substanceKey(names.join('+'));
  return ASSOCIATIONS.has(key) ? { key, label: ASSOCIATIONS.get(key), route } : null;
}

// products -> Map(voie -> Map(clé -> { label, products[] })), calculé une fois par index
const substanceCache = new WeakMap();
export function substanceIndex(products, route = 'oral') {
  let byRoute = substanceCache.get(products);
  if (!byRoute) {
    byRoute = new Map(ROUTES.map((r) => [r, new Map()]));
    for (const product of products) {
      const sub = substanceOf(product);
      if (!sub) continue;
      const map = byRoute.get(sub.route);
      if (!map.has(sub.key)) map.set(sub.key, { label: sub.label, products: [] });
      const entry = map.get(sub.key);
      if (!/[À-ÿ]/.test(entry.label) && /[À-ÿ]/.test(sub.label)) entry.label = sub.label; // libellé accentué de préférence
      entry.products.push(product);
    }
    substanceCache.set(products, byRoute);
  }
  return byRoute.get(route) ?? new Map();
}

// Substances proposables pour une voie, par ordre alphabétique : { label, articles }
export function listSubstances(products, route = 'oral') {
  return [...substanceIndex(products, route).values()]
    .map((s) => ({ label: s.label, articles: s.products.reduce((n, p) => n + p.k.filter((k) => k[0]).length, 0) }))
    .sort((a, b) => fold(a.label).localeCompare(fold(b.label)));
}

export function brandsOf(products, label, route = 'oral') {
  const entry = substanceIndex(products, route).get(substanceKey(label));
  return entry ? [...new Set(entry.products.map((p) => p.b))].sort((a, b) => fold(a).localeCompare(fold(b))) : [];
}

const mlText = (v) => `${String(v).replace('.', ',')} mL`;
const pluralize = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

export function formatPackText(format) {
  if (isBand(format)) {
    const vol = format.volume ? ` de ${mlText(format.volume)}` : '';
    const n = format.boxes?.map((b) => b.blisters) ?? (format.perBox ? [format.perBox] : []);
    if (n.length > 1) return `pipettes${vol} (boîtes de ${n.slice(0, -1).join(', ')} ou ${n.at(-1)} pipettes)`;
    return n.length ? `${pluralize(n[0], 'pipette')}${vol}` : 'conditionnement inconnu';
  }
  if (isLiquid(format)) {
    const ml = mlText(format.volume ?? '?');
    const word = format.container ?? 'flacon';
    if (format.boxes?.length > 1) {
      const list = format.boxes.map((b) => b.blisters);
      return `${word}s de ${ml} (boîtes de ${list.slice(0, -1).join(', ')} ou ${list.at(-1)} ${word}s)`;
    }
    return format.bottles > 1 ? `${format.bottles} ${word}s de ${ml}` : `${word} de ${ml}`;
  }
  if (!format.perBlister) return 'conditionnement inconnu';
  const what = format.unit === 'gél.' ? 'gélule' : 'comprimé';
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  if (format.boxes?.length > 1) {
    // plusieurs tailles de boîte du même produit : la plaquette remise est la même
    const list = format.boxes.map((b) => (b.blisters === 1 ? 'une seule' : b.blisters));
    return `plaquettes de ${format.perBlister} (boîtes de ${list.slice(0, -1).join(', ')} ou ${list.at(-1)} plaquettes)`;
  }
  return format.blisters > 1 ? `${plural(format.blisters, 'plaquette')} de ${format.perBlister}` : plural(format.perBlister, what);
}

// Tous les articles (produit + conditionnement lisible) de la substance, prêts pour plan() ou planBand().
// route : 'oral' (défaut), 'inj' ou 'spot' ; species : 'CN' | 'CT' | undefined ; brand : restreint à une marque ;
// dispense : en 'blister' ou 'unit' la taille de la boîte ne change rien (on remet des plaquettes ou des
// comprimés), donc les boîtes d'un même produit sont regroupées ; en 'box' chacune compte. Les spot-on sont
// toujours regroupés par produit : les tailles de boîte sont dans `boxes`, planBand choisit la meilleure.
export function marketFormats(products, label, { route = 'oral', species, brand, dispense = 'blister' } = {}) {
  const entry = substanceIndex(products, route).get(substanceKey(label));
  if (!entry) return [];
  const out = new Map();
  for (const product of entry.products) {
    if (species && !product.s.split(',').includes(species)) continue;
    if (brand && product.b !== brand) continue;
    for (const pack of product.k) {
      if (!pack[0]) continue; // conditionnement illisible : on ne sait pas calculer le reste
      const box = { blisters: pack[0], gtin: pack[3] || undefined };
      const spot = route === 'spot';
      const key = spot ? product.d : dispense === 'box' ? `${product.d}|${pack[0]}|${pack[1]}` : `${product.d}|${pack[1]}`;
      const known = out.get(key);
      if (known) {
        if (!known.boxes.some((b) => b.blisters === pack[0])) known.boxes = [...known.boxes, box].sort((a, b) => a.blisters - b.blisters);
        // la plus petite boîte sert au calcul
        if (isBand(known)) { if (pack[0] < known.perBox) known.perBox = pack[0]; } else if (isLiquid(known)) { if (pack[0] < known.bottles) known.bottles = pack[0]; } else if (pack[0] < known.blisters) known.blisters = pack[0];
        continue;
      }
      out.set(key, {
        ...formatFromProduct(product, pack),
        brand: product.b,
        form: product.f,
        species: product.s,
        assoc: !spot && product.a.length > 1,
        boxes: [box],
        link: product.l ? (product.l.startsWith('https://') ? product.l : LINK_PREFIX + product.l) : undefined,
      });
    }
  }
  return [...out.values()];
}

// Nom d'un article : « Marque dosage mg ». Pour une association, le dosage est celui écrit dans la
// dénomination (« Synulox 250 mg », « Clavusan 250 mg + 62,5 mg ») : les marques n'ont pas toutes la même habitude.
const ASSOCIATION_DOSE = /\d[\d.,]*(?:\s*(?:mg)?\s*[/+]\s*\d[\d.,]*)*\s*mg/i;
export function productName(product) {
  if (product.u === 'pip' || product.a.length > 1) {
    const dose = product.d.match(ASSOCIATION_DOSE)?.[0];
    return dose ? `${product.b} ${dose.replace(/\s*mg/gi, ' mg').replace(/\s+/g, ' ')}` : product.d;
  }
  if (product.u === 'mL') return product.c != null ? `${product.b} ${mgText(product.c)} mg/mL` : product.d;
  return product.m != null ? `${product.b} ${mgText(product.m)} mg` : product.d;
}

// Libellé lisible d'un conditionnement du produit : [plaquettes, comprimés par plaquette, texte d'origine]
export function packText(pack, unit = 'cp', container = 'flacon') {
  const [blisters, per, text] = pack;
  if (!blisters) return text || 'Conditionnement à saisir';
  if (unit === 'mL') return `${blisters > 1 ? `${blisters} ${container}s de` : `${container} de`} ${mlText(per)}`;
  if (unit === 'pip') return `${pluralize(blisters, 'pipette')}${per ? ` de ${mlText(per)}` : ''}`;
  const what = unit === 'gél.' ? 'gélule' : 'comprimé';
  const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
  return blisters === 1 ? `${plural(per, what)}` : `${plural(blisters, 'plaquette')} de ${per}`;
}

export function formatFromProduct(product, pack) {
  if (product.u === 'pip') {
    const [lo, hi, excl] = product.w ?? [];
    return normalizeFormat({
      name: productName(product),
      unit: 'pip',
      band: product.w ? { lo, hi, excl: Boolean(excl) } : undefined,
      perBox: pack[0],
      volume: pack[1] || undefined,
      gtin: pack[3] || undefined,
    });
  }
  if (product.u === 'mL') {
    return normalizeFormat({
      name: productName(product),
      unit: 'mL',
      conc: product.c,
      volume: pack[1],
      bottles: pack[0] ?? 1,
      container: product.ct,
      route: product.r === 'inj' ? 'inj' : undefined,
      gtin: pack[3] || undefined,
    });
  }
  return normalizeFormat({
    name: productName(product),
    mg: product.m,
    perBlister: pack[1],
    blisters: pack[0] ?? 1,
    split: ['none', 'half', 'quarter'][product.x] ?? 'none',
    unit: product.u,
    gtin: pack[3] || undefined,
  });
}

// Posologie que Med'Vet propose à l'avance pour ce produit (champ « o » de l'index : dose, rythme, sans ambiguïté
// dans la fiche), ou undefined. Pour une espèce précise, c'est celle de cette espèce ; sans espèce, il faut que
// toutes les espèces du produit donnent exactement la même posologie. `species` du résultat : l'espèce à
// retenir pour le médicament (absente quand la posologie vaut pour les deux).
export function suggestedPosology(product, species) {
  const o = product.o;
  if (!o) return undefined;
  const codes = product.s.split(',');
  let pick;
  let only;
  if (species) {
    if (!codes.includes(species)) return undefined;
    pick = o[species];
    only = codes.length > 1 ? species : undefined;
  } else {
    const all = codes.map((c) => o[c]);
    if (all.some((x) => !x) || all.some((x) => JSON.stringify(x) !== JSON.stringify(all[0]))) return undefined;
    pick = all[0];
    only = codes.length === 1 ? codes[0] : undefined;
  }
  if (!Array.isArray(pick)) return undefined;
  const [min, max, perDay, basis] = pick;
  if (!isNum(min) || min <= 0 || !Number.isInteger(perDay) || perDay < 1 || perDay > 4) return undefined;
  if (max != null && !(isNum(max) && max > min)) return undefined;
  return { min, max: max ?? undefined, perDay, basis: basis === 'day' ? 'day' : 'intake', species: only };
}

export function drugFromProduct(product, pack, species) {
  const substance = substanceOf(product);
  const suggestion = routeOf(product) === 'spot' ? undefined : suggestedPosology(product, species);
  return normalizeDrug({
    name: substance ? substance.label : product.b,
    substance: substance?.label,
    route: routeOf(product),
    link: product.l ? (product.l.startsWith('https://') ? product.l : LINK_PREFIX + product.l) : undefined,
    formats: routeOf(product) === 'spot' ? [] : [formatFromProduct(product, pack)],
    ...(suggestion ? { ...suggestion, suggested: true } : {}),
  });
}

// --- texte de la rubrique « Posologie » du RCP (medvet-poso.json) -----------------------------

// Clé d'une fiche dans medvet-poso.json : la fin de l'adresse Med'Vet.
export const posoKey = (link) => (typeof link === 'string' && link.startsWith(LINK_PREFIX) ? link.slice(LINK_PREFIX.length) : link);

// Textes à montrer pour une fiche : [{ species: 'CN' | 'CT' | null, text }]. Une seule entrée sans espèce quand le
// chien et le chat ont le même texte ; `species` précise l'espèce du patient (sinon les deux textes, étiquetés).
export function rcpTexts(entry, species) {
  if (!Array.isArray(entry)) return [];
  const dog = typeof entry[0] === 'string' ? entry[0] : null;
  const cat = entry[1] === 0 ? dog : typeof entry[1] === 'string' ? entry[1] : null;
  if (species === 'CN') return dog ? [{ species: 'CN', text: dog }] : [];
  if (species === 'CT') return cat ? [{ species: 'CT', text: cat }] : [];
  if (dog && cat && dog === cat) return [{ species: null, text: dog }];
  return [dog && { species: 'CN', text: dog }, cat && { species: 'CT', text: cat }].filter(Boolean);
}
