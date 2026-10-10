import { DEFAULT_SECTIONS } from './data.js';
import { ICONS } from './section-icons.js';
import { ANIMALS } from './animals.js';
import {
  plan, tabletText, tabletSpeech, searchIndex, packText, productName, formatFromProduct, drugFromProduct,
  normalizeDrug, normalizeFormat, normalizePrefs, fold, TOLERANCES, MAX_PER_INTAKE,
  substanceOf, listSubstances, brandsOf, marketFormats, formatPackText, gtinCodes, isLiquid, isBand, routeOf, planBand, SYRINGES,
  suggestedPosology, posoKey, rcpTexts,
  posologyStatus, intakeSentence, supplyParts, supplyPhrase, orderWarnings, orderTotals, normalizeProtocol,
  normalizePrices, boxOf, withPrices, isUnhandledCombo, productLink,
} from './rx.js';

const STORE_KEY = 'injection:sections:v1';
const SPECIES_KEY = 'injection:species';
const SPECIES_LABEL = { CN: 'Chien', CT: 'Chat' };
const UNITS = ['mL', 'mL/h'];
const WEIGHT_WARN_ABOVE = 100;
const PREFS_KEY = 'injection:prefs';
const RX_KEY = 'injection:rx:v1';
const RX_PREFS_KEY = 'injection:rx-prefs:v1';
const RX_PROTOCOLS_KEY = 'injection:rx-protocols:v1';
const RX_PRICES_KEY = 'injection:rx-prices:v1';
const ROUND_STEPS = [0, 0.01, 0.05, 0.1];
const DRIP_SETS = [20, 60];
// Un arrondi qui change la dose de plus de 10 % est refusé : la valeur exacte est gardée.
const ROUND_TOLERANCE = 0.1;

const fmtDose = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const doseFormats = {};
// Volumes affichés sur 2 décimales au moins, et jusqu'à section.decimals (3 pour la sédation).
function doseFormat(section) {
  const digits = section.decimals === 3 || section.decimals === 4 ? section.decimals : 2;
  const format = (doseFormats[digits] ??= new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: digits }));
  return { format, digits };
}

// Arrondi comme dans le Sheet : sur les 15 chiffres significatifs, une demi-unité va toujours vers le haut.
// (Sans cela, 0,165 s'affichait 0,16 : en binaire il vaut un peu moins que 0,165.)
function roundHalfUp(value, digits) {
  const text = Math.abs(value).toPrecision(15);
  if (text.includes('e')) return value;
  const [whole, fraction = ''] = text.split('.');
  const padded = fraction.padEnd(digits + 1, '0');
  const n = BigInt(whole + padded.slice(0, digits)) + (Number(padded[digits]) >= 5 ? 1n : 0n);
  return (Math.sign(value) * Number(n)) / 10 ** digits;
}
const fmtDose1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMg = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const fmtDripLow = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmtDripHigh = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const fmtCoef = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const fmtWeight = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const THEME_KEY = 'injection:theme';
const THEME_COLOR = { light: '#f8f7ee', dark: '#141912' };

const main = document.getElementById('main');
const weightInput = document.getElementById('weight');
const weightClear = document.getElementById('weight-clear');
const warn = document.getElementById('warn');
const hint = document.getElementById('hint');
const roundSelect = document.getElementById('round');
const roundNote = document.getElementById('round-note');
const prefsNow = document.getElementById('prefs-now');
const petInput = document.getElementById('pet-name');
const notesInput = document.getElementById('pet-notes');
const printBtn = document.getElementById('print');
const printNote = document.getElementById('print-note');
const printList = document.getElementById('print-sections');
const dock = document.getElementById('dock');
const chrome = document.getElementById('chrome');
const brandRow = document.querySelector('.top');
const editToggle = document.getElementById('edit-toggle');
const themeToggle = document.getElementById('theme-toggle');

// --- stockage (le poids n'est volontairement jamais mémorisé) ---------------

function storeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function storeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}
function storeDelete(key) {
  try { localStorage.removeItem(key); } catch { /* stockage indisponible */ }
}

// Restes de la version publiée brièvement avec un second modèle : on les supprime.
storeDelete('injection:model');
storeDelete('injection:sections:ambu:v1');

// Données enregistrées avant l'arrivée des icônes et de la précision d'affichage : on rend leurs
// valeurs d'origine aux sections d'origine. Un réglage volontairement changé est enregistré,
// donc jamais écrasé (icône retirée = chaîne vide).
function withDefaults(sections) {
  for (const section of sections) {
    const original = DEFAULT_SECTIONS.find((d) => d.title === section.title);
    if (!original) continue;
    if (!('icon' in section) && original.icon) section.icon = original.icon;
    if (!('decimals' in section) && original.decimals) section.decimals = original.decimals;
  }
  return sections;
}

function loadSections() {
  const raw = storeGet(STORE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => s && Array.isArray(s.items))) return withDefaults(parsed);
    } catch { /* données corrompues : on repart des valeurs d'origine */ }
  }
  return structuredClone(DEFAULT_SECTIONS);
}

function loadSpecies() {
  const saved = storeGet(SPECIES_KEY);
  return saved === 'CN' || saved === 'CT' ? saved : 'all';
}

// Réglages de l'appareil : arrondi à la seringue (mL) et type de set de perfusion (gouttes/mL).
function loadPrefs() {
  const prefs = { round: 0, set: 20, printOff: [], printNotes: true };
  try {
    const saved = JSON.parse(storeGet(PREFS_KEY) || '{}');
    if (ROUND_STEPS.includes(saved.round)) prefs.round = saved.round;
    if (DRIP_SETS.includes(saved.set)) prefs.set = saved.set;
    // Une version publiée brièvement rangeait ce réglage par modèle : on reprend celui d'Hospit.
    const off = Array.isArray(saved.printOff) ? saved.printOff : saved.printOff?.hospit;
    if (Array.isArray(off)) prefs.printOff = off.filter((t) => typeof t === 'string');
    if (typeof saved.printNotes === 'boolean') prefs.printNotes = saved.printNotes;
  } catch { /* réglages corrompus : valeurs par défaut */ }
  return prefs;
}

// Ordonnance : la bibliothèque des médicaments remis par la clinique, enregistrée sur l'appareil.
function loadRx() {
  try {
    const parsed = JSON.parse(storeGet(RX_KEY) || '[]');
    if (Array.isArray(parsed)) {
      const raws = parsed.filter((d) => d && typeof d === 'object');
      const drugs = raws.map(normalizeDrug);
      // un médicament enregistré avant les protocoles n'a pas d'identifiant : on lui en fixe un une fois pour toutes
      if (raws.some((d) => typeof d.id !== 'string' || !d.id)) storeSet(RX_KEY, JSON.stringify(drugs));
      return drugs;
    }
  } catch { /* données corrompues : bibliothèque vide */ }
  return [];
}

// Protocoles : des ordonnances types (plusieurs médicaments et leur durée), écrites par la clinique.
function loadRxProtocols() {
  try {
    const parsed = JSON.parse(storeGet(RX_PROTOCOLS_KEY) || '[]');
    if (Array.isArray(parsed)) return parsed.filter((p) => p && typeof p === 'object').map(normalizeProtocol).filter((p) => p.name);
  } catch { /* protocoles corrompus : aucun */ }
  return [];
}

// Prix des boîtes saisis par la clinique, par GTIN (Med'Vet ne donne pas de prix).
function loadRxPrices() {
  try {
    return normalizePrices(JSON.parse(storeGet(RX_PRICES_KEY) || '{}'));
  } catch { /* prix corrompus : aucun */ }
  return {};
}

function loadRxPrefs() {
  try {
    return normalizePrefs(JSON.parse(storeGet(RX_PREFS_KEY) || '{}'));
  } catch { /* réglages corrompus : valeurs par défaut */ }
  return normalizePrefs();
}

const state = {
  view: 'doses', // 'doses' ou 'rx' ; on rouvre toujours sur les doses
  rx: {
    drugs: loadRx(), // la bibliothèque : tous les médicaments de la clinique
    prefs: loadRxPrefs(),
    protocols: loadRxProtocols(),
    prices: loadRxPrices(),
    days: null, // durée par défaut du traitement : propre au patient en cours, jamais mémorisée
    order: [], // l'ordonnance du patient en cours : { drug, days } (days vide = durée par défaut), jamais mémorisée
  },
  sections: loadSections(),
  species: loadSpecies(),
  prefs: loadPrefs(),
  weight: null,
  petName: '', // comme le poids, jamais mémorisé : propre au patient en cours
  petNotes: '', // idem : texte libre imprimé dans le cadre de notes de la fiche
  editing: false,
  done: new Set(), // médicaments cochés "prélevés" ; vidé à chaque nouveau poids
  openEdit: new Set(), // sections dépliées dans l'éditeur
};

const save = () => storeSet(STORE_KEY, JSON.stringify(state.sections));
const saveRx = () => storeSet(RX_KEY, JSON.stringify(state.rx.drugs));
const saveRxPrefs = () => storeSet(RX_PREFS_KEY, JSON.stringify(state.rx.prefs));
const saveRxProtocols = () => storeSet(RX_PROTOCOLS_KEY, JSON.stringify(state.rx.protocols));
const saveRxPrices = () => storeSet(RX_PRICES_KEY, JSON.stringify(state.rx.prices));
const savePrefs = () => storeSet(PREFS_KEY, JSON.stringify(state.prefs));

// --- utilitaires ------------------------------------------------------------

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// Accepte "25,9" ou "25.9". Renvoie null si vide ou invalide.
function parseNum(text) {
  const t = String(text).trim().replace(',', '.');
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// Pictogramme d'une section, ou null si la section n'en a pas. Le contenu vient de section-icons.js.
function iconNode(name) {
  const icon = ICONS[name];
  if (!icon) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = icon.markup;
  return svg;
}

const coefUnit = (unit) => (unit === 'mL/h' ? 'mL/kg/h' : 'mL/kg');

const joinRange = (values, format, digits) => values.map((v) => format.format(digits == null ? v : roundHalfUp(v, digits))).join(' – ');

// Arrondit un volume à la graduation de la seringue, sauf si l'écart dépasse la tolérance.
function roundDose(value, step) {
  // toPrecision(12) : enlève le bruit de calcul (2,4999999999999996 doit valoir 2,5)
  const rounded = Number((Math.round(Number((value / step).toPrecision(12))) * step).toFixed(3));
  if (rounded <= 0 || Math.abs(rounded - value) / value > ROUND_TOLERANCE) return { value, skipped: true };
  return { value: rounded, skipped: false };
}

// Tout ce qu'il faut afficher pour une ligne, ou null tant que le poids ou la dose manque.
// "shown" est le volume à prélever (arrondi si demandé) ; mg et gouttes en découlent.
function compute(item, section) {
  if (!state.weight || !isNum(item.min)) return null;
  const exact = [item.min, ...(isNum(item.max) ? [item.max] : [])].map((c) => state.weight * c);

  let shown = exact;
  let status = 'exact';
  const step = section.unit === 'mL' ? state.prefs.round : 0;
  if (step) {
    const results = exact.map((v) => roundDose(v, step));
    shown = results.map((r) => r.value);
    if (results.some((r) => r.skipped)) status = 'skipped';
    else if (shown.some((v, i) => Math.abs(v - exact[i]) > 1e-9)) status = 'rounded';
  }

  // arrondi demandé : on affiche à la graduation choisie ; sinon (ou si l'arrondi est refusé) la valeur exacte
  const exactFmt = doseFormat(section);
  const shownFmt = step && status !== 'skipped'
    ? { format: step === 0.1 ? fmtDose1 : fmtDose, digits: step === 0.1 ? 1 : 2 }
    : exactFmt;
  const dose = joinRange(shown, shownFmt.format, shownFmt.digits);
  const exactText = joinRange(exact, exactFmt.format, exactFmt.digits);
  // Rien à signaler si le chiffre affiché est identique au chiffre calculé.
  if (status === 'rounded' && dose === exactText) status = 'exact';
  const hasConc = isNum(item.conc) && item.conc > 0;
  return {
    dose,
    exact: exactText,
    status,
    mg: hasConc && section.unit === 'mL' ? joinRange(shown.map((v) => v * item.conc), fmtMg) : null,
    drip: section.unit === 'mL/h'
      ? shown.map((v) => { const d = (v * state.prefs.set) / 60; return (d < 10 ? fmtDripLow : fmtDripHigh).format(d); }).join(' – ')
      : null,
  };
}

function coefText(item, unit) {
  if (!isNum(item.min)) return '';
  const range = isNum(item.max)
    ? `${fmtCoef.format(item.min)} – ${fmtCoef.format(item.max)}`
    : fmtCoef.format(item.min);
  return `${range} ${coefUnit(unit)}`;
}

const matchesSpecies = (item) =>
  state.species === 'all' || !item.species || item.species === state.species;

// --- affichage des doses ----------------------------------------------------

function renderView() {
  const cards = [];
  const shown = [];
  for (const section of state.sections) {
    const items = section.items.filter(matchesSpecies);
    if (!items.length) continue;
    shown.push(section);
    cards.push(
      el('section', { class: isPrinted(section) ? 'card' : 'card print-off' },
        el('h2', {},
          el('span', { class: 'st' },
            iconNode(section.icon) && el('span', { class: 'si' }, iconNode(section.icon)),
            el('span', {}, section.title),
          ),
          el('span', { class: 'unit' }, section.unit),
        ),
        section.unit === 'mL/h' && dripPicker(),
        el('div', { class: 'rows' }, rowsFor(items, section)),
      ),
    );
  }
  main.replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, 'Aucun médicament à afficher.')]));
  buildDock(cards, shown);
}

// --- barre de sections (téléphone) : saut direct + section courante en surbrillance ----------

let dockCards = [];
let dockCurrent = -1;
let dockLock = -1; // section touchée : reste active même si la page ne peut pas défiler assez loin
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function buildDock(cards, sections) {
  dockCards = cards;
  dockCurrent = -1;
  dockLock = -1;
  dock.replaceChildren(...cards.map((card, i) => el('button', {
    type: 'button',
    onclick: () => {
      dockLock = i;
      markDock(i);
      card.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    },
  },
  iconNode(sections[i].icon) && el('span', { class: 'di' }, iconNode(sections[i].icon)),
  el('span', { class: 'dl' }, sections[i].title || 'Sans titre'))));
  dock.hidden = cards.length < 2;
  updateDock();
}

function markDock(current) {
  if (current === dockCurrent) return;
  dockCurrent = current;
  [...dock.children].forEach((button, i) => {
    if (i === current) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  const active = dock.children[current];
  dock.scrollTo({ left: active.offsetLeft - (dock.clientWidth - active.offsetWidth) / 2 });
}

function updateDock() {
  if (dock.hidden || !dockCards.length) return;
  if (dockLock >= 0) return markDock(dockLock);
  // la section courante est la dernière dont le haut a passé le bas de la barre collante
  const line = chrome.getBoundingClientRect().bottom + 24;
  let current = 0;
  dockCards.forEach((card, i) => { if (card.getBoundingClientRect().top <= line) current = i; });
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = dockCards.length - 1;
  markDock(current);
}

// dès que l'utilisatrice reprend la main sur le défilement, la détection automatique reprend
for (const type of ['wheel', 'touchstart', 'keydown']) {
  window.addEventListener(type, () => { dockLock = -1; }, { passive: true });
}

let dockFrame = 0;
window.addEventListener('scroll', () => {
  if (!dockFrame) dockFrame = requestAnimationFrame(() => { dockFrame = 0; updateDock(); });
}, { passive: true });

// Hauteur de la partie qui reste collée : sert au décalage des sauts de section.
new ResizeObserver(() => {
  const sticky = chrome.offsetHeight - brandRow.offsetHeight;
  document.documentElement.style.setProperty('--stick-h', `${sticky}px`);
}).observe(chrome);

// Type de set de perfusion : sert à convertir les mL/h en gouttes par minute.
function dripPicker() {
  const picker = el('select', { id: 'set', class: 'pick' },
    DRIP_SETS.map((n) => el('option', { value: n, selected: n === state.prefs.set }, `${n} gouttes/mL`)));
  picker.addEventListener('change', () => {
    state.prefs.set = Number(picker.value);
    savePrefs();
    renderView();
    document.getElementById('set')?.focus();
  });
  return el('div', { class: 'set' }, el('label', { for: 'set' }, 'Set de perfusion'), picker);
}

function rowsFor(items, section) {
  const out = [];
  let lastGroup = '';
  for (const item of items) {
    const group = item.group || '';
    if (group !== lastGroup) {
      out.push(group ? el('h3', { class: 'group' }, group) : el('hr', { class: 'group-sep' }));
      lastGroup = group;
    }
    out.push(row(item, section));
  }
  return out;
}

// Une ligne : [coche] nom ..... dose, puis voie / note et calculs (mg, gouttes, coefficient) en dessous.
function row(item, section) {
  const calc = compute(item, section);
  const chip = SPECIES_LABEL[item.species];
  const coef = coefText(item, section.unit);
  const done = state.done.has(item);
  const doseClass = ['dose', !calc && 'dose-empty', isNum(item.max) && 'dose-range'].filter(Boolean).join(' ');
  const label = `${item.name || 'Sans nom'}${chip ? ` (${chip})` : ''}`;

  const tick = el('input', { type: 'checkbox', checked: done, disabled: !calc, 'aria-label': `Prélevé : ${label}` });
  const rowEl = el('div', { class: done ? 'row is-done' : 'row' },
    el('label', { class: 'tick' }, tick, el('span', { class: 'box', 'aria-hidden': 'true' })),
    el('div', { class: 'name' },
      item.name || 'Sans nom',
      chip && el('span', { class: `chip chip-${item.species}` }, chip),
    ),
    el('span', { class: 'leader', 'aria-hidden': 'true' }),
    el('div', { class: doseClass },
      calc ? calc.dose : '–',
      calc && el('span', { class: 'dose-unit' }, section.unit),
    ),
    (item.route || item.note || calc?.mg || calc?.drip || coef) && el('div', { class: 'sub' },
      item.route && el('span', { class: 'route' }, item.route),
      item.note && el('span', { class: 'note' }, item.note),
      el('span', { class: 'calc' },
        calc?.status === 'rounded' && el('span', { class: 'rnote' }, `calculé ${calc.exact}`),
        calc?.status === 'skipped' && el('span', { class: 'rnote rnote-warn' }, 'non arrondi : écart > 10 %'),
        calc?.mg && el('span', { class: 'extra' }, `${calc.mg} mg`),
        calc?.drip && el('span', { class: 'extra' }, `${calc.drip} gouttes/min`),
        coef && el('span', { class: 'coef' }, coef),
      ),
    ),
  );
  tick.addEventListener('change', () => {
    if (tick.checked) state.done.add(item);
    else state.done.delete(item);
    rowEl.classList.toggle('is-done', tick.checked);
  });
  return rowEl;
}

// --- édition des doses ------------------------------------------------------

const field = (label, control, cls = '') =>
  el('label', { class: `field ${cls}` }, el('span', { class: 'field-label' }, label), control);

const button = (label, onclick, cls = 'btn-ghost') => el('button', { type: 'button', class: `btn ${cls}`, onclick }, label);

function textInput(value, onChange, commit = save) {
  const input = el('input', { type: 'text', autocomplete: 'off', value: value ?? '' });
  input.addEventListener('input', () => { onChange(input.value.trim()); commit(); });
  return input;
}

function numInput(value, onChange, required = false, commit = save) {
  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: isNum(value) ? String(value).replace('.', ',') : '',
  });
  const flag = () => {
    const empty = input.value.trim() === '';
    input.setAttribute('aria-invalid', String(empty ? required : parseNum(input.value) === null));
  };
  input.addEventListener('input', () => { flag(); onChange(parseNum(input.value)); commit(); });
  flag();
  return input;
}

function select(options, current, onChange, commit = save) {
  const node = el('select', {},
    options.map(([value, label]) => el('option', { value, selected: value === current }, label)));
  node.addEventListener('change', () => { onChange(node.value); commit(); });
  return node;
}

function renderEdit() {
  main.replaceChildren(
    ...state.sections.map(editCard),
    el('div', { class: 'edit-actions' },
      button('Ajouter une section', addSection),
      button('Rétablir les doses d’origine', resetAll, 'btn-danger'),
      button('Terminé', () => setEditing(false), 'btn-primary'),
    ),
  );
}

function editCard(section) {
  const title = el('span', { class: 'es-title' }, section.title || 'Sans titre');
  const badge = el('span', { class: 'si' }, iconNode(section.icon));
  const n = section.items.length;
  const iconChoices = [['', 'Aucune'], ...Object.entries(ICONS).map(([key, icon]) => [key, icon.label])];
  const card = el('details', { class: 'card-edit', open: state.openEdit.has(section) },
    el('summary', {},
      badge,
      title,
      el('span', { class: 'es-count' }, `${n} médicament${n > 1 ? 's' : ''} · ${section.unit}`),
    ),
    el('div', { class: 'edit-head' },
      field('Section', textInput(section.title, (v) => { section.title = v; title.textContent = v || 'Sans titre'; }), 'grow'),
      field('Unité', select(UNITS.map((u) => [u, u]), section.unit, (v) => { section.unit = v; save(); render(); })),
      field('Icône', select(iconChoices, section.icon || '', (v) => { section.icon = v; badge.replaceChildren(...[iconNode(v)].filter(Boolean)); })),
      field('Précision', select(
        [['2', '2 décimales'], ['3', 'Jusqu’à 3 décimales']],
        String(section.decimals === 3 ? 3 : 2),
        (v) => { section.decimals = Number(v); },
      )),
    ),
    section.items.map((item) => editRow(section, item)),
    el('div', { class: 'edit-foot' },
      button('Ajouter un médicament', () => addItem(section)),
      button('Supprimer la section', () => removeSection(section), 'btn-danger'),
    ),
  );
  card.addEventListener('toggle', () => {
    if (card.open) state.openEdit.add(section);
    else state.openEdit.delete(section);
  });
  return card;
}

function editRow(section, item) {
  const conc = isNum(item.conc) && item.conc > 0 ? `${fmtCoef.format(item.conc)} mg/mL` : '';
  const recap = [item.route, SPECIES_LABEL[item.species], conc, item.group].filter(Boolean).join(' · ');
  return el('div', { class: 'erow' },
    field('Nom', textInput(item.name, (v) => { item.name = v; }), 'c-name'),
    field(`Dose (${coefUnit(section.unit)})`, numInput(item.min, (v) => { item.min = v; }, true)),
    field('Dose max', numInput(item.max, (v) => { item.max = v ?? undefined; })),
    el('details', { class: 'c-more' },
      el('summary', {}, 'Voie, espèce, concentration, groupe, note', recap && el('span', { class: 'recap' }, recap)),
      el('div', { class: 'more-grid' },
        field('Voie', textInput(item.route, (v) => { item.route = v; })),
        field('Espèce', select(
          [['', 'Chien et chat'], ['CN', 'Chien'], ['CT', 'Chat']],
          item.species || '',
          (v) => { item.species = v || undefined; },
        )),
        field('Concentration (mg/mL)', numInput(item.conc, (v) => { item.conc = v ?? undefined; })),
        field('Groupe', textInput(item.group, (v) => { item.group = v; })),
        field('Note', textInput(item.note, (v) => { item.note = v; }), 'wide'),
        button('Supprimer ce médicament', () => removeItem(section, item), 'btn-danger btn-small wide'),
      ),
    ),
  );
}

function addItem(section) {
  section.items.push({ name: '', min: null });
  state.openEdit.add(section);
  save();
  render();
  const rows = main.children[state.sections.indexOf(section)].querySelectorAll('.erow');
  rows[rows.length - 1].querySelector('input').focus();
}

function removeItem(section, item) {
  if (!confirm(`Supprimer « ${item.name || 'Sans nom'} » ?`)) return;
  section.items.splice(section.items.indexOf(item), 1);
  save();
  render();
}

function addSection() {
  const section = { title: 'Nouvelle section', unit: 'mL', items: [{ name: '', min: null }] };
  state.sections.push(section);
  state.openEdit.add(section);
  save();
  render();
  const card = main.children[state.sections.length - 1];
  card.scrollIntoView({ block: 'center' });
  card.querySelector('.edit-head input').select();
}

function removeSection(section) {
  if (!confirm(`Supprimer la section « ${section.title} » et tous ses médicaments ?`)) return;
  state.sections.splice(state.sections.indexOf(section), 1);
  save();
  render();
}

function resetAll() {
  if (!confirm('Rétablir toutes les doses d’origine ? Les modifications faites dans l’appli seront perdues.')) return;
  state.sections = structuredClone(DEFAULT_SECTIONS);
  state.openEdit.clear();
  storeDelete(STORE_KEY);
  render();
}

function setEditing(on) {
  state.editing = on;
  document.body.classList.toggle('editing', on);
  editToggle.textContent = on ? 'Terminé' : 'Modifier';
  render();
  window.scrollTo({ top: 0 });
}

// --- easter egg : le coeur du pied de page ------------------------------------------

const heart = document.getElementById('heart');
const egg = document.getElementById('egg');
const eggImg = document.getElementById('egg-img');
const eggEmoji = document.getElementById('egg-emoji');
const eggLive = document.getElementById('egg-live');
let lastAnimal = -1;

// Tirage au hasard sans jamais répéter le précédent.
function pickNew(count, last) {
  let i;
  do i = Math.floor(Math.random() * count);
  while (count > 1 && i === last);
  return i;
}

function hideEgg() {
  egg.hidden = true;
  eggImg.removeAttribute('src'); // arrête l'animation ; la suivante repartira de zéro
  eggLive.textContent = '';
  heart.setAttribute('aria-expanded', 'false');
}

// Un appui sur le coeur ouvre la surprise, un second appui la referme.
heart.addEventListener('click', () => {
  if (!egg.hidden) {
    hideEgg();
    return;
  }
  lastAnimal = pickNew(ANIMALS.length, lastAnimal);
  const animal = ANIMALS[lastAnimal];

  if (reduceMotion.matches) {
    // mouvement réduit : un émoji fixe à la place de l'animation
    eggImg.hidden = true;
    eggEmoji.hidden = false;
    eggEmoji.textContent = animal.emoji;
  } else {
    eggEmoji.hidden = true;
    eggImg.hidden = false;
    eggImg.alt = animal.label;
    eggImg.src = `animals/${animal.file}`;
  }
  eggLive.textContent = `Surprise : ${animal.label}`; // annoncé aux lecteurs d'écran, rien d'affiché

  egg.hidden = false;
  heart.setAttribute('aria-expanded', 'true');
  egg.classList.remove('pop');
  void egg.offsetWidth; // relance l'animation d'apparition
  egg.classList.add('pop');
  egg.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
});

// --- poids et filtre espèce -------------------------------------------------

function updateWeight() {
  const text = weightInput.value;
  const weight = parseNum(text);
  const previous = state.weight;
  state.weight = weight > 0 ? weight : null;
  if (state.weight !== previous) state.done.clear();

  const invalid = text.trim() !== '' && !state.weight;
  weightInput.setAttribute('aria-invalid', String(invalid));
  weightClear.hidden = text === '';
  hint.hidden = text !== '';

  // un poids vidé = patient suivant : le nom du précédent ne doit jamais se retrouver sur sa fiche
  if (text === '' && (state.petName || state.petNotes)) {
    state.petName = '';
    state.petNotes = '';
    petInput.value = '';
    notesInput.value = '';
    if (rxNameInput) rxNameInput.value = '';
  }
  printBtn.disabled = !state.weight;
  printNote.textContent = state.weight
    ? 'Dans la fenêtre d\u2019impression, « Enregistrer au format PDF » permet de la garder.'
    : 'Saisissez d\u2019abord le poids.';

  let message = '';
  if (invalid) message = 'Poids invalide.';
  else if (state.weight > WEIGHT_WARN_ABOVE) message = `Poids élevé (${fmtWeight.format(state.weight)} kg) : vérifier la saisie.`;
  warn.textContent = message;
  warn.hidden = !message;

  // un poids vidé = patient suivant : la durée et l'ordonnance du précédent ne doivent pas rester
  if (text === '') {
    state.rx.days = null;
    state.rx.order = [];
    rxCards.clear();
    syncRxDays?.();
  }

  renderCurrent();
}

weightInput.addEventListener('input', updateWeight);
weightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') weightInput.blur(); });

// Efface le poids du patient précédent et remet le curseur dans le champ.
weightClear.addEventListener('click', () => {
  weightInput.value = '';
  updateWeight();
  weightInput.focus();
});
// Toute la boîte "Poids" est cliquable, pas seulement la zone de saisie.
document.querySelector('.weight').addEventListener('click', (e) => {
  if (!weightClear.contains(e.target)) weightInput.focus();
});

// --- fiche d'hospitalisation (impression) ------------------------------------------

const isPrinted = (section) => !state.prefs.printOff.includes(section.title);

const sheetNotes = document.getElementById('sheet-notes');
const syncNotes = () => {
  sheetNotes.classList.toggle('print-off', !state.prefs.printNotes);
  // sans cadre de notes sur la fiche, saisir une note serait trompeur : le champ est grisé
  notesInput.disabled = !state.prefs.printNotes;
};

// Une case par section : décochée = absente de la fiche imprimée (choix mémorisé).
// La dernière case règle la zone de notes à remplir à la main.
function buildPrintChips() {
  const chips = state.sections.map((section) => {
    const input = el('input', { type: 'checkbox', checked: isPrinted(section) });
    input.addEventListener('change', () => {
      const off = new Set(state.prefs.printOff);
      if (input.checked) off.delete(section.title);
      else off.add(section.title);
      state.prefs.printOff = [...off];
      savePrefs();
      renderView();
    });
    return el('label', { class: 'pchip' }, input, el('span', {}, section.title || 'Sans titre'));
  });

  const notes = el('input', { type: 'checkbox', checked: state.prefs.printNotes });
  notes.addEventListener('change', () => {
    state.prefs.printNotes = notes.checked;
    savePrefs();
    syncNotes();
  });
  chips.push(el('label', { class: 'pchip pchip-notes' }, notes, el('span', {}, 'Notes et lignes à remplir')));

  printList.replaceChildren(...chips);
  syncNotes();
}

const setText = (id, text) => { document.getElementById(id).textContent = text; };
const speciesText = () => ({ CN: 'Chien', CT: 'Chat' }[state.species] ?? 'Chien et chat');
const pad2 = (n) => String(n).padStart(2, '0');

// Remplit l'en-tête de la fiche. Appelé juste avant l'impression, y compris avec Ctrl+P.
function fillSheet() {
  const now = new Date();
  setText('sh-name', state.petName);
  setText('sn-text', state.petNotes);
  setText('sh-species', speciesText());
  setText('sh-weight', state.weight ? `${fmtWeight.format(state.weight)} kg` : '');
  setText('sh-date', now.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }));

  const meta = [];
  if (state.prefs.round) meta.push(`Volumes arrondis à ${fmtCoef.format(state.prefs.round)} mL`);
  if (document.querySelector('.card:not(.print-off) .set')) meta.push(`Set de perfusion : ${state.prefs.set} gouttes/mL`);
  meta.push('Doses calculées par l\u2019appli : à vérifier avant chaque administration.');
  setText('sh-meta', meta.join(' · '));

  // le titre du document devient le nom de fichier proposé pour un PDF
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const who = state.petName || 'hospitalisation';
  const kg = state.weight ? ` ${fmtWeight.format(state.weight)} kg` : '';
  document.title = `Fiche ${who}${kg} ${stamp}`;
}

const pageTitle = document.title;
// Ctrl+P compris : l'onglet Ordonnance imprime l'ordonnance, l'autre la fiche d'hospitalisation
window.addEventListener('beforeprint', () => (state.view === 'rx' ? fillRxSheet() : fillSheet()));
window.addEventListener('afterprint', () => { document.title = pageTitle; });

petInput.addEventListener('input', () => {
  state.petName = petInput.value.trim();
  if (rxNameInput) rxNameInput.value = petInput.value;
});
notesInput.addEventListener('input', () => { state.petNotes = notesInput.value.trimEnd(); });
printBtn.addEventListener('click', () => { fillSheet(); window.print(); });

// --- arrondi à la seringue ------------------------------------------------------

function syncRoundNote() {
  roundNote.hidden = !state.prefs.round;
  prefsNow.textContent = state.prefs.round
    ? `arrondi : ${fmtCoef.format(state.prefs.round)} mL`
    : 'arrondi : aucun';
}
roundSelect.value = String(state.prefs.round);
syncRoundNote();
roundSelect.addEventListener('change', () => {
  state.prefs.round = Number(roundSelect.value);
  savePrefs();
  syncRoundNote();
  if (!state.editing) renderView();
});

// --- ordonnance : quelle version remettre selon le poids et la durée du traitement ----------

const rxRoot = document.getElementById('rx');
const pageHeading = document.querySelector('h1');
const HEADINGS = { doses: pageHeading.textContent, rx: 'Ordonnance du patient' };
const DAY_CHOICES = [3, 5, 7, 10, 14, 21, 30];
const SPLIT_CHOICES = [['none', 'Pas coupé'], ['half', 'Moitiés'], ['quarter', 'Quarts']];
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const countText = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const signedPercent = (dev) => `${dev < 0 ? '−' : '+'}${Math.round(Math.abs(dev) * 100)} %`;
const formatLabel = (drug, f) => f.name || (drug.name && isNum(f.mg) ? `${drug.name} ${fmtMg.format(f.mg)} mg` : drug.name && isNum(f.conc) ? `${drug.name} ${fmtMg.format(f.conc)} mg/mL` : 'Sans nom');
const cpWord = (format) => (format.unit === 'gél.' ? 'gélule' : 'comprimé');
const fmtMl = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
// quantité de « ce qu'on donne » : 1½ cp, ou 0,8 mL
const amountText = (o) => (isLiquid(o.format) ? fmtMl.format(o.amount) : tabletText(o.tablets));
const unitText = (format) => (isLiquid(format) ? 'mL' : isBand(format) ? 'pipette' : format.unit);
const ROUTE_LABEL = { oral: 'Orale', inj: 'Injectable', spot: 'Spot-on' };
const ROUTE_CHOICES = [['oral', 'Orale : comprimés, liquides buvables'], ['inj', 'Injectable'], ['spot', 'Spot-on : choisi selon le poids']];
// mot du contenant d'une boîte : plaquette, flacon (ou ampoule, poche...), pipette
const boxWord = (f) => (isBand(f) ? 'pipette' : isLiquid(f) ? f.container ?? 'flacon' : 'plaquette');
const intakeName = (drug) => (drug.route === 'inj' ? 'injection' : 'prise');

// Tranche de poids d'un spot-on, comme dans son libellé.
function bandText(b) {
  const n = (v) => fmtMg.format(v);
  if (b.hi == null) return `${b.excl ? 'plus de' : 'à partir de'} ${n(b.lo)} kg`;
  if (!b.lo) return `jusqu’à ${n(b.hi)} kg`;
  return `${b.excl ? '> ' : ''}${n(b.lo)} – ${n(b.hi)} kg`;
}

let rxBuilt = false;
let rxOrderEl;
let rxOrderEmpty;
let rxOrderCount;
let rxNameInput;
let rxDaysInput;
let rxDaysChips;
let rxAddPanel;
let rxAddButton;
let rxProtoPanel;
let rxProtoButton;
let closeRxPanels = () => {};
const rxCards = new Map(); // médicament de l'ordonnance -> { root, refresh, info }
let rxIndexPromise = null;
let rxData = null; // index Med'Vet chargé
let rxIndexFailed = false;
let syncRxDays = null;

// L'index Med'Vet (formes orales pour chien et chat) : chargé une fois, mis en cache par le service worker.
function loadRxIndex() {
  rxIndexPromise ??= fetch('medvet-oral.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('index indisponible'))))
    .then((data) => {
      if (data?.v !== 1 || !Array.isArray(data.p)) throw new Error('index illisible');
      return data;
    })
    .catch((error) => { rxIndexPromise = null; throw error; });
  return rxIndexPromise;
}

// Les textes de la rubrique « Posologie » des fiches : plus lourds que l'index, chargés seulement quand on ouvre
// un extrait (puis servis par le cache du service worker, hors connexion aussi).
let rxPosoPromise = null;
function loadRxPoso() {
  rxPosoPromise ??= fetch('medvet-poso.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('posologies indisponibles'))))
    .then((data) => {
      if (data?.v !== 1 || typeof data.p !== 'object' || !data.p) throw new Error('posologies illisibles');
      return data;
    })
    .catch((error) => { rxPosoPromise = null; throw error; });
  return rxPosoPromise;
}

// Charge l'index à l'ouverture de l'onglet, puis redessine les cartes qui l'attendaient.
let rxIndexRequested = false;
function ensureRxIndex() {
  if (rxIndexRequested) return;
  rxIndexRequested = true;
  loadRxIndex()
    .then((data) => { rxData = data; })
    .catch(() => { rxIndexFailed = true; })
    .finally(() => rxCards.forEach((card) => card.refresh()));
}

function posoText(drug) {
  if (drug.route === 'spot') return `Choisi selon le poids${drug.interval ? ` · une application tous les ${drug.interval} jours` : ''}`;
  if (!isNum(drug.min) || !drug.perDay) return 'Posologie à renseigner';
  const range = isNum(drug.max) && drug.max > drug.min
    ? `${fmtMg.format(drug.min)} – ${fmtMg.format(drug.max)}`
    : fmtMg.format(drug.min);
  const prises = countText(drug.perDay, intakeName(drug));
  const kg = drug.substance?.includes('+') ? 'mg/kg d’association' : 'mg/kg';
  return drug.basis === 'day' ? `${range} ${kg} par jour, en ${prises}` : `${range} ${kg} par ${intakeName(drug)}, ${prises} par jour`;
}

// --- résultat d'un médicament --------------------------------------------------------------

// Les articles parmi lesquels choisir : tous ceux de la substance dans Med'Vet (espèce du patient, marque
// éventuelle), ou, sans substance ou en mode « Mon stock », les dosages saisis à la main.
function candidatesFor(drug) {
  const { source, dispense } = state.rx.prefs;
  // un spot-on se choisit toujours dans Med'Vet : il n'a pas de dosage à saisir
  if ((source !== 'medvet' && drug.route !== 'spot') || !drug.substance) return { formats: drug.formats, market: false };
  if (rxIndexFailed) return { formats: drug.formats, market: false, failed: true };
  if (!rxData) return { loading: true };
  const species = state.species !== 'all' ? state.species : drug.species;
  return { formats: withPrices(marketFormats(rxData.p, drug.substance, { route: drug.route, species, brand: drug.brand, dispense }), state.rx.prices), market: true, species };
}

// GTIN de l'article, à copier d'un toucher. Plusieurs tailles de boîte regroupées : un code par boîte.
function gtinNode(f) {
  const multi = f.boxes?.length > 1;
  const boxes = multi ? f.boxes : [{ blisters: isBand(f) ? f.perBox : f.blisters, gtin: f.gtin }];
  const items = boxes.flatMap((b) => gtinCodes(b.gtin).map((code) => ({ b, code })));
  if (!items.length) return null;
  return el('p', { class: 'rx-gtin' }, items.map(({ b, code }) => el('span', {},
    multi ? `${countText(b.blisters, boxWord(f))} : ` : '',
    el('span', { class: 'rx-gtin-code' }, `GTIN ${code}`),
  )));
}

// Sous le nom de l'article : forme, conditionnement, espèces, et lien vers sa fiche Med'Vet.
function articleLine(f) {
  const species = f.species?.split(',').map((c) => SPECIES_LABEL[c]).join(' et ');
  const bits = [
    f.form?.toLowerCase(),
    isBand(f) && f.band && `pour ${bandText(f.band)}`,
    isLiquid(f) && `${fmtMg.format(f.conc)} mg/mL`,
    formatPackText(f),
    species,
    f.assoc && `association : ${fmtMg.format(f.mg)} mg par ${cpWord(f)}`,
  ].filter(Boolean);
  return el('p', { class: 'rx-article' },
    el('span', {}, bits.join(' · ')),
    f.link && el('a', { class: 'rx-link', href: f.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
  );
}

function rxNote(text, onClick, label) {
  return el('div', { class: 'rx-note' }, el('span', {}, text), button(label, onClick, 'btn-small'));
}

function supplyLines(o, days) {
  const s = o.supply;
  const verb = o.format.route === 'inj' ? 'À ouvrir' : 'À remettre';
  const label = days ? `${verb} · ${countText(days, 'jour')}` : verb;
  let big = '–';
  let unit = '';
  const bits = [];
  if (!s) {
    bits.push('Choisissez la durée du traitement.');
  } else if (!s.packs) {
    bits.push(isLiquid(o.format) ? `${fmtMl.format(s.total)} mL à donner` : `${tabletText(s.totalQuarters / 4)} ${o.format.unit} à donner`, 'conditionnement non renseigné');
  } else if (s.kind === 'liquid') {
    big = String(s.count);
    const word = s.container ?? 'flacon';
    if (s.unit === 'box') {
      unit = s.count > 1 ? 'boîtes' : 'boîte';
      bits.push(s.bottles > 1 ? `${s.bottles} ${word}s de ${fmtMl.format(s.bottle)} mL` : `un ${word} de ${fmtMl.format(s.bottle)} mL`);
    } else {
      unit = s.count > 1 ? `${word}s` : word;
      bits.push(`de ${fmtMl.format(s.bottle)} mL`);
    }
    bits.push(`${fmtMl.format(s.total)} mL à donner`);
    bits.push(s.leftover > 0 ? `reste ${fmtMl.format(s.leftover)} mL (${fmtMg.format(s.leftoverMg)} mg)` : 'aucun reste');
    if (s.extraDays > 0) bits.push(`le reste couvre ${countText(s.extraDays, 'jour')} de plus`);
    if (s.cost !== null) bits.push(`≈ ${eur.format(s.cost)}`);
  } else {
    big = String(s.count);
    if (s.unit === 'box') {
      unit = s.count > 1 ? 'boîtes' : 'boîte';
      bits.push(s.blisters > 1 ? `${s.perBox} ${o.format.unit} (${s.blisters} plaquettes de ${s.perBlister})` : `${s.perBox} ${o.format.unit}`);
    } else if (s.unit === 'blister') {
      unit = s.count > 1 ? 'plaquettes' : 'plaquette';
      bits.push(`de ${s.perBlister} ${o.format.unit}`);
    } else {
      unit = o.format.unit;
    }
    bits.push(`${tabletText(s.totalQuarters / 4)} ${o.format.unit} à donner`);
    bits.push(s.leftover > 0 ? `reste ${tabletText(s.leftover)} ${o.format.unit} (${fmtMg.format(s.leftoverMg)} mg)` : 'aucun reste');
    if (s.extraDays > 0) bits.push(`le reste couvre ${countText(s.extraDays, 'jour')} de plus`);
    if (s.cost !== null) bits.push(`≈ ${eur.format(s.cost)}`);
  }
  return el('div', { class: 'rx-line' },
    el('span', { class: 'name' }, label),
    el('span', { class: 'leader', 'aria-hidden': 'true' }),
    el('div', { class: s?.packs ? 'dose' : 'dose dose-empty' },
      big,
      unit && el('span', { class: 'dose-unit' }, unit),
    ),
    el('div', { class: 'sub' }, el('span', { class: 'calc rx-bits' }, bits.map((b) => el('span', { class: 'extra' }, b)))),
  );
}

function intakeLine(o, target) {
  const dev = o.dev;
  const range = target.ranged ? `${fmtMg.format(target.lo)} – ${fmtMg.format(target.hi)}` : fmtMg.format(target.lo);
  return el('div', { class: 'rx-line' },
    el('span', { class: 'name' }, o.format.route === 'inj' ? 'Par injection' : 'Par prise'),
    el('span', { class: 'leader', 'aria-hidden': 'true' }),
    el('div', { class: 'dose' },
      el('span', { 'aria-hidden': 'true' }, amountText(o)),
      el('span', { class: 'dose-unit', 'aria-hidden': 'true' }, unitText(o.format)),
      el('span', { class: 'sr-only' }, isLiquid(o.format) ? `${fmtMl.format(o.amount)} millilitres` : tabletSpeech(o.tablets, cpWord(o.format))),
    ),
    el('div', { class: 'sub' },
      el('span', { class: 'calc rx-bits' },
        el('span', { class: 'extra' }, `${fmtMg.format(o.dose)} mg`),
        isLiquid(o.format) && el('span', { class: 'extra' }, `${fmtMg.format(o.format.conc)} mg/mL`),
        el('span', { class: 'extra' }, `${fmtMg.format(o.perKg)} mg/kg`),
        el('span', { class: 'coef' }, `cible ${range} mg`),
        Math.abs(dev) > 1e-9 && el('span', { class: o.ok ? 'rnote' : 'rnote rnote-warn' }, `écart ${signedPercent(dev)}`),
      ),
    ),
  );
}

function altRow(drug, o, days, market) {
  const s = o.supply;
  const liquid = isLiquid(o.format);
  const parts = [`${amountText(o)} ${unitText(o.format)} par ${o.format.route === 'inj' ? 'injection' : 'prise'}`];
  if (s?.packs) {
    const what = s.unit === 'box' ? countText(s.count, 'boîte') : s.unit === 'blister' ? countText(s.count, 'plaquette')
      : s.unit === 'bottle' ? countText(s.count, s.container ?? 'flacon') : `${s.count} ${o.format.unit}`;
    const rest = liquid ? `${fmtMl.format(s.leftover)} mL` : `${tabletText(s.leftover)} ${o.format.unit}`;
    parts.push(what, s.leftover > 0 ? `reste ${rest} (${fmtMg.format(s.leftoverMg)} mg)` : 'aucun reste');
    if (s.cost !== null) parts.push(`≈ ${eur.format(s.cost)}`);
  } else if (s && days) {
    parts.push('conditionnement non renseigné');
  }
  return el('li', { class: 'rx-alt-row' },
    el('span', { class: 'name' }, formatLabel(drug, o.format)),
    market && el('span', { class: 'rx-alt-text' }, [o.format.form?.toLowerCase(), formatPackText(o.format)].filter(Boolean).join(' · ')),
    el('span', { class: 'rx-alt-text' }, parts.join(' · ')),
    market && gtinNode(o.format),
    market && o.same?.length && el('span', { class: 'rx-alt-text' }, `Équivalents : ${o.same.map((x) => x.format.brand).join(', ')}`),
    !o.ok && el('span', { class: 'rnote rnote-warn' }, `hors tolérance ${signedPercent(o.dev)}`),
    market && o.format.link && el('a', { class: 'rx-link', href: o.format.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
  );
}

// Les articles équivalents (autres marques, même dosage et même conditionnement) de l'article proposé.
function equivalentsNode(o) {
  if (!o.same?.length) return null;
  return el('details', { class: 'rx-same' },
    el('summary', {}, `${countText(o.same.length, 'équivalent')} : ${o.same.map((x) => x.format.brand).join(', ')}`),
    el('ul', {}, o.same.map((x) => el('li', {},
      el('span', { class: 'name' }, x.format.name),
      gtinNode(x.format),
      x.format.link && el('a', { class: 'rx-link', href: x.format.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
    ))),
  );
}

// --- l'ordonnance du patient en cours ----------------------------------------------------------

const orderLine = (drug) => state.rx.order.find((l) => l.drug === drug);
const lineDays = (drug) => orderLine(drug)?.days ?? state.rx.days; // la durée de la ligne, sinon la durée par défaut
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dateFr = (iso) => iso.split('-').reverse().join('/');
const SPECIES_LOWER = { CN: 'chien', CT: 'chat' };

function addToOrder(drug, days = null) {
  if (!orderLine(drug)) state.rx.order.push({ drug, days });
}

function removeFromOrder(drug) {
  state.rx.order = state.rx.order.filter((l) => l.drug !== drug);
  rxCards.delete(drug);
  renderRx();
}

// Le texte d'état de la posologie d'un médicament, pour la bibliothèque.
function statusText(drug) {
  const st = posologyStatus(drug);
  if (st === 'missing') return 'posologie à renseigner';
  if (st === 'suggested') return 'posologie proposée par Med’Vet : à vérifier';
  if (st === 'validated') return `posologie validée${drug.validated ? ` le ${dateFr(drug.validated)}` : ''}`;
  return '';
}

// Prix de la boîte, saisi par la clinique et gardé par GTIN : sert au coût de la ligne et au total de l'ordonnance.
function priceField(gtin, packLabel) {
  if (!gtin) return null;
  const known = state.rx.prices[gtin];
  const input = el('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: isNum(known) ? String(known).replace('.', ',') : '',
  });
  input.addEventListener('change', () => {
    const text = input.value.trim();
    const n = parseNum(text);
    if (text !== '' && n === null) { input.setAttribute('aria-invalid', 'true'); return; }
    input.setAttribute('aria-invalid', 'false');
    if (text === '') delete state.rx.prices[gtin];
    else state.rx.prices[gtin] = n;
    saveRxPrices();
    renderRx();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return el('label', { class: 'field rx-price' }, el('span', { class: 'field-label' }, `Prix de la boîte (${packLabel}), en € : facultatif`), input);
}

const packLabelOf = (f) => {
  const { n } = boxOf(f);
  return packText([n, isLiquid(f) ? f.volume : isBand(f) ? f.volume : f.perBlister], f.unit, f.container);
};

// Spot-on : l'article dont la tranche de poids (lue dans le libellé du produit) contient le poids du patient.
// Renvoie { main, more } : main se lit d'un coup d'œil, more (article, GTIN, prix, alternatives) est replié.
function rxResultBand(drug, c, days, openEditor, onInfo) {
  const only = (node) => ({ main: [node], more: [] });
  if (!drug.substance) return only(rxNote('Choisissez la substance du spot-on pour trouver l’article selon le poids.', openEditor, 'Choisir'));
  if (c.failed) return only(rxNote('La base Med’Vet n’est pas disponible : un spot-on ne peut pas être choisi sans elle.', openEditor, 'Modifier'));
  const r = planBand({ ...drug, formats: c.formats }, { weight: state.weight, days });
  const who = SPECIES_LABEL[c.species]?.toLowerCase();
  const unread = r.unread ? el('p', { class: 'rx-hint' }, `${countText(r.unread, 'article')} sans tranche de poids lisible dans le libellé du produit : non proposé${r.unread > 1 ? 's' : ''}, à choisir sur la fiche Med’Vet.`) : null;
  if (r.status === 'formats') {
    return only(rxNote(`Aucun spot-on Med’Vet ${drug.substance.toLowerCase()}${who ? ` pour ${who}` : ''}${drug.brand ? ` en marque ${drug.brand}` : ''}.`, openEditor, 'Modifier'));
  }
  if (r.status === 'weight') return { main: [el('p', { class: 'rx-hint' }, 'Saisissez le poids de l’animal.')], more: [unread].filter(Boolean) };
  if (!r.options.length) return { main: [el('p', { class: 'rx-warn', role: 'alert' }, 'Aucun de ces articles n’indique de tranche de poids dans son libellé : choisissez-le sur la fiche Med’Vet.')], more: [unread].filter(Boolean) };

  const [best, ...others] = r.options;
  onInfo({ best, c, days });
  const main = [];
  if (!best.ok) {
    main.push(el('p', { class: 'rx-warn', role: 'alert' },
      `Aucune tranche de poids ne couvre ${fmtWeight.format(state.weight)} kg. La plus proche est à ${fmtMg.format(best.gap)} kg : à ne pas remettre sans vérification.`));
  }
  const f = best.format;
  main.push(
    el('p', { class: 'rx-pick' },
      el('span', { class: 'rx-label' }, best.ok ? 'Article à donner' : 'Plus proche'),
      el('span', { class: 'rx-vname' }, f.name),
    ),
    el('p', { class: 'rx-sentence' }, intakeSentence(best, drug, days)),
    el('div', { class: 'rx-line' },
      el('span', { class: 'name' }, 'Par application'),
      el('span', { class: 'leader', 'aria-hidden': 'true' }),
      el('div', { class: 'dose' }, '1', el('span', { class: 'dose-unit' }, 'pipette')),
      el('div', { class: 'sub' }, el('span', { class: 'calc rx-bits' },
        el('span', { class: 'extra' }, `pour ${bandText(f.band)}`),
        f.volume && el('span', { class: 'extra' }, `${fmtMl.format(f.volume)} mL`),
      )),
    ),
  );
  const s = best.supply;
  if (s?.packs) {
    main.push(el('div', { class: 'rx-line' },
      el('span', { class: 'name' }, `À remettre · ${countText(r.applications, 'application')}`),
      el('span', { class: 'leader', 'aria-hidden': 'true' }),
      el('div', { class: 'dose' }, String(s.count), el('span', { class: 'dose-unit' }, s.count > 1 ? 'boîtes' : 'boîte')),
      el('div', { class: 'sub' }, el('span', { class: 'calc rx-bits' },
        el('span', { class: 'extra' }, `de ${countText(s.perBox, 'pipette')}`),
        el('span', { class: 'extra' }, s.leftover > 0 ? `reste ${countText(s.leftover, 'pipette')}` : 'aucun reste'),
        s.cost !== null && el('span', { class: 'extra' }, `≈ ${eur.format(s.cost)}`),
      )),
    ));
  } else if (!drug.interval) {
    main.push(el('p', { class: 'rx-hint' }, 'Indiquez l’intervalle entre deux applications (Modifier) et la durée pour compter les pipettes.'));
  } else if (!days) {
    main.push(el('p', { class: 'rx-hint' }, 'Choisissez la durée pour compter les pipettes.'));
  }

  const more = [articleLine(f), gtinNode(f), equivalentsNode(best)];
  if (s?.packs) more.push(priceField(s.gtin, packText([s.perBox, f.volume], 'pip')));
  more.push(unread);
  const shown = best.ok ? others.filter((o) => o.ok).slice(0, 8) : others.slice(0, 3);
  const okOthers = others.filter((o) => o.ok).length;
  if (shown.length) {
    more.push(el('details', { class: 'rx-alt' },
      el('summary', {}, `Autres articles (${shown.length}${okOthers > shown.length ? ` sur ${okOthers}` : ''})`),
      el('ul', {}, shown.map((o) => el('li', { class: 'rx-alt-row' },
        el('span', { class: 'name' }, o.format.name),
        el('span', { class: 'rx-alt-text' }, [o.format.form?.toLowerCase(), o.format.band && `pour ${bandText(o.format.band)}`, formatPackText(o.format)].filter(Boolean).join(' · ')),
        o.supply?.packs && el('span', { class: 'rx-alt-text' }, `${countText(o.supply.count, 'boîte')} de ${countText(o.supply.perBox, 'pipette')}, ${o.supply.leftover > 0 ? `reste ${countText(o.supply.leftover, 'pipette')}` : 'aucun reste'}`),
        gtinNode(o.format),
        o.same?.length && el('span', { class: 'rx-alt-text' }, `Équivalents : ${o.same.map((x) => x.format.brand).join(', ')}`),
        !o.ok && el('span', { class: 'rnote rnote-warn' }, `à ${fmtMg.format(o.gap)} kg de la tranche`),
        o.format.link && el('a', { class: 'rx-link', href: o.format.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
      ))),
    ));
  }
  return { main, more: more.filter(Boolean) };
}

// Résultat d'un médicament pour une durée : { main, more }. onInfo reçoit l'option choisie (pour le récap).
function rxResult(drug, days, openEditor, onInfo) {
  const prefs = state.rx.prefs;
  const c = candidatesFor(drug);
  const only = (node) => ({ main: [node], more: [] });
  if (c.loading) {
    ensureRxIndex();
    return only(el('p', { class: 'rx-hint' }, 'Chargement de la base Med’Vet…'));
  }
  if (drug.route === 'spot') return rxResultBand(drug, c, days, openEditor, onInfo);
  const r = plan({ ...drug, formats: c.formats }, { weight: state.weight, days, prefs });
  if (r.status === 'drug') return only(rxNote(`Renseignez la dose (mg/kg) et le nombre de ${intakeName(drug)}s par jour.`, openEditor, 'Renseigner'));
  if (r.status === 'formats') {
    let text;
    if (c.market) {
      const who = SPECIES_LABEL[c.species]?.toLowerCase();
      text = `Aucun ${drug.route === 'inj' ? 'injectable' : 'article'} Med’Vet de ${drug.substance.toLowerCase()}${who ? ` pour ${who}` : ''}${drug.brand ? ` en marque ${drug.brand}` : ''}.`;
    } else if (c.failed) {
      text = 'La base Med’Vet n’est pas disponible : seuls les dosages saisis à la main peuvent servir.';
    } else {
      text = r.skipped ? 'Indiquez les mg par comprimé du dosage.' : 'Choisissez la substance pour chercher dans tout Med’Vet, ou ajoutez un dosage.';
    }
    return only(rxNote(text, openEditor, 'Modifier'));
  }
  if (r.status === 'weight') return only(el('p', { class: 'rx-hint' }, 'Saisissez le poids de l’animal.'));

  const [best, ...others] = r.options;
  onInfo({ best, c, days });
  const main = [];
  if (!best.ok) {
    main.push(el('p', { class: 'rx-warn', role: 'alert' },
      `Aucun ${c.market ? 'article' : 'dosage'} ne tombe à ±${Math.round(prefs.tol * 100)} % de la dose cible. Le plus proche donne ${signedPercent(best.dev)} : à ne pas remettre sans vérification.${c.market ? ' Autoriser les quarts de comprimé ou élargir la tolérance (Réglages) peut ouvrir d’autres choix.' : ''}`));
  }
  main.push(
    el('p', { class: 'rx-pick' },
      el('span', { class: 'rx-label' }, best.ok ? (c.market ? 'Article à donner' : 'Version à donner') : 'Plus proche'),
      el('span', { class: 'rx-vname' }, formatLabel(drug, best.format)),
    ),
    el('p', { class: 'rx-sentence' }, intakeSentence(best, drug, days)),
    intakeLine(best, r.target),
    supplyLines(best, days),
  );
  if (r.skipped && !c.market) main.push(el('p', { class: 'rx-hint' }, `${countText(r.skipped, 'dosage')} sans mg par comprimé : ignoré${r.skipped > 1 ? 's' : ''}.`));
  if (!c.market && prefs.source === 'medvet' && !drug.substance) main.push(el('p', { class: 'rx-hint' }, 'Choisissez la substance (Modifier) pour chercher dans tout Med’Vet.'));

  const more = [];
  if (c.market) {
    more.push(articleLine(best.format), gtinNode(best.format), equivalentsNode(best), priceField(boxOf(best.format).gtin, packLabelOf(best.format)));
  }
  // Med'Vet : on garde les meilleurs articles dans la tolérance ; sinon les plus proches
  const okOthers = others.filter((o) => o.ok).length;
  const shown = !c.market ? others : best.ok ? others.filter((o) => o.ok).slice(0, 8) : others.slice(0, 3);
  if (shown.length) {
    more.push(el('details', { class: 'rx-alt' },
      el('summary', {}, c.market ? `Autres articles (${shown.length}${okOthers > shown.length ? ` sur ${okOthers}` : ''})` : `Autres dosages (${shown.length})`),
      el('ul', {}, shown.map((o) => altRow(drug, o, days, c.market))),
    ));
  }
  return { main, more: more.filter(Boolean) };
}

// --- posologie du RCP, à côté du résultat ---------------------------------------------------------

// La fiche dont on montre la posologie : celle de l'article proposé ; sans article (poids ou dose pas encore
// saisis), celle du premier article de la substance, ou à défaut la fiche d'où vient le médicament.
function rcpTarget(drug, article) {
  const formats = candidatesFor(drug).formats ?? [];
  const f = article?.link ? article : formats.find((x) => x.link);
  const link = f?.link ?? drug.link;
  if (!link) return null;
  return { link, label: f?.name ?? drug.name, species: state.species !== 'all' ? state.species : drug.species };
}

function rcpContent(target, entry) {
  const texts = rcpTexts(entry, target.species);
  const who = SPECIES_LABEL[target.species]?.toLowerCase();
  const nodes = texts.length
    ? texts.map(({ species, text }) => el('div', { class: 'rx-rcp-block' },
      species && texts.length > 1 && el('h3', { class: 'rx-rcp-sp' }, SPECIES_LABEL[species]),
      el('div', { class: 'rx-rcp-text', tabindex: '0', role: 'region', 'aria-label': `Posologie du RCP${species ? ` : ${SPECIES_LABEL[species].toLowerCase()}` : ''}` }, text),
    ))
    : [el('p', { class: 'rx-hint' }, `La fiche Med’Vet ne donne pas de posologie${who ? ` pour ${who}` : ''}.`)];
  return [
    ...nodes,
    el('p', { class: 'rx-rcp-src' },
      'Texte de la fiche Med’Vet de ', el('span', {}, target.label), ' : le RCP fait foi. ',
      el('a', { class: 'rx-link', href: target.link, target: '_blank', rel: 'noopener' }, 'Fiche complète')),
  ];
}

// --- une ligne d'ordonnance par médicament : le résultat se redessine, le reste suit ------------

// Une ligne d'ordonnance : nom, posologie, résultat à lire d'un coup d'œil, détails repliés.
function rxCard(drug) {
  const known = rxCards.get(drug);
  if (known) return known;

  const title = el('h2', { class: 'rx-name' });
  const chip = el('span', { class: 'chip' });
  const routeChip = el('span', { class: 'chip chip-route' });
  const poso = el('p', { class: 'rx-poso' });
  const status = el('p', { class: 'rx-status' });
  const suggest = el('div', { class: 'rx-suggest', role: 'status', hidden: true },
    el('span', {}, 'Posologie proposée d’après la fiche Med’Vet : à vérifier avant de remettre.'),
    button('Confirmer', () => { drug.suggested = undefined; drug.validated = todayIso(); saveRx(); refreshDrug(drug); }, 'btn-small'),
  );
  const warns = el('div', { class: 'rx-warns' });
  const result = el('div', { class: 'rx-result' });
  const moreBody = el('div', { class: 'rx-more-body' });
  const rcpSummary = el('summary', {}, 'Posologie du RCP');
  const rcpBody = el('div', { class: 'rx-rcp-body' });
  const rcp = el('details', { class: 'rx-rcp', hidden: true }, rcpSummary, rcpBody);
  const more = el('details', { class: 'rx-more', hidden: true }, el('summary', {}, 'Détails de l’article et alternatives'), moreBody, rcp);

  // durée propre à cette ligne ; vide = la durée par défaut (affichée en grisé)
  const daysInput = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 3, 'aria-label': 'Durée de cette ligne, en jours' });
  daysInput.addEventListener('input', () => {
    const text = daysInput.value.trim();
    const n = /^\d{1,3}$/.test(text) ? Number(text) : null;
    const line = orderLine(drug);
    if (line) line.days = n > 0 ? n : null;
    daysInput.setAttribute('aria-invalid', String(text !== '' && !(n > 0)));
    refresh();
  });
  daysInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') daysInput.blur(); });
  const daysRow = el('label', { class: 'rx-daysrow' },
    el('span', { class: 'days-label' }, 'Durée'),
    daysInput,
    el('span', { class: 'days-unit' }, 'jours'),
  );

  const root = el('section', { class: 'rx-card' },
    el('div', { class: 'rx-head' },
      el('div', { class: 'rx-title' }, title, chip, routeChip),
      el('div', { class: 'rx-head-actions' },
        button('Modifier', () => openRxEditor(drug), 'btn-ghost btn-small'),
        button('Retirer', () => removeFromOrder(drug), 'btn-ghost btn-small'),
      ),
    ),
    poso, status, suggest, warns, daysRow, result, more,
  );

  // L'extrait ne se charge qu'à l'ouverture, puis reste ouvert quand le résultat se redessine.
  let target = null;
  const fillRcp = () => {
    if (!rcp.open || !target) return;
    const key = `${target.link}|${target.species ?? ''}`;
    if (rcpBody.dataset.key === key) return;
    rcpBody.dataset.key = key;
    const mine = target;
    rcpBody.replaceChildren(el('p', { class: 'rx-hint' }, 'Chargement du texte…'));
    loadRxPoso()
      .then((data) => {
        if (rcpBody.dataset.key !== key) return;
        rcpBody.replaceChildren(...rcpContent(mine, data.p[posoKey(mine.link)]));
      })
      .catch(() => {
        if (rcpBody.dataset.key !== key) return;
        rcpBody.dataset.failed = 'true';
        rcpBody.replaceChildren(
          el('p', { class: 'rx-warn', role: 'alert' }, 'Le texte n’est pas disponible pour le moment (hors connexion ?).'),
          el('a', { class: 'rx-link', href: mine.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
        );
      });
  };
  rcp.addEventListener('toggle', () => {
    if (rcp.open && rcpBody.dataset.failed) { delete rcpBody.dataset.failed; delete rcpBody.dataset.key; }
    fillRcp();
  });

  const card = { root, refresh: null, info: null };
  const refresh = (opts) => {
    const days = lineDays(drug);
    title.textContent = drug.name || 'Sans nom';
    chip.textContent = SPECIES_LABEL[drug.species] ?? '';
    chip.className = `chip chip-${drug.species}`;
    chip.hidden = !drug.species;
    routeChip.textContent = ROUTE_LABEL[drug.route];
    routeChip.hidden = drug.route === 'oral';
    const market = (state.rx.prefs.source === 'medvet' || drug.route === 'spot') && drug.substance;
    poso.replaceChildren(...[
      posoText(drug),
      market && el('span', {}, `Med’Vet : ${drug.substance.toLowerCase()}, ${drug.brand ? `marque ${drug.brand}` : 'toutes marques'}`),
      drug.note && el('span', { class: 'rx-note-text' }, drug.note),
      !market && drug.link && el('a', { class: 'rx-link', href: drug.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
    ].filter(Boolean));

    // posologie : proposée par Med'Vet (à confirmer) ou validée par la clinique, avec sa date
    const st = posologyStatus(drug);
    suggest.hidden = st !== 'suggested';
    status.hidden = st !== 'validated';
    status.textContent = st === 'validated' ? `Posologie validée par la clinique${drug.validated ? ` le ${dateFr(drug.validated)}` : ''}` : '';

    // garde-fous : autre espèce que le patient, même substance ou même classe qu'une autre ligne
    const messages = [];
    if (state.species !== 'all' && drug.species && drug.species !== state.species) {
      messages.push(`Médicament enregistré pour le ${SPECIES_LOWER[drug.species]} : le patient est un ${SPECIES_LOWER[state.species]}. À vérifier.`);
    }
    messages.push(...(orderWarnings(state.rx.order.map((l) => l.drug)).get(drug) ?? []));
    warns.replaceChildren(...messages.map((m) => el('p', { class: 'rx-warn' }, m)));

    let info = null;
    const out = rxResult(drug, days, () => openRxEditor(drug), (i) => { info = i; });
    result.replaceChildren(...out.main);
    moreBody.replaceChildren(...out.more);
    target = drug.route === 'spot' && !info ? null : rcpTarget(drug, info?.best.format ?? null);
    rcp.hidden = !target;
    if (target) {
      rcpSummary.textContent = `Posologie du RCP · ${target.label}`;
      fillRcp();
    }
    more.hidden = !(out.more.length || target);

    card.info = info && {
      label: formatLabel(drug, info.best.format),
      sentence: intakeSentence(info.best, drug, days),
      parts: supplyParts(info.best),
      phrase: supplyPhrase(info.best),
      cost: info.best.supply?.cost ?? null,
      ok: info.best.ok,
      market: Boolean(info.c.market),
      format: info.best.format,
    };

    const line = orderLine(drug);
    daysInput.placeholder = state.rx.days ? String(state.rx.days) : '–';
    if (document.activeElement !== daysInput) {
      daysInput.value = line?.days ? String(line.days) : '';
      daysInput.setAttribute('aria-invalid', 'false');
    }
    if (opts?.quiet !== true) renderRecap();
  };
  card.refresh = refresh;
  rxCards.set(drug, card);
  refresh({ quiet: true });
  return card;
}

// Un médicament a changé (éditeur, confirmation) : sa ligne, les alertes des autres lignes, la bibliothèque et le récap suivent.
function refreshDrug(drug) {
  for (const line of state.rx.order) rxCards.get(line.drug)?.refresh({ quiet: true });
  renderLibrary();
  renderRecap();
}

// --- édition d'un médicament, dans un panneau à part ------------------------------------------

let rxDialog;
let rxDialogTitle;
let rxDialogBody;

function openRxEditor(drug) {
  rxDialogTitle.textContent = drug.name || 'Nouveau médicament';
  buildRxEditor(drug, rxDialogBody, () => { rxDialogTitle.textContent = drug.name || 'Nouveau médicament'; refreshDrug(drug); }, closeRxEditor);
  if (!rxDialog.open) rxDialog.showModal();
  rxDialogBody.querySelector('input, select')?.focus({ preventScroll: true });
}

function closeRxEditor() {
  if (rxDialog.open) rxDialog.close();
}

function fmtEditor(drug, f, rerender, commit) {
  const liquid = isLiquid(f);
  return el('div', { class: 'rx-fmt' },
    field('Nom du dosage', textInput(f.name, (v) => { f.name = v; }, commit), 'wide'),
    liquid
      ? [
        field('Concentration (mg/mL)', numInput(f.conc, (v) => { f.conc = v > 0 ? v : undefined; }, true, commit)),
        field('Volume d’un flacon (mL)', numInput(f.volume, (v) => { f.volume = v > 0 ? v : undefined; }, false, commit)),
        field('Flacons par boîte', numInput(f.bottles, (v) => { f.bottles = Number.isInteger(v) && v > 0 ? v : 1; }, false, commit)),
      ]
      : [
        field('Dosage (mg par comprimé)', numInput(f.mg, (v) => { f.mg = v; }, true, commit)),
        field('Se coupe en', select(SPLIT_CHOICES, f.split, (v) => { f.split = v; }, commit)),
        field('Comprimés par plaquette', numInput(f.perBlister, (v) => { f.perBlister = Number.isInteger(v) && v > 0 ? v : null; }, false, commit)),
        field('Plaquettes par boîte', numInput(f.blisters, (v) => { f.blisters = Number.isInteger(v) && v > 0 ? v : 1; }, false, commit)),
      ],
    field('Prix de la boîte (€, facultatif)', numInput(f.price, (v) => { f.price = v ?? undefined; }, false, commit)),
    field('GTIN (facultatif)', textInput(gtinCodes(f.gtin).join(', '), (v) => {
      const codes = v.split(/[\s,;]+/).filter(Boolean);
      f.gtin = codes.length && codes.every((c) => /^\d{8,14}$/.test(c)) ? codes.join(',') : undefined;
    }, commit)),
    button('Retirer ce dosage', () => {
      if (!confirm(`Retirer le dosage « ${f.name || 'Sans nom'} » ?`)) return;
      drug.formats.splice(drug.formats.indexOf(f), 1);
      commit();
      rerender();
    }, 'btn-danger btn-small'),
  );
}

const FAMILY_SUGGESTIONS = ['AINS', 'Antibiotique', 'Corticoïde', 'Antalgique', 'Gastroprotecteur', 'Antiémétique', 'Antiparasitaire', 'Anticonvulsivant'];

function buildRxEditor(drug, host, refresh, close) {
  const commit = () => { saveRx(); refresh(); };
  // la dose saisie par la clinique vaut validation (à la date du jour) ; une dose proposée par Med'Vet ne le vaut pas
  const posology = (apply) => (v) => { apply(v); drug.suggested = undefined; drug.validated = todayIso(); };
  const formatsHost = el('div', { class: 'rx-formats' });
  const renderFormats = () => formatsHost.replaceChildren(
    ...(drug.formats.length ? drug.formats.map((f) => fmtEditor(drug, f, renderFormats, commit)) : [el('p', { class: 'rx-hint' }, 'Aucun dosage : ajoutez-en un ci-dessous.')]),
  );
  renderFormats();

  const searchHost = el('div', { class: 'rx-search-host', hidden: true });
  let search;
  const addFound = (product, pack) => {
    const exists = drug.formats.some((f) => sameFormat(f, product, pack));
    if (!exists) drug.formats.push(formatFromProduct(product, pack));
    if (!drug.link && product.l) drug.link = drugFromProduct(product, pack).link;
    commit();
    renderFormats();
    return exists ? `${productName(product)} est déjà dans la liste.` : `${productName(product)} ajouté.`;
  };

  // substance et marque : l'appli cherche parmi tous les articles Med'Vet de la substance
  const substanceSel = el('select', {});
  const brandSel = el('select', {});
  const fillSubstances = () => {
    const labels = rxData ? listSubstances(rxData.p, drug.route).map((x) => x.label) : [];
    if (drug.substance && !labels.includes(drug.substance)) labels.push(drug.substance);
    substanceSel.replaceChildren(
      el('option', { value: '' }, 'Aucune : mes dosages seulement'),
      ...labels.map((label) => el('option', { value: label, selected: label === drug.substance }, label)),
    );
  };
  const fillBrands = () => {
    const brands = rxData && drug.substance ? brandsOf(rxData.p, drug.substance, drug.route) : [];
    if (drug.brand && !brands.includes(drug.brand)) brands.push(drug.brand);
    brandSel.replaceChildren(
      el('option', { value: '' }, 'Toutes les marques'),
      ...brands.map((b) => el('option', { value: b, selected: b === drug.brand }, b)),
    );
    brandSel.disabled = !drug.substance;
  };
  substanceSel.addEventListener('change', () => {
    drug.substance = substanceSel.value || undefined;
    drug.brand = undefined;
    if (drug.substance && !drug.name) drug.name = drug.substance;
    fillBrands();
    commit();
  });
  brandSel.addEventListener('change', () => { drug.brand = brandSel.value || undefined; commit(); });
  fillSubstances();
  fillBrands();
  ensureRxIndex();
  loadRxIndex().then(() => { fillSubstances(); fillBrands(); }).catch(() => {});

  const posologyFields = el('div', { class: 'rx-form' },
    field('Prises par jour', select(
      [['', '–'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
      drug.perDay ? String(drug.perDay) : '',
      posology((v) => { drug.perDay = v ? Number(v) : null; }),
      commit,
    )),
    field('Dose (mg/kg)', numInput(drug.min, posology((v) => { drug.min = v; }), true, commit)),
  );
  const help = el('p', { class: 'rx-help' }, 'La dose se lit sur la fiche du médicament. Une dose saisie ici vaut validation par la clinique.');
  const advancedPosology = el('div', { class: 'rx-form' },
    field('Dose max (mg/kg)', numInput(drug.max, posology((v) => { drug.max = v ?? undefined; }), false, commit)),
    field('Dose donnée', select([['intake', 'par prise ou injection'], ['day', 'par jour']], drug.basis, posology((v) => { drug.basis = v; }), commit), 'wide'),
    el('p', { class: 'rx-help wide' }, '« Par jour » est divisée par le nombre de prises.'),
  );
  const intervalFields = el('div', { class: 'rx-form' },
    field('Une application tous les (jours)', numInput(drug.interval, (v) => { drug.interval = Number.isInteger(v) && v > 0 ? v : undefined; }, false, commit), 'wide'),
    el('p', { class: 'rx-help wide' }, 'Le spot-on est choisi selon le poids, d’après la tranche écrite dans le libellé du produit : aucune dose à saisir. L’intervalle (30 jours, 84 jours...) sert à compter les pipettes pour la durée choisie.'),
  );
  const stock = el('details', { class: 'rx-stock', open: !drug.substance },
    el('summary', {}, 'Mes dosages (si pas de substance, ou en mode « Mon stock »)'),
    formatsHost,
    el('div', { class: 'rx-actions' },
      button('Ajouter depuis Med’Vet', () => {
        searchHost.hidden = !searchHost.hidden;
        if (!search) { search = rxSearch(addFound, { route: drug.route }); searchHost.replaceChildren(search.root); }
        if (!searchHost.hidden) search.focus();
      }),
      button('Ajouter à la main', () => {
        drug.formats.push(normalizeFormat({ split: 'none' }));
        commit();
        renderFormats();
        formatsHost.lastElementChild.querySelector('input')?.focus();
      }),
    ),
    searchHost,
  );

  // champs rares : repliés, sauf si l'un d'eux est déjà renseigné
  const familyInput = textInput(drug.family, (v) => { drug.family = v || undefined; }, commit);
  familyInput.setAttribute('list', 'rx-families');
  const advanced = el('details', { class: 'rx-adv', open: Boolean(drug.brand || isNum(drug.max) || drug.basis === 'day' || drug.family || drug.note) },
    el('summary', {}, 'Avancé : marque, dose max, classe, note'),
    el('div', { class: 'rx-form' },
      field('Marque', brandSel, 'wide'),
      field('Classe (alertes entre médicaments)', familyInput, 'wide'),
      el('datalist', { id: 'rx-families' }, FAMILY_SUGGESTIONS.map((x) => el('option', { value: x }))),
      field('Note (imprimée sur l’ordonnance)', textInput(drug.note, (v) => { drug.note = v; }, commit), 'wide'),
    ),
    advancedPosology,
  );

  // la voie change les champs : posologie en mg/kg (oral, injectable) ou intervalle (spot-on, selon le poids)
  const applyRoute = () => {
    const spot = drug.route === 'spot';
    posologyFields.hidden = spot;
    advancedPosology.hidden = spot;
    help.hidden = spot;
    stock.hidden = spot;
    intervalFields.hidden = !spot;
  };
  const routeSel = select(ROUTE_CHOICES, drug.route, (v) => {
    drug.route = v;
    drug.suggested = undefined;
    drug.substance = undefined;
    drug.brand = undefined;
    search = undefined;
    searchHost.replaceChildren();
    searchHost.hidden = true;
    fillSubstances();
    fillBrands();
    applyRoute();
  }, commit);
  applyRoute();

  host.replaceChildren(
    el('div', { class: 'rx-form' },
      field('Nom', textInput(drug.name, (v) => { drug.name = v; }, commit), 'wide'),
      field('Voie', routeSel, 'wide'),
      field('Substance (Med’Vet)', substanceSel, 'wide'),
      field('Espèce', select([['', 'Chien et chat'], ['CN', 'Chien'], ['CT', 'Chat']], drug.species || '', (v) => { drug.species = v || undefined; }, commit), 'wide'),
    ),
    posologyFields,
    help,
    intervalFields,
    advanced,
    stock,
    el('div', { class: 'rx-actions rx-end' },
      button('Supprimer ce médicament', () => {
        if (!confirm(`Supprimer « ${drug.name || 'Sans nom'} » de la bibliothèque ?`)) return;
        state.rx.drugs.splice(state.rx.drugs.indexOf(drug), 1);
        state.rx.order = state.rx.order.filter((l) => l.drug !== drug);
        for (const protocol of state.rx.protocols) protocol.items = protocol.items.filter((i) => i.drug !== drug.id);
        rxCards.delete(drug);
        saveRx();
        saveRxProtocols();
        close();
      }, 'btn-danger btn-small'),
      button('Terminé', close, 'btn-primary btn-small'),
    ),
  );
}

// --- recherche dans l'index Med'Vet ------------------------------------------------------------

function rxSearch(onPick, { route } = {}) {
  const input = el('input', {
    type: 'search',
    class: 'text',
    autocomplete: 'off',
    placeholder: 'Nom, principe actif ou GTIN (ex. Zitac, méloxicam)',
    'aria-label': 'Rechercher un médicament dans Med’Vet',
  });
  const status = el('p', { class: 'prefs-note', role: 'status' }, 'Chargement de la base Med’Vet…');
  const hits = el('div', { class: 'rx-hits' });
  const root = el('div', { class: 'rx-search' }, input, status, hits);
  let data = null;
  let pool = [];
  let message = '';

  const run = () => {
    if (!data) return;
    const query = input.value.trim();
    if (query.length < 2) {
      hits.replaceChildren();
      status.textContent = message || `Base Med’Vet du ${data.date} : articles pour chien et chat (voie orale, injectables, spot-on).`;
      return;
    }
    const found = searchIndex(pool, query, 15);
    const count = `${countText(found.length, 'produit')}${found.length === 15 ? ' (affinez la recherche)' : ''}`;
    status.textContent = message || (found.approx ? `Aucun résultat exact : ${count} proche${found.length > 1 ? 's' : ''} de « ${query} »` : found.length ? count : 'Aucun résultat : ajoutez-le à la main.');
    message = '';
    hits.replaceChildren(...found.map((product) => hit(product)));
  };

  const hit = (product) => {
    const kind = routeOf(product);
    const combo = isUnhandledCombo(product);
    const bare = (name) => name.replace(/^(\S.*?)\s*\([^()]*\)\s*$/, '$1').toLowerCase();
    let actives;
    if (kind === 'spot') actives = [...new Set(product.a.map((a) => bare(a[0])))].join(' + ');
    else if (product.u === 'mL') actives = `${bare(product.a[0][0])} ${String(product.c).replace('.', ',')} mg/mL`;
    else actives = product.a.map((a) => `${bare(a[0])}${a[1] != null ? ` ${String(a[1]).replace('.', ',')} ${a[2]}` : ''}`).join(' + ');
    const species = product.s.split(',').map((c) => SPECIES_LABEL[c]).join(', ');
    const meta = [actives, species, kind === 'inj' && 'injectable', kind === 'spot' && 'spot-on'].filter(Boolean).join(' · ');
    let hint = null;
    if (kind === 'spot') {
      hint = product.w
        ? `Tranche de poids : ${bandText({ lo: product.w[0], hi: product.w[1], excl: Boolean(product.w[2]) })}`
        : 'Tranche de poids non lue dans le libellé : voir la fiche Med’Vet.';
    } else if (combo) {
      hint = 'Association de plusieurs substances, le plus souvent dosée par tranche de poids (NexGard, Milbemax, Drontal...) : l’appli ne la calcule pas. Voir la fiche Med’Vet, ou « Saisir à la main ».';
    } else if ((product.m ?? product.c) == null) {
      hint = 'Dosage par comprimé à saisir après l’ajout.';
    }
    const link = productLink(product);
    return el('div', { class: 'rx-hit' },
      el('p', { class: 'rx-hit-name' }, productName(product), el('span', { class: 'rx-hit-meta' }, meta)),
      hint && el('p', { class: 'rx-hint' }, hint),
      el('ul', { class: 'rx-packs' }, product.k.map((pack) => el('li', {},
        el('div', {},
          el('span', {}, packText(pack, product.u, product.ct)),
          pack[3] && el('span', { class: 'rx-gtin rx-gtin-code' }, gtinCodes(pack[3]).map((c) => `GTIN ${c}`).join(' · ')),
        ),
        !combo && button('Ajouter', () => { message = onPick(product, pack); run(); }, 'btn-small'),
      ))),
      combo && link && el('a', { class: 'rx-link', href: link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
    );
  };

  input.addEventListener('input', run);
  loadRxIndex().then((loaded) => {
    data = loaded;
    pool = route ? data.p.filter((p) => routeOf(p) === route) : data.p;
    run();
  }).catch(() => {
    input.hidden = true;
    status.textContent = 'La recherche Med’Vet n’est pas disponible : ajoutez le médicament à la main.';
  });
  return { root, focus: () => input.focus() };
}

// --- ajout d'un médicament à la bibliothèque ---------------------------------------------------------

// Le dosage (ou article) saisi correspond-il à ce conditionnement du produit ?
function sameFormat(f, product, pack) {
  if (f.name !== productName(product)) return false;
  return product.u === 'mL' ? f.volume === pack[1] && f.bottles === pack[0] : f.perBlister === pack[1] && f.blisters === (pack[0] ?? 1);
}

// --- ajout d'un médicament à la bibliothèque et à l'ordonnance -----------------------------------

const scrollToCard = (drug) => rxCards.get(drug)?.root.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });

// Un produit trouvé dans Med'Vet : il rejoint la bibliothèque (une carte par substance et par voie) et l'ordonnance.
// Sans posologie à lui proposer, le panneau d'édition s'ouvre pour la saisir tout de suite.
function addDrugFromProduct(product, pack) {
  const substance = substanceOf(product);
  const brand = fold(product.b);
  const route = routeOf(product);
  const existing = state.rx.drugs.find((d) => d.route === route && (substance ? d.substance === substance.label : fold(d.name) === brand));
  const species = state.species !== 'all' ? state.species : undefined;
  let drug = existing;
  let text;
  if (existing) {
    const exists = existing.formats.some((g) => sameFormat(g, product, pack));
    if (!exists && !substance) existing.formats.push(formatFromProduct(product, pack));
    // un médicament encore sans posologie reçoit celle que Med'Vet propose, à vérifier comme les autres
    const suggestion = route === 'spot' || (isNum(existing.min) && existing.perDay) ? undefined : suggestedPosology(product, existing.species ?? species);
    if (suggestion) Object.assign(existing, { ...suggestion, species: existing.species ?? suggestion.species, suggested: true });
    text = suggestion
      ? `« ${existing.name} » est déjà dans la bibliothèque : posologie Med’Vet proposée, à vérifier.`
      : `« ${existing.name} » est déjà dans la bibliothèque.`;
  } else {
    drug = drugFromProduct(product, pack, species);
    state.rx.drugs.push(drug);
    text = route === 'spot'
      ? `« ${drug.name} » ajouté : l’article se choisit selon le poids.`
      : drug.suggested
        ? `« ${drug.name} » ajouté avec la posologie proposée par Med’Vet : à vérifier.`
        : `« ${drug.name} » ajouté : renseignez maintenant sa posologie.`;
  }
  saveRx();
  addToOrder(drug);
  closeRxPanels();
  renderRx();
  scrollToCard(drug);
  if (posologyStatus(drug) === 'missing') openRxEditor(drug);
  return `${text} Il est sur l’ordonnance.`;
}

function addBlankDrug() {
  const drug = normalizeDrug({ name: '', formats: [{}] });
  state.rx.drugs.push(drug);
  saveRx();
  addToOrder(drug);
  closeRxPanels();
  renderRx();
  openRxEditor(drug);
}

// --- protocoles : des ordonnances types ----------------------------------------------------------

function applyProtocol(protocol) {
  let added = 0;
  let missing = 0;
  for (const item of protocol.items) {
    const drug = state.rx.drugs.find((d) => d.id === item.drug);
    if (!drug) { missing++; continue; }
    if (!orderLine(drug)) { state.rx.order.push({ drug, days: item.days }); added++; }
  }
  renderRx();
  return `${protocol.name} : ${countText(added, 'médicament')} ajouté${added > 1 ? 's' : ''} à l’ordonnance${missing ? `, ${countText(missing, 'médicament')} introuvable${missing > 1 ? 's' : ''} dans la bibliothèque` : ''}.`;
}

function saveOrderAsProtocol() {
  if (!state.rx.order.length) return 'L’ordonnance est vide : ajoutez d’abord des médicaments.';
  const name = (prompt('Nom du protocole (ex. Post-op chien)') ?? '').trim().slice(0, 60);
  if (!name) return '';
  const items = state.rx.order.map((l) => ({ drug: l.drug.id, days: l.days ?? state.rx.days ?? null }));
  const same = state.rx.protocols.find((p) => fold(p.name) === fold(name));
  if (same) {
    if (!confirm(`Remplacer le protocole « ${same.name} » ?`)) return '';
    same.items = items;
  } else {
    state.rx.protocols.push(normalizeProtocol({ name, items }));
  }
  saveRxProtocols();
  renderProtocols();
  return `Protocole « ${name} » enregistré : ${countText(items.length, 'médicament')}.`;
}

let rxProtoList;
let rxProtoMsg;
function renderProtocols() {
  if (!rxProtoList) return;
  const say = (text) => { rxProtoMsg.textContent = text; };
  rxProtoList.replaceChildren(...(state.rx.protocols.length
    ? state.rx.protocols.map((protocol) => {
      const names = protocol.items.map((i) => state.rx.drugs.find((d) => d.id === i.drug)?.name).filter(Boolean);
      return el('li', { class: 'rx-lib-row' },
        el('div', { class: 'rx-lib-info' },
          el('p', { class: 'rx-lib-name' }, protocol.name),
          el('p', { class: 'rx-hint' }, names.length ? names.join(' · ') : 'Aucun médicament de la bibliothèque'),
        ),
        el('div', { class: 'rx-actions' },
          button('Ajouter à l’ordonnance', () => say(applyProtocol(protocol)), 'btn-small'),
          button('Supprimer', () => {
            if (!confirm(`Supprimer le protocole « ${protocol.name} » ?`)) return;
            state.rx.protocols = state.rx.protocols.filter((p) => p !== protocol);
            saveRxProtocols();
            renderProtocols();
          }, 'btn-danger btn-small'),
        ),
      );
    })
    : [el('li', { class: 'rx-hint' }, 'Aucun protocole. Un protocole regroupe plusieurs médicaments et leur durée (ex. « Post-op chien » : antibiotique, AINS, antalgique). Composez une ordonnance, puis enregistrez-la ici.')]));
  rxProtoSave.disabled = !state.rx.order.length;
}
let rxProtoSave;

// --- bibliothèque ----------------------------------------------------------------------------------

let rxQuickAdd;
let rxLibraryList;
let rxLibrarySummary;
function renderLibrary() {
  if (!rxLibraryList) return;
  const all = state.rx.drugs;
  const shown = all.filter(matchesSpecies);
  rxLibrarySummary.textContent = `Bibliothèque et réglages (${all.length})`;

  rxQuickAdd.replaceChildren(...(shown.length
    ? shown.map((drug) => el('button', {
      type: 'button',
      class: 'qchip',
      'aria-pressed': String(Boolean(orderLine(drug))),
      onclick: () => {
        if (orderLine(drug)) removeFromOrder(drug);
        else { addToOrder(drug); renderRx(); scrollToCard(drug); }
      },
    }, drug.name || 'Sans nom'))
    : [el('p', { class: 'rx-hint' }, all.length
      ? 'Aucun médicament de la bibliothèque pour cette espèce.'
      : 'La bibliothèque est vide : cherchez un médicament ci-dessous. Il y restera pour les prochaines ordonnances.')]));

  rxLibraryList.replaceChildren(...(shown.length
    ? shown.map((drug) => {
      const on = Boolean(orderLine(drug));
      return el('li', { class: 'rx-lib-row' },
        el('div', { class: 'rx-lib-info' },
          el('p', { class: 'rx-lib-name' }, drug.name || 'Sans nom',
            drug.species && el('span', { class: `chip chip-${drug.species}` }, SPECIES_LABEL[drug.species]),
            drug.route !== 'oral' && el('span', { class: 'chip chip-route' }, ROUTE_LABEL[drug.route]),
          ),
          el('p', { class: 'rx-hint' }, [posoText(drug), statusText(drug)].filter(Boolean).join(' · ')),
        ),
        el('div', { class: 'rx-actions' },
          el('button', { type: 'button', class: 'btn btn-small', disabled: on, onclick: () => { addToOrder(drug); renderRx(); scrollToCard(drug); } }, on ? 'Sur l’ordonnance' : 'Ajouter'),
          button('Modifier', () => openRxEditor(drug), 'btn-ghost btn-small'),
        ),
      );
    })
    : []));
}

// --- récapitulatif : texte à donner, total, copie et impression -------------------------------------

let rxRecapEl;
let rxRecapRows;
let rxRecapTotal;
let rxRecapNote;
let rxCopyBtn;
let rxPrintBtn;
let rxRecapMsg;
let rxRecapTimer = 0;

const rxSay = (text) => {
  rxRecapMsg.textContent = text;
  clearTimeout(rxRecapTimer);
  if (text) rxRecapTimer = setTimeout(() => { rxRecapMsg.textContent = ''; }, 4000);
};

// Les lignes complètes de l'ordonnance : { drug, info }
const rxDoneLines = () => state.rx.order.map((l) => ({ drug: l.drug, info: rxCards.get(l.drug)?.info })).filter((x) => x.info);

function renderRecap() {
  if (!rxRecapEl) return;
  const lines = state.rx.order;
  rxRecapEl.hidden = !lines.length;
  if (rxProtoSave) rxProtoSave.disabled = !lines.length;
  if (!lines.length) return;

  const costs = [];
  let incomplete = 0;
  let suggested = 0;
  rxRecapRows.replaceChildren(...lines.map((l, i) => {
    const info = rxCards.get(l.drug)?.info;
    if (posologyStatus(l.drug) === 'suggested') suggested++;
    const name = `${i + 1}. ${info?.label ?? (l.drug.name || 'Sans nom')}`;
    if (!info) {
      incomplete++;
      costs.push(null);
      return el('div', { class: 'rx-line' },
        el('span', { class: 'name' }, name),
        el('span', { class: 'leader', 'aria-hidden': 'true' }),
        el('div', { class: 'dose dose-empty' }, '–'),
        el('div', { class: 'sub' }, el('span', { class: 'calc rx-bits' }, el('span', { class: 'extra' }, 'À compléter : posologie, article ou poids'))),
      );
    }
    costs.push(info.cost);
    return el('div', { class: 'rx-line' },
      el('span', { class: 'name' }, name),
      el('span', { class: 'leader', 'aria-hidden': 'true' }),
      info.parts
        ? el('div', { class: 'dose' }, String(info.parts.count), el('span', { class: 'dose-unit' }, info.parts.unit))
        : el('div', { class: 'dose dose-empty' }, '–'),
      el('div', { class: 'sub' }, el('span', { class: 'calc rx-bits' },
        el('span', { class: 'extra' }, info.sentence),
        info.parts?.detail && el('span', { class: 'extra' }, info.parts.detail),
        !info.parts && el('span', { class: 'extra' }, 'choisissez la durée'),
        info.cost !== null && el('span', { class: 'extra' }, `≈ ${eur.format(info.cost)}`),
      )),
    );
  }));

  const totals = orderTotals(costs);
  rxRecapTotal.hidden = totals.total === null;
  if (totals.total !== null) {
    rxRecapTotal.textContent = `Total estimé ≈ ${eur.format(totals.total)}${totals.priced < totals.count ? ` (${totals.priced} ligne${totals.priced > 1 ? 's' : ''} sur ${totals.count} avec un prix)` : ''}`;
  }

  const notes = [];
  if (!state.weight) notes.push('Saisissez le poids de l’animal.');
  if (incomplete) notes.push(`${countText(incomplete, 'ligne')} à compléter.`);
  if (suggested) notes.push(`${countText(suggested, 'ligne')} avec une posologie Med’Vet non confirmée.`);
  rxRecapNote.textContent = notes.join(' ');
  rxRecapNote.hidden = !notes.length;
  const done = rxDoneLines().length;
  rxCopyBtn.disabled = !state.weight || !done;
  rxPrintBtn.disabled = !state.weight || !done;
}

// Le texte de l'ordonnance, à coller dans un message ou un logiciel de gestion.
function recapText() {
  const head = [
    'Ordonnance',
    state.petName,
    state.species !== 'all' && SPECIES_LABEL[state.species],
    state.weight && `${fmtWeight.format(state.weight)} kg`,
    new Date().toLocaleDateString('fr-FR'),
  ].filter(Boolean).join(' · ');
  const body = rxDoneLines().map(({ drug, info }, i) => {
    const give = info.phrase ? ` À remettre : ${info.phrase}.` : '';
    const note = drug.note ? ` ${drug.note}` : '';
    return `${i + 1}. ${info.label} : ${info.sentence}.${give}${note}`;
  });
  return [head, ...body].join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;top:0' }, text);
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* copie refusée */ }
    area.remove();
    return ok;
  }
}

// Ce qui mérite un second regard avant d'imprimer ; texte vide quand tout est en ordre.
function printConcerns() {
  const lines = state.rx.order;
  const incomplete = lines.length - rxDoneLines().length;
  const suggested = lines.filter((l) => posologyStatus(l.drug) === 'suggested').length;
  const concerns = [];
  if (incomplete) concerns.push(`${countText(incomplete, 'ligne')} incomplète${incomplete > 1 ? 's ne seront' : ' ne sera'} pas imprimée${incomplete > 1 ? 's' : ''}.`);
  if (suggested) concerns.push(`${countText(suggested, 'ligne')} ${suggested > 1 ? 'ont' : 'a'} une posologie proposée par Med’Vet, pas encore confirmée.`);
  return concerns.join('\n');
}

// Remplit la feuille d'ordonnance (visible à l'impression seulement). Appelé aussi par Ctrl+P.
function fillRxSheet() {
  const sheet = document.getElementById('rx-sheet');
  const now = new Date();
  const brand = document.querySelector('#sheet-head .sh-brand').cloneNode(true);
  const date = brand.querySelector('.sh-date');
  date.removeAttribute('id');
  date.textContent = now.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  const done = rxDoneLines();
  const totals = orderTotals(done.map((x) => x.info.cost));
  sheet.replaceChildren(...[
    brand,
    el('h2', { class: 'sh-title' }, 'Ordonnance'),
    el('dl', { class: 'sh-fields' },
      el('div', { class: 'sh-name' }, el('dt', {}, 'Nom'), el('dd', {}, state.petName)),
      el('div', {}, el('dt', {}, 'Espèce'), el('dd', {}, state.species === 'all' ? '' : speciesText())),
      el('div', {}, el('dt', {}, 'Poids'), el('dd', {}, state.weight ? `${fmtWeight.format(state.weight)} kg` : '')),
    ),
    el('ol', { class: 'rs-list' }, done.map(({ drug, info }) => {
      const f = info.format;
      const gtin = info.market ? gtinCodes(boxOf(f).gtin)[0] : null;
      return el('li', { class: 'rs-line' },
        el('p', { class: 'rs-name' }, info.label),
        el('p', { class: 'rs-intake' }, info.sentence),
        info.phrase && el('p', { class: 'rs-give' }, `À remettre : ${info.phrase}`),
        info.market && el('p', { class: 'rs-detail' }, [f.form?.toLowerCase(), formatPackText(f), gtin && `GTIN ${gtin}`].filter(Boolean).join(' · ')),
        drug.note && el('p', { class: 'rs-note' }, drug.note),
      );
    })),
    totals.total !== null && totals.priced === totals.count && el('p', { class: 'rs-total' }, `Total estimé ≈ ${eur.format(totals.total)}`),
    el('p', { class: 'sh-meta' }, 'Quantités calculées par l’appli d’après le poids : à vérifier avant de remettre.'),
    el('p', { class: 'rs-sign' }, 'Signature et cachet du vétérinaire'),
  ].filter(Boolean));

  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const kg = state.weight ? ` ${fmtWeight.format(state.weight)} kg` : '';
  document.title = `Ordonnance ${state.petName || 'patient'}${kg} ${stamp}`;
}

// --- construction de la vue -----------------------------------------------------------------------

function rxPrefField(label, key, options, format) {
  const node = el('select', { class: 'pick' },
    options.map(([value, text]) => el('option', { value, selected: String(value) === String(state.rx.prefs[key]) }, text)));
  node.addEventListener('change', () => {
    state.rx.prefs[key] = format ? format(node.value) : node.value;
    saveRxPrefs();
    syncRxPrefs();
    renderRx();
  });
  return el('label', { class: 'pref-field' }, el('span', { class: 'field-label' }, label), node);
}

let rxPrefsNow;
const DISPENSE_LABEL = { box: 'boîte entière', blister: 'plaquette ou flacon entier', unit: 'à l’unité' };
function syncRxPrefs() {
  const p = state.rx.prefs;
  rxPrefsNow.textContent = `±${Math.round(p.tol * 100)} % · ${DISPENSE_LABEL[p.dispense]}`;
}

function buildRx() {
  rxBuilt = true;

  // patient : le nom est le même que celui de la fiche d'hospitalisation
  rxNameInput = el('input', { id: 'rx-pet', class: 'text', type: 'text', autocomplete: 'off', maxlength: 60, placeholder: 'Facultatif', value: state.petName });
  rxNameInput.addEventListener('input', () => {
    state.petName = rxNameInput.value.trim();
    petInput.value = rxNameInput.value;
  });

  // durée par défaut du traitement : saisie libre ou raccourcis ; chaque ligne peut avoir la sienne
  rxDaysInput = el('input', { id: 'rx-days', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 3, placeholder: '0' });
  rxDaysChips = DAY_CHOICES.map((n) => el('button', { type: 'button', class: 'dchip', 'aria-pressed': 'false', onclick: () => {
    state.rx.days = state.rx.days === n ? null : n;
    syncRxDays();
    renderRx();
  } }, String(n)));
  syncRxDays = () => {
    const days = state.rx.days;
    if (days !== null || document.activeElement !== rxDaysInput) rxDaysInput.value = days === null ? '' : String(days);
    rxDaysInput.setAttribute('aria-invalid', 'false');
    rxDaysChips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(DAY_CHOICES[i] === days)));
  };
  rxDaysInput.addEventListener('input', () => {
    const text = rxDaysInput.value.trim();
    const n = /^\d{1,3}$/.test(text) ? Number(text) : null;
    state.rx.days = n > 0 ? n : null;
    rxDaysInput.setAttribute('aria-invalid', String(text !== '' && !state.rx.days));
    rxDaysChips.forEach((chip, i) => chip.setAttribute('aria-pressed', String(DAY_CHOICES[i] === state.rx.days)));
    renderRx();
  });
  rxDaysInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') rxDaysInput.blur(); });

  rxPrefsNow = el('span', { class: 'prefs-now' });
  const prefs = el('details', { class: 'prefs rx-prefs' },
    el('summary', {}, 'Réglages du calcul ', rxPrefsNow),
    el('div', { class: 'prefs-body' },
      el('div', { class: 'rx-prefs-grid' },
        rxPrefField('Articles proposés', 'source', [['medvet', 'Tout Med’Vet'], ['stock', 'Mon stock (dosages saisis)']]),
        rxPrefField('Tolérance sur la dose', 'tol', TOLERANCES.map((t) => [t, `±${Math.round(t * 100)} %`]), Number),
        rxPrefField('Découpe maximale', 'split', [['none', 'Comprimés entiers'], ['half', 'Moitiés'], ['quarter', 'Quarts']]),
        rxPrefField('Seringue (liquides)', 'syringe', SYRINGES.map((v) => [v, `graduée à ${fmtMl.format(v)} mL`]), Number),
        rxPrefField('Remise au client', 'dispense', [['box', 'Boîte entière'], ['blister', 'Plaquette ou flacon entier'], ['unit', 'Comprimés à l’unité (flacon entier pour un liquide)']]),
        rxPrefField('Classement des dosages', 'rank', [['waste', 'Moins de reste'], ['cost', 'Moins cher'], ['pills', 'Moins de comprimés'], ['exact', 'Dose la plus juste']]),
      ),
      el('p', { class: 'prefs-note' }, `La tolérance est l’écart accepté avec la dose cible (une dose max n’est jamais dépassée). Un comprimé non sécable n’est jamais coupé. Au plus ${MAX_PER_INTAKE} comprimés par prise. Les liquides se donnent à la graduation de la seringue choisie, en flacons entiers. « Moins cher » classe d’abord les articles dont le prix de la boîte est saisi (dans les détails d’une ligne) : sans prix, un article passe après.`),
    ),
  );
  syncRxPrefs();

  // ajout d'un médicament : ma bibliothèque, ou une recherche Med'Vet, ou une saisie libre
  let search;
  rxQuickAdd = el('div', { class: 'qchips' });
  rxAddPanel = el('div', { class: 'rx-add', hidden: true });
  rxProtoPanel = el('div', { class: 'rx-add', hidden: true });
  closeRxPanels = () => {
    rxAddPanel.hidden = true;
    rxProtoPanel.hidden = true;
    rxAddButton.setAttribute('aria-expanded', 'false');
    rxProtoButton.setAttribute('aria-expanded', 'false');
  };
  const togglePanel = (panel, button, other, otherButton) => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    other.hidden = true;
    otherButton.setAttribute('aria-expanded', 'false');
  };
  rxAddButton = button('Ajouter un médicament', () => {
    togglePanel(rxAddPanel, rxAddButton, rxProtoPanel, rxProtoButton);
    if (!search) {
      search = rxSearch(addDrugFromProduct);
      rxAddPanel.replaceChildren(
        el('h3', { class: 'rx-sub' }, 'Dans ma bibliothèque'),
        rxQuickAdd,
        el('h3', { class: 'rx-sub' }, 'Nouveau médicament depuis Med’Vet'),
        search.root,
        button('Saisir à la main', addBlankDrug, 'btn-small'),
      );
    }
    if (!rxAddPanel.hidden) search.focus();
  }, 'btn-primary');
  rxAddButton.setAttribute('aria-expanded', 'false');
  rxProtoButton = button('Protocoles', () => {
    togglePanel(rxProtoPanel, rxProtoButton, rxAddPanel, rxAddButton);
  });
  rxProtoButton.setAttribute('aria-expanded', 'false');

  rxProtoList = el('ul', { class: 'rx-lib' });
  rxProtoMsg = el('p', { class: 'prefs-note', role: 'status' });
  rxProtoSave = button('Enregistrer l’ordonnance comme protocole', () => { rxProtoMsg.textContent = saveOrderAsProtocol(); }, 'btn-small');
  rxProtoPanel.replaceChildren(
    el('h3', { class: 'rx-sub' }, 'Protocoles de la clinique'),
    rxProtoList,
    rxProtoSave,
    rxProtoMsg,
  );

  // récapitulatif
  rxRecapRows = el('div', { class: 'rx-recap-rows' });
  rxRecapTotal = el('p', { class: 'rx-total', hidden: true });
  rxRecapNote = el('p', { class: 'rx-hint', hidden: true });
  rxRecapMsg = el('p', { class: 'prefs-note', role: 'status' });
  rxCopyBtn = button('Copier le texte', async () => { rxSay(await copyText(recapText()) ? 'Texte copié.' : 'Copie impossible : sélectionnez le texte à la main.'); });
  rxPrintBtn = button('Imprimer l’ordonnance', () => {
    const concerns = printConcerns();
    if (concerns && !confirm(`${concerns}\n\nImprimer quand même ?`)) return;
    fillRxSheet();
    window.print();
  }, 'btn-primary');
  rxRecapEl = el('section', { class: 'rx-recap', 'aria-labelledby': 'rx-recap-title', hidden: true },
    el('h3', { class: 'rx-sub', id: 'rx-recap-title' }, 'Récapitulatif à remettre'),
    rxRecapRows,
    rxRecapTotal,
    rxRecapNote,
    el('div', { class: 'rx-actions' }, rxCopyBtn, rxPrintBtn),
    rxRecapMsg,
  );

  // bibliothèque et réglages : repliés
  rxLibraryList = el('ul', { class: 'rx-lib' });
  rxLibrarySummary = el('summary', {}, 'Bibliothèque et réglages');
  const library = el('details', { class: 'rx-library' },
    rxLibrarySummary,
    el('div', { class: 'rx-library-body' },
      el('h3', { class: 'rx-sub' }, 'Mes médicaments'),
      rxLibraryList,
      prefs,
    ),
  );

  // panneau d'édition d'un médicament : tiroir à droite sur grand écran, plein écran sur téléphone
  rxDialogTitle = el('h2', { id: 'rx-dialog-title', class: 'rx-dialog-title' });
  rxDialogBody = el('div', { class: 'rx-dialog-body' });
  rxDialog = el('dialog', { class: 'rx-dialog', 'aria-labelledby': 'rx-dialog-title' },
    el('div', { class: 'rx-dialog-head' }, rxDialogTitle, button('Terminé', closeRxEditor, 'btn-primary btn-small')),
    rxDialogBody,
  );
  rxDialog.addEventListener('close', () => { rxDialogBody.replaceChildren(); renderRx(); });
  rxDialog.addEventListener('click', (e) => { if (e.target === rxDialog) closeRxEditor(); });
  document.body.append(rxDialog);

  rxOrderEl = el('div', { class: 'rx-list' });
  rxOrderEmpty = el('p', { class: 'empty' }, 'L’ordonnance est vide. Ajoutez un médicament de votre bibliothèque, un protocole, ou cherchez-le dans Med’Vet : saisissez sa posologie une seule fois, elle sera gardée pour les prochains patients.');
  rxOrderCount = el('span', { class: 'rx-count' });
  rxRoot.replaceChildren(
    el('div', { class: 'rx-top' },
      field('Nom de l’animal', rxNameInput, 'rx-patient'),
      el('div', { class: 'rx-days' },
        el('label', { class: 'days-box', for: 'rx-days' },
          el('span', { class: 'days-label' }, 'Durée par défaut'),
          rxDaysInput,
          el('span', { class: 'days-unit' }, 'jours'),
        ),
        el('div', { class: 'dchips', role: 'group', 'aria-label': 'Durées courantes' }, rxDaysChips),
      ),
    ),
    el('div', { class: 'rx-bar' }, rxAddButton, rxProtoButton),
    rxAddPanel,
    rxProtoPanel,
    el('h3', { class: 'rx-sub rx-order-title' }, 'Ordonnance en cours ', rxOrderCount),
    rxOrderEmpty,
    rxOrderEl,
    rxRecapEl,
    library,
  );
  syncRxDays();
}

function renderRx() {
  if (!rxBuilt) buildRx();
  ensureRxIndex();
  const cards = state.rx.order.map((l) => rxCard(l.drug));
  cards.forEach((card) => card.refresh({ quiet: true }));
  rxOrderEl.replaceChildren(...cards.map((card) => card.root));
  rxOrderEmpty.hidden = cards.length > 0;
  rxOrderCount.textContent = cards.length ? `(${cards.length})` : '';
  renderLibrary();
  renderProtocols();
  renderRecap();
}

// --- passage d'une vue à l'autre ---------------------------------------------------------------

function setView(view) {
  state.view = view;
  document.body.dataset.view = view;
  main.hidden = view === 'rx';
  rxRoot.hidden = view !== 'rx';
  pageHeading.textContent = HEADINGS[view];
  if (view === 'rx') renderRx();
  else render();
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('input[name="view"]').forEach((radio) => {
  radio.addEventListener('change', () => { if (radio.checked) setView(radio.value); });
});

// --- thème : clair par défaut, sombre au choix (mémorisé) -------------------

function applyTheme(theme) {
  if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
  themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
  document.querySelector('meta[name="theme-color"]').content = THEME_COLOR[theme];
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  storeSet(THEME_KEY, next);
});
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

document.querySelectorAll('input[name="species"]').forEach((radio) => {
  radio.checked = radio.value === state.species;
  radio.addEventListener('change', () => {
    state.species = radio.value;
    storeSet(SPECIES_KEY, state.species);
    renderCurrent();
  });
});

editToggle.addEventListener('click', () => setEditing(!state.editing));

function renderCurrent() {
  if (state.view === 'rx') renderRx();
  else if (!state.editing) renderView();
}

function render() {
  if (state.editing) {
    renderEdit();
  } else {
    renderView();
    buildPrintChips();
  }
}

render();
if (matchMedia('(pointer: fine)').matches) weightInput.focus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
