import { DEFAULT_SECTIONS } from './data.js';

const STORE_KEY = 'injection:sections:v1';
const SPECIES_KEY = 'injection:species';
const SPECIES_LABEL = { CN: 'Chien', CT: 'Chat' };
const UNITS = ['mL', 'mL/h'];
const WEIGHT_WARN_ABOVE = 100;

const fmtDose = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCoef = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 });
const fmtWeight = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const main = document.getElementById('main');
const weightInput = document.getElementById('weight');
const warn = document.getElementById('warn');
const editToggle = document.getElementById('edit-toggle');

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

const state = {
  sections: loadSections(),
  species: loadSpecies(),
  weight: null,
  editing: false,
};

const save = () => storeSet(STORE_KEY, JSON.stringify(state.sections));

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

function doseText(item) {
  if (!state.weight || !isNum(item.min)) return null;
  const low = fmtDose.format(state.weight * item.min);
  return isNum(item.max) ? `${low} – ${fmtDose.format(state.weight * item.max)}` : low;
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
        el('div', { class: 'rows' }, rowsFor(items, section)),
      ),
    );
  }
  main.replaceChildren(...(cards.length ? cards : [el('p', { class: 'empty' }, 'Aucun médicament à afficher.')]));
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

function row(item, section) {
  const dose = doseText(item);
  const chip = SPECIES_LABEL[item.species];
  return el('div', { class: 'row' },
    el('div', { class: 'row-main' },
      el('div', { class: 'name' },
        item.name || 'Sans nom',
        chip && el('span', { class: `chip chip-${item.species}` }, chip),
      ),
      (item.route || item.note) && el('div', { class: 'meta' },
        item.route && el('span', { class: 'route' }, item.route),
        item.note && el('span', { class: 'note' }, item.note),
      ),
    ),
    el('div', { class: 'row-dose' },
      el('div', { class: dose ? 'dose' : 'dose dose-empty' },
        dose ?? '–',
        dose && el('span', { class: 'dose-unit' }, section.unit),
      ),
      el('div', { class: 'coef' }, coefText(item, section.unit)),
    ),
  );
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
  const recap = [item.route, SPECIES_LABEL[item.species], item.group].filter(Boolean).join(' · ');
  return el('div', { class: 'erow' },
    field('Nom', textInput(item.name, (v) => { item.name = v; }), 'c-name'),
    field(`Dose (${coefUnit(section.unit)})`, numInput(item.min, (v) => { item.min = v; }, true)),
    field('Dose max', numInput(item.max, (v) => { item.max = v ?? undefined; })),
    el('details', { class: 'c-more' },
      el('summary', {}, 'Voie, espèce, groupe, note', recap && el('span', { class: 'recap' }, recap)),
      el('div', { class: 'more-grid' },
        field('Voie', textInput(item.route, (v) => { item.route = v; })),
        field('Espèce', select(
          [['', 'Chien et chat'], ['CN', 'Chien'], ['CT', 'Chat']],
          item.species || '',
          (v) => { item.species = v || undefined; },
        )),
        field('Groupe', textInput(item.group, (v) => { item.group = v; }), 'wide'),
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
  editToggle.textContent = on ? 'Terminé' : 'Modifier les doses';
  render();
  window.scrollTo({ top: 0 });
}

// --- poids et filtre espèce -------------------------------------------------

function updateWeight() {
  const text = weightInput.value;
  const weight = parseNum(text);
  state.weight = weight > 0 ? weight : null;

  const invalid = text.trim() !== '' && !state.weight;
  weightInput.setAttribute('aria-invalid', String(invalid));

  let message = '';
  if (invalid) message = 'Poids invalide.';
  else if (state.weight > WEIGHT_WARN_ABOVE) message = `Poids élevé (${fmtWeight.format(state.weight)} kg) : vérifier la saisie.`;
  warn.textContent = message;
  warn.hidden = !message;

  if (!state.editing) renderView();
}

weightInput.addEventListener('input', updateWeight);
weightInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') weightInput.blur(); });

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
