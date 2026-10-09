import { DEFAULT_SECTIONS } from './data.js';
import { ICONS } from './section-icons.js';
import { ANIMALS } from './animals.js';
import {
  plan, tabletText, tabletSpeech, searchIndex, packText, productName, formatFromProduct, drugFromProduct,
  normalizeDrug, normalizeFormat, normalizePrefs, fold, TOLERANCES, MAX_PER_INTAKE,
  substanceOf, listSubstances, brandsOf, marketFormats, formatPackText, gtinCodes, isLiquid, SYRINGES,
} from './rx.js';

const STORE_KEY = 'injection:sections:v1';
const SPECIES_KEY = 'injection:species';
const SPECIES_LABEL = { CN: 'Chien', CT: 'Chat' };
const UNITS = ['mL', 'mL/h'];
const WEIGHT_WARN_ABOVE = 100;
const PREFS_KEY = 'injection:prefs';
const RX_KEY = 'injection:rx:v1';
const RX_PREFS_KEY = 'injection:rx-prefs:v1';
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

// Ordonnance : le catalogue des médicaments remis par la clinique (comprimés), enregistré sur l'appareil.
function loadRx() {
  try {
    const parsed = JSON.parse(storeGet(RX_KEY) || '[]');
    if (Array.isArray(parsed)) return parsed.filter((d) => d && typeof d === 'object').map(normalizeDrug);
  } catch { /* données corrompues : catalogue vide */ }
  return [];
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
    drugs: loadRx(),
    prefs: loadRxPrefs(),
    days: null, // durée du traitement : propre au patient en cours, jamais mémorisée
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

  // un poids vidé = patient suivant : la durée du traitement précédent ne doit pas rester
  if (text === '') {
    state.rx.days = null;
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
window.addEventListener('beforeprint', fillSheet);
window.addEventListener('afterprint', () => { document.title = pageTitle; });

petInput.addEventListener('input', () => { state.petName = petInput.value.trim(); });
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
const HEADINGS = { doses: pageHeading.textContent, rx: 'Ordonnance : version à remettre' };
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
const unitText = (format) => (isLiquid(format) ? 'mL' : format.unit);

let rxBuilt = false;
let rxListEl;
let rxDaysInput;
let rxDaysChips;
let rxAddPanel;
let rxAddButton;
const rxCards = new Map(); // médicament -> { root, refresh, open }
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
  if (!isNum(drug.min) || !drug.perDay) return 'Posologie à renseigner';
  const range = isNum(drug.max) && drug.max > drug.min
    ? `${fmtMg.format(drug.min)} – ${fmtMg.format(drug.max)}`
    : fmtMg.format(drug.min);
  const prises = countText(drug.perDay, 'prise');
  const kg = drug.substance?.includes('+') ? 'mg/kg d’association' : 'mg/kg';
  return drug.basis === 'day' ? `${range} ${kg} par jour, en ${prises}` : `${range} ${kg} par prise, ${prises} par jour`;
}

// --- résultat d'un médicament --------------------------------------------------------------

// Les articles parmi lesquels choisir : tous ceux de la substance dans Med'Vet (espèce du patient, marque
// éventuelle), ou, sans substance ou en mode « Mon stock », les dosages saisis à la main.
function candidatesFor(drug) {
  const { source, dispense } = state.rx.prefs;
  if (source !== 'medvet' || !drug.substance) return { formats: drug.formats, market: false };
  if (rxIndexFailed) return { formats: drug.formats, market: false, failed: true };
  if (!rxData) return { loading: true };
  const species = state.species !== 'all' ? state.species : drug.species;
  return { formats: marketFormats(rxData.p, drug.substance, { species, brand: drug.brand, dispense }), market: true, species };
}

// GTIN de l'article, à copier d'un toucher. Plusieurs tailles de boîte regroupées : un code par boîte.
function gtinNode(f) {
  const multi = f.boxes?.length > 1;
  const boxes = multi ? f.boxes : [{ blisters: f.blisters, gtin: f.gtin }];
  const items = boxes.flatMap((b) => gtinCodes(b.gtin).map((code) => ({ b, code })));
  if (!items.length) return null;
  return el('p', { class: 'rx-gtin' }, items.map(({ b, code }) => el('span', {},
    multi ? `${countText(b.blisters, isLiquid(f) ? 'flacon' : 'plaquette')} : ` : '',
    el('span', { class: 'rx-gtin-code' }, `GTIN ${code}`),
  )));
}

// Sous le nom de l'article : forme, conditionnement, espèces, et lien vers sa fiche Med'Vet.
function articleLine(f) {
  const species = f.species?.split(',').map((c) => SPECIES_LABEL[c]).join(' et ');
  const bits = [f.form?.toLowerCase(), isLiquid(f) && `${fmtMg.format(f.conc)} mg/mL`, formatPackText(f), species, f.assoc && `association : ${fmtMg.format(f.mg)} mg par ${cpWord(f)}`].filter(Boolean);
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
  const label = days ? `À remettre · ${countText(days, 'jour')}` : 'À remettre';
  let big = '–';
  let unit = '';
  const bits = [];
  if (!s) {
    bits.push('Choisissez la durée du traitement.');
  } else if (!s.packs) {
    bits.push(isLiquid(o.format) ? `${fmtMl.format(s.total)} mL à donner` : `${tabletText(s.totalQuarters / 4)} ${o.format.unit} à donner`, 'conditionnement non renseigné');
  } else if (s.kind === 'liquid') {
    big = String(s.count);
    if (s.unit === 'box') {
      unit = s.count > 1 ? 'boîtes' : 'boîte';
      bits.push(s.bottles > 1 ? `${s.bottles} flacons de ${fmtMl.format(s.bottle)} mL` : `un flacon de ${fmtMl.format(s.bottle)} mL`);
    } else {
      unit = s.count > 1 ? 'flacons' : 'flacon';
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
    el('span', { class: 'name' }, 'Par prise'),
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
  const parts = [`${amountText(o)} ${unitText(o.format)} par prise`];
  if (s?.packs) {
    const what = s.unit === 'box' ? countText(s.count, 'boîte') : s.unit === 'blister' ? countText(s.count, 'plaquette')
      : s.unit === 'bottle' ? countText(s.count, 'flacon') : `${s.count} ${o.format.unit}`;
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

function rxResult(drug, openEditor) {
  const days = state.rx.days;
  const prefs = state.rx.prefs;
  const c = candidatesFor(drug);
  if (c.loading) {
    ensureRxIndex();
    return [el('p', { class: 'rx-hint' }, 'Chargement de la base Med’Vet…')];
  }
  const r = plan({ ...drug, formats: c.formats }, { weight: state.weight, days, prefs });
  if (r.status === 'drug') return [rxNote('Renseignez la dose (mg/kg) et le nombre de prises par jour.', openEditor, 'Renseigner')];
  if (r.status === 'formats') {
    let text;
    if (c.market) {
      const who = SPECIES_LABEL[c.species]?.toLowerCase();
      text = `Aucun article Med’Vet de ${drug.substance.toLowerCase()}${who ? ` pour ${who}` : ''}${drug.brand ? ` en marque ${drug.brand}` : ''}.`;
    } else if (c.failed) {
      text = 'La base Med’Vet n’est pas disponible : seuls les dosages saisis à la main peuvent servir.';
    } else {
      text = r.skipped ? 'Indiquez les mg par comprimé du dosage.' : 'Choisissez la substance pour chercher dans tout Med’Vet, ou ajoutez un dosage.';
    }
    return [rxNote(text, openEditor, 'Modifier')];
  }
  if (r.status === 'weight') return [el('p', { class: 'rx-hint' }, 'Saisissez le poids de l’animal.')];

  const [best, ...others] = r.options;
  const out = [];
  if (!best.ok) {
    out.push(el('p', { class: 'rx-warn', role: 'alert' },
      `Aucun ${c.market ? 'article' : 'dosage'} ne tombe à ±${Math.round(prefs.tol * 100)} % de la dose cible. Le plus proche donne ${signedPercent(best.dev)} : à ne pas remettre sans vérification.${c.market ? ' Autoriser les quarts de comprimé ou élargir la tolérance (Réglages) peut ouvrir d’autres choix.' : ''}`));
  }
  out.push(
    el('p', { class: 'rx-pick' },
      el('span', { class: 'rx-label' }, best.ok ? (c.market ? 'Article à donner' : 'Version à donner') : 'Plus proche'),
      el('span', { class: 'rx-vname' }, formatLabel(drug, best.format)),
    ),
    c.market && articleLine(best.format),
    c.market && gtinNode(best.format),
    c.market && equivalentsNode(best),
    intakeLine(best, r.target),
    supplyLines(best, days),
  );
  if (r.skipped && !c.market) out.push(el('p', { class: 'rx-hint' }, `${countText(r.skipped, 'dosage')} sans mg par comprimé : ignoré${r.skipped > 1 ? 's' : ''}.`));
  if (!c.market && prefs.source === 'medvet' && !drug.substance) out.push(el('p', { class: 'rx-hint' }, 'Choisissez la substance (Modifier) pour chercher dans tout Med’Vet.'));

  // Med'Vet : on garde les meilleurs articles dans la tolérance ; sinon les plus proches
  const okOthers = others.filter((o) => o.ok).length;
  const shown = !c.market ? others : best.ok ? others.filter((o) => o.ok).slice(0, 8) : others.slice(0, 3);
  if (shown.length) {
    out.push(el('details', { class: 'rx-alt' },
      el('summary', {}, c.market ? `Autres articles (${shown.length}${okOthers > shown.length ? ` sur ${okOthers}` : ''})` : `Autres dosages (${shown.length})`),
      el('ul', {}, shown.map((o) => altRow(drug, o, days, c.market))),
    ));
  }
  return out.filter(Boolean);
}

// --- une carte par médicament : le résultat se redessine, l'éditeur garde ses champs ------------

function rxCard(drug) {
  const known = rxCards.get(drug);
  if (known) return known;

  const title = el('h2', { class: 'rx-name' });
  const chip = el('span', { class: 'chip' });
  const toggle = el('button', { type: 'button', class: 'btn btn-ghost btn-small', 'aria-expanded': 'false' }, 'Modifier');
  const poso = el('p', { class: 'rx-poso' });
  const result = el('div', { class: 'rx-result' });
  const editor = el('div', { class: 'rx-editor', hidden: true });
  const root = el('section', { class: 'rx-card' },
    el('div', { class: 'rx-head' }, el('div', { class: 'rx-title' }, title, chip), toggle),
    poso, result, editor,
  );

  let built = false;
  const refresh = () => {
    title.textContent = drug.name || 'Sans nom';
    chip.textContent = SPECIES_LABEL[drug.species] ?? '';
    chip.className = `chip chip-${drug.species}`;
    chip.hidden = !drug.species;
    const market = state.rx.prefs.source === 'medvet' && drug.substance;
    poso.replaceChildren(...[
      posoText(drug),
      market && el('span', {}, `Med’Vet : ${drug.substance.toLowerCase()}, ${drug.brand ? `marque ${drug.brand}` : 'toutes marques'}`),
      drug.note && el('span', { class: 'rx-note-text' }, drug.note),
      !market && drug.link && el('a', { class: 'rx-link', href: drug.link, target: '_blank', rel: 'noopener' }, 'Fiche Med’Vet'),
    ].filter(Boolean));
    result.replaceChildren(...rxResult(drug, () => open(true)));
  };
  const open = (on) => {
    if (on && !built) { buildRxEditor(drug, editor, refresh, () => open(false)); built = true; }
    editor.hidden = !on;
    toggle.textContent = on ? 'Terminé' : 'Modifier';
    toggle.setAttribute('aria-expanded', String(on));
    if (on) editor.querySelector('input, select')?.focus({ preventScroll: true });
  };
  toggle.addEventListener('click', () => open(editor.hidden));

  const card = { root, refresh, open };
  rxCards.set(drug, card);
  refresh();
  return card;
}

// --- édition d'un médicament -----------------------------------------------------------------

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

function buildRxEditor(drug, host, refresh, close) {
  const commit = () => { saveRx(); refresh(); };
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
    const labels = rxData ? listSubstances(rxData.p).map((x) => x.label) : [];
    if (drug.substance && !labels.includes(drug.substance)) labels.push(drug.substance);
    substanceSel.replaceChildren(
      el('option', { value: '' }, 'Aucune : mes dosages seulement'),
      ...labels.map((label) => el('option', { value: label, selected: label === drug.substance }, label)),
    );
  };
  const fillBrands = () => {
    const brands = rxData && drug.substance ? brandsOf(rxData.p, drug.substance) : [];
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

  host.replaceChildren(
    el('div', { class: 'rx-form' },
      field('Nom', textInput(drug.name, (v) => { drug.name = v; }, commit), 'wide'),
      field('Substance (Med’Vet)', substanceSel, 'wide'),
      field('Marque', brandSel, 'wide'),
      field('Espèce', select([['', 'Chien et chat'], ['CN', 'Chien'], ['CT', 'Chat']], drug.species || '', (v) => { drug.species = v || undefined; }, commit)),
      field('Prises par jour', select(
        [['', '–'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']],
        drug.perDay ? String(drug.perDay) : '',
        (v) => { drug.perDay = v ? Number(v) : null; },
        commit,
      )),
      field('Dose (mg/kg)', numInput(drug.min, (v) => { drug.min = v; }, true, commit)),
      field('Dose max (mg/kg)', numInput(drug.max, (v) => { drug.max = v ?? undefined; }, false, commit)),
      field('Dose donnée', select([['intake', 'par prise'], ['day', 'par jour']], drug.basis, (v) => { drug.basis = v; }, commit), 'wide'),
      field('Note', textInput(drug.note, (v) => { drug.note = v; }, commit), 'wide'),
    ),
    el('p', { class: 'rx-help' }, 'La dose se lit sur la fiche du médicament. « Par jour » est divisée par le nombre de prises.'),
    el('details', { class: 'rx-stock', open: !drug.substance },
      el('summary', {}, 'Mes dosages (si pas de substance, ou en mode « Mon stock »)'),
      formatsHost,
    el('div', { class: 'rx-actions' },
      button('Ajouter depuis Med’Vet', () => {
        searchHost.hidden = !searchHost.hidden;
        if (!search) { search = rxSearch(addFound); searchHost.replaceChildren(search.root); }
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
    ),
    el('div', { class: 'rx-actions rx-end' },
      button('Supprimer ce médicament', () => {
        if (!confirm(`Supprimer « ${drug.name || 'Sans nom'} » du catalogue ?`)) return;
        state.rx.drugs.splice(state.rx.drugs.indexOf(drug), 1);
        rxCards.delete(drug);
        saveRx();
        renderRx();
      }, 'btn-danger btn-small'),
      button('Terminé', close, 'btn-primary btn-small'),
    ),
  );
}

// --- recherche dans l'index Med'Vet ------------------------------------------------------------

function rxSearch(onPick) {
  const input = el('input', {
    type: 'search',
    class: 'text',
    autocomplete: 'off',
    placeholder: 'Nom ou principe actif (ex. Zitac, méloxicam)',
    'aria-label': 'Rechercher un médicament dans Med’Vet',
  });
  const status = el('p', { class: 'prefs-note', role: 'status' }, 'Chargement de la base Med’Vet…');
  const hits = el('div', { class: 'rx-hits' });
  const root = el('div', { class: 'rx-search' }, input, status, hits);
  let data = null;
  let message = '';

  const run = () => {
    if (!data) return;
    const query = input.value.trim();
    if (query.length < 2) {
      hits.replaceChildren();
      status.textContent = message || `Base Med’Vet du ${data.date} : formes orales pour chien et chat (comprimés, gélules, liquides). Posologies non incluses.`;
      return;
    }
    const found = searchIndex(data.p, query, 15);
    const count = `${countText(found.length, 'produit')}${found.length === 15 ? ' (affinez la recherche)' : ''}`;
    status.textContent = message || (found.approx ? `Aucun résultat exact : ${count} proche${found.length > 1 ? 's' : ''} de « ${query} »` : found.length ? count : 'Aucun résultat : ajoutez-le à la main.');
    message = '';
    hits.replaceChildren(...found.map((product) => hit(product)));
  };

  const hit = (product) => {
    const actives = product.u === 'mL'
      ? `${product.a[0][0].replace(/\s*\(.*\)/, '').toLowerCase()} ${String(product.c).replace('.', ',')} mg/mL`
      : product.a.map((a) => `${a[0].replace(/\s*\(.*\)/, '').toLowerCase()}${a[1] != null ? ` ${String(a[1]).replace('.', ',')} ${a[2]}` : ''}`).join(' + ');
    const species = product.s.split(',').map((c) => SPECIES_LABEL[c]).join(', ');
    return el('div', { class: 'rx-hit' },
      el('p', { class: 'rx-hit-name' }, productName(product), el('span', { class: 'rx-hit-meta' }, `${actives} · ${species}`)),
      (product.m ?? product.c) == null && el('p', { class: 'rx-hint' }, 'Dosage par comprimé à saisir après l’ajout.'),
      el('ul', { class: 'rx-packs' }, product.k.map((pack) => el('li', {},
        el('div', {},
          el('span', {}, packText(pack, product.u)),
          pack[3] && el('span', { class: 'rx-gtin rx-gtin-code' }, gtinCodes(pack[3]).map((c) => `GTIN ${c}`).join(' · ')),
        ),
        button('Ajouter', () => { message = onPick(product, pack); run(); }, 'btn-small'),
      ))),
    );
  };

  input.addEventListener('input', run);
  loadRxIndex().then((loaded) => { data = loaded; run(); }).catch(() => {
    input.hidden = true;
    status.textContent = 'La recherche Med’Vet n’est pas disponible : ajoutez le médicament à la main.';
  });
  return { root, focus: () => input.focus() };
}

// --- ajout d'un médicament au catalogue ---------------------------------------------------------

// Le dosage (ou article) saisi correspond-il à ce conditionnement du produit ?
function sameFormat(f, product, pack) {
  if (f.name !== productName(product)) return false;
  return product.u === 'mL' ? f.volume === pack[1] && f.bottles === pack[0] : f.perBlister === pack[1] && f.blisters === (pack[0] ?? 1);
}

function addDrugFromProduct(product, pack) {
  const substance = substanceOf(product);
  const brand = fold(product.b);
  const existing = state.rx.drugs.find((d) => (substance ? d.substance === substance.label : fold(d.name) === brand));
  if (existing) {
    const f = formatFromProduct(product, pack);
    const exists = existing.formats.some((g) => sameFormat(g, product, pack));
    if (!exists && !substance) existing.formats.push(f);
    saveRx();
    showRxCard(existing);
    return `« ${existing.name} » est déjà dans le catalogue.`;
  }
  const drug = drugFromProduct(product, pack);
  state.rx.drugs.push(drug);
  saveRx();
  showRxCard(drug);
  return `« ${drug.name} » ajouté : renseignez maintenant sa posologie.`;
}

// Affiche la carte, ouvre son éditeur et la ramène à l'écran.
function showRxCard(drug) {
  if (state.species !== 'all' && drug.species && drug.species !== state.species) {
    state.species = 'all';
    storeSet(SPECIES_KEY, 'all');
    document.querySelector('input[name="species"][value="all"]').checked = true;
  }
  renderRx();
  const card = rxCard(drug);
  card.open(true);
  card.root.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}

function addBlankDrug() {
  const drug = normalizeDrug({ name: '', formats: [{}] });
  state.rx.drugs.push(drug);
  saveRx();
  showRxCard(drug);
  rxCard(drug).root.querySelector('.rx-form input')?.focus();
}

// --- construction de la vue -----------------------------------------------------------------

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

  // durée du traitement : saisie libre ou raccourcis
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
    el('summary', {}, 'Réglages ', rxPrefsNow),
    el('div', { class: 'prefs-body' },
      el('div', { class: 'rx-prefs-grid' },
        rxPrefField('Articles proposés', 'source', [['medvet', 'Tout Med’Vet'], ['stock', 'Mon stock (dosages saisis)']]),
        rxPrefField('Tolérance sur la dose', 'tol', TOLERANCES.map((t) => [t, `±${Math.round(t * 100)} %`]), Number),
        rxPrefField('Découpe maximale', 'split', [['none', 'Comprimés entiers'], ['half', 'Moitiés'], ['quarter', 'Quarts']]),
        rxPrefField('Seringue (liquides)', 'syringe', SYRINGES.map((v) => [v, `graduée à ${fmtMl.format(v)} mL`]), Number),
        rxPrefField('Remise au client', 'dispense', [['box', 'Boîte entière'], ['blister', 'Plaquette ou flacon entier'], ['unit', 'Comprimés à l’unité (flacon entier pour un liquide)']]),
        rxPrefField('Classement des dosages', 'rank', [['waste', 'Moins de reste'], ['cost', 'Moins cher'], ['pills', 'Moins de comprimés'], ['exact', 'Dose la plus juste']]),
      ),
      el('p', { class: 'prefs-note' }, `La tolérance est l’écart accepté avec la dose cible (une dose max n’est jamais dépassée). Un comprimé non sécable n’est jamais coupé. Au plus ${MAX_PER_INTAKE} comprimés par prise. Les liquides se donnent à la graduation de la seringue choisie, en flacons entiers. « Moins cher » demande le prix de la boîte, saisi sur un dosage de « Mon stock » : sur les articles Med’Vet, il revient à « moins de reste ».`),
    ),
  );
  syncRxPrefs();

  // ajout d'un médicament : recherche Med'Vet ou saisie libre
  let search;
  rxAddPanel = el('div', { class: 'rx-add', hidden: true });
  rxAddButton = button('Ajouter un médicament', () => {
    rxAddPanel.hidden = !rxAddPanel.hidden;
    rxAddButton.setAttribute('aria-expanded', String(!rxAddPanel.hidden));
    if (!search) {
      search = rxSearch(addDrugFromProduct);
      rxAddPanel.replaceChildren(
        el('h3', { class: 'rx-sub' }, 'Nouveau médicament'),
        search.root,
        button('Saisir à la main', addBlankDrug, 'btn-small'),
      );
    }
    if (!rxAddPanel.hidden) search.focus();
  }, 'btn-primary');
  rxAddButton.setAttribute('aria-expanded', 'false');

  rxListEl = el('div', { class: 'rx-list' });
  rxRoot.replaceChildren(
    el('div', { class: 'rx-top' },
      el('div', { class: 'rx-days' },
        el('label', { class: 'days-box', for: 'rx-days' },
          el('span', { class: 'days-label' }, 'Durée'),
          rxDaysInput,
          el('span', { class: 'days-unit' }, 'jours'),
        ),
        el('div', { class: 'dchips', role: 'group', 'aria-label': 'Durées courantes' }, rxDaysChips),
      ),
      prefs,
      el('div', { class: 'rx-bar' }, rxAddButton),
      rxAddPanel,
    ),
    rxListEl,
  );
  syncRxDays();
}

function renderRx() {
  if (!rxBuilt) buildRx();
  ensureRxIndex();
  const shown = state.rx.drugs.filter(matchesSpecies);
  const cards = shown.map((drug) => rxCard(drug));
  cards.forEach((card) => card.refresh());
  if (!state.rx.drugs.length) {
    rxListEl.replaceChildren(el('p', { class: 'empty' }, 'Le catalogue est vide. Ajoutez un médicament : cherchez sa substance dans Med’Vet, saisissez sa posologie, et l’appli choisit l’article le plus adapté au poids.'));
  } else if (!shown.length) {
    rxListEl.replaceChildren(el('p', { class: 'empty' }, 'Aucun médicament du catalogue pour cette espèce.'));
  } else {
    rxListEl.replaceChildren(...cards.map((card) => card.root));
  }
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
