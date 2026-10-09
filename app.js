import { DEFAULT_SECTIONS } from './data.js';

const STORE_KEY = 'injection:sections:v1';
const SPECIES_KEY = 'injection:species';
const SPECIES_LABEL = { CN: 'Chien', CT: 'Chat' };
const UNITS = ['mL', 'mL/h'];
const WEIGHT_WARN_ABOVE = 100;
const PREFS_KEY = 'injection:prefs';
const ROUND_STEPS = [0, 0.01, 0.05, 0.1];
const DRIP_SETS = [20, 60];
// Un arrondi qui change la dose de plus de 10 % est refusé : la valeur exacte est gardée.
const ROUND_TOLERANCE = 0.1;

const fmtDose = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function loadSections() {
  const raw = storeGet(STORE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((s) => s && Array.isArray(s.items))) return parsed;
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
  const prefs = { round: 0, set: 20 };
  try {
    const saved = JSON.parse(storeGet(PREFS_KEY) || '{}');
    if (ROUND_STEPS.includes(saved.round)) prefs.round = saved.round;
    if (DRIP_SETS.includes(saved.set)) prefs.set = saved.set;
  } catch { /* réglages corrompus : valeurs par défaut */ }
  return prefs;
}

const state = {
  sections: loadSections(),
  species: loadSpecies(),
  prefs: loadPrefs(),
  weight: null,
  editing: false,
  done: new Set(), // médicaments cochés "prélevés" ; vidé à chaque nouveau poids
};

const save = () => storeSet(STORE_KEY, JSON.stringify(state.sections));
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

const coefUnit = (unit) => (unit === 'mL/h' ? 'mL/kg/h' : 'mL/kg');

const joinRange = (values, format) => values.map((v) => format.format(v)).join(' – ');

// Arrondit un volume à la graduation de la seringue, sauf si l'écart dépasse la tolérance.
function roundDose(value, step) {
  const rounded = Number((Math.round(value / step) * step).toFixed(3));
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

  const format = step === 0.1 && status !== 'skipped' ? fmtDose1 : fmtDose;
  const dose = joinRange(shown, format);
  const exactText = joinRange(exact, fmtDose);
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
  for (const section of state.sections) {
    const items = section.items.filter(matchesSpecies);
    if (!items.length) continue;
    cards.push(
      el('section', { class: 'card' },
        el('h2', {}, el('span', {}, section.title), el('span', { class: 'unit' }, section.unit)),
        section.unit === 'mL/h' && dripPicker(),
        el('div', { class: 'rows' }, rowsFor(items, section)),
      ),
    );
  }
  main.replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, 'Aucun médicament à afficher.')]));
}

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

function textInput(value, onChange) {
  const input = el('input', { type: 'text', autocomplete: 'off', value: value ?? '' });
  input.addEventListener('input', () => { onChange(input.value.trim()); save(); });
  return input;
}

function numInput(value, onChange, required = false) {
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
  input.addEventListener('input', () => { flag(); onChange(parseNum(input.value)); save(); });
  flag();
  return input;
}

function select(options, current, onChange) {
  const node = el('select', {},
    options.map(([value, label]) => el('option', { value, selected: value === current }, label)));
  node.addEventListener('change', () => { onChange(node.value); save(); });
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

function editCard(section, index) {
  return el('section', { class: 'card card-edit' },
    el('div', { class: 'edit-head' },
      field('Section', textInput(section.title, (v) => { section.title = v; }), 'grow'),
      field('Unité', select(UNITS.map((u) => [u, u]), section.unit, (v) => { section.unit = v; save(); render(); })),
    ),
    section.items.map((item) => editRow(section, item)),
    el('div', { class: 'edit-foot' },
      button('Ajouter un médicament', () => addItem(section, index)),
      button('Supprimer la section', () => removeSection(section), 'btn-danger'),
    ),
  );
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

function addItem(section, index) {
  section.items.push({ name: '', min: null });
  save();
  render();
  const rows = main.children[index].querySelectorAll('.erow');
  rows[rows.length - 1].querySelector('input').focus();
}

function removeItem(section, item) {
  if (!confirm(`Supprimer « ${item.name || 'Sans nom'} » ?`)) return;
  section.items.splice(section.items.indexOf(item), 1);
  save();
  render();
}

function addSection() {
  state.sections.push({ title: 'Nouvelle section', unit: 'mL', items: [{ name: '', min: null }] });
  save();
  render();
  const card = main.children[state.sections.length - 1];
  card.scrollIntoView({ block: 'center' });
  card.querySelector('input').select();
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

  let message = '';
  if (invalid) message = 'Poids invalide.';
  else if (state.weight > WEIGHT_WARN_ABOVE) message = `Poids élevé (${fmtWeight.format(state.weight)} kg) : vérifier la saisie.`;
  warn.textContent = message;
  warn.hidden = !message;

  if (!state.editing) renderView();
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

// --- arrondi à la seringue ------------------------------------------------------

function syncRoundNote() {
  roundNote.hidden = !state.prefs.round;
}
roundSelect.value = String(state.prefs.round);
syncRoundNote();
roundSelect.addEventListener('change', () => {
  state.prefs.round = Number(roundSelect.value);
  savePrefs();
  syncRoundNote();
  if (!state.editing) renderView();
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
    renderView();
  });
});

editToggle.addEventListener('click', () => setEditing(!state.editing));

function render() {
  if (state.editing) renderEdit();
  else renderView();
}

render();
if (matchMedia('(pointer: fine)').matches) weightInput.focus();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
