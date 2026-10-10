// Tests de la logique pure de l'ordonnance (rx.js) : `node tools/test-rx.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  plan, planBand, normalizeDrug, normalizeProtocol, normalizePrices, posologyStatus, tabletPhrase, intakeSentence,
  supplyParts, supplyPhrase, orderWarnings, orderTotals, withPrices, boxOf, isUnhandledCombo, marketFormats, routeOf,
  frequencyText, DEFAULT_PREFS, parseRcp,
} from '../rx.js';

let count = 0;
const test = (name, fn) => {
  try { fn(); count++; } catch (error) { console.error(`ÉCHEC : ${name}\n`, error); process.exitCode = 1; }
};

const index = JSON.parse(fs.readFileSync(new URL('../medvet-oral.json', import.meta.url), 'utf8'));
const prefs = { ...DEFAULT_PREFS };

test('phrases de comprimés', () => {
  assert.equal(tabletPhrase(1), '1 comprimé');
  assert.equal(tabletPhrase(5), '5 comprimés');
  assert.equal(tabletPhrase(1.5), '1 comprimé et demi');
  assert.equal(tabletPhrase(2.5), '2 comprimés et demi');
  assert.equal(tabletPhrase(0.5), 'un demi-comprimé');
  assert.equal(tabletPhrase(0.25), 'un quart de comprimé');
  assert.equal(tabletPhrase(0.75), 'trois quarts de comprimé');
  assert.equal(tabletPhrase(1.25, 'gélule'), '1 gélule et quart');
  assert.equal(frequencyText(2), 'matin et soir');
  assert.equal(frequencyText(1), '1 fois par jour');
  assert.equal(frequencyText(3), '3 fois par jour');
});

test('un médicament garde son identifiant, un ancien en reçoit un', () => {
  const a = normalizeDrug({ name: 'X' });
  assert.ok(a.id);
  assert.equal(normalizeDrug(a).id, a.id);
  assert.notEqual(normalizeDrug({ name: 'X' }).id, a.id);
  assert.equal(normalizeDrug({ family: '  AINS ' }).family, 'AINS');
  assert.equal(normalizeDrug({ family: '  ' }).family, undefined);
  assert.equal(normalizeDrug({ validated: '2026-10-10' }).validated, '2026-10-10');
  assert.equal(normalizeDrug({ validated: 'hier' }).validated, undefined);
});

test('statut de la posologie', () => {
  assert.equal(posologyStatus(normalizeDrug({ name: 'a' })), 'missing');
  assert.equal(posologyStatus(normalizeDrug({ min: 2, perDay: 1 })), 'validated');
  assert.equal(posologyStatus(normalizeDrug({ min: 2, perDay: 1, suggested: true })), 'suggested');
  assert.equal(posologyStatus(normalizeDrug({ route: 'spot' })), 'band');
});

const stock = (extra = {}) => normalizeDrug({
  name: 'Amox',
  min: 12.5,
  perDay: 2,
  formats: [{ name: 'Amox 250 mg', mg: 250, perBlister: 10, blisters: 1, split: 'half' }],
  ...extra,
});

test('phrase et remise pour des comprimés', () => {
  const drug = stock();
  const r = plan(drug, { weight: 20, days: 7, prefs });
  const best = r.options[0];
  assert.equal(intakeSentence(best, drug, 7), '1 comprimé, matin et soir, pendant 7 jours');
  assert.equal(intakeSentence(best, drug, null), '1 comprimé, matin et soir');
  const parts = supplyParts(best);
  assert.deepEqual([parts.count, parts.unit, parts.detail], [2, 'plaquettes', 'de 10 comprimés']);
  assert.equal(supplyPhrase(best), '2 plaquettes de 10 comprimés');
});

test('remise à l’unité et sans durée', () => {
  const drug = stock();
  const unit = plan(drug, { weight: 20, days: 7, prefs: { ...prefs, dispense: 'unit' } }).options[0];
  assert.equal(supplyPhrase(unit), '14 comprimés');
  const none = plan(drug, { weight: 20, days: null, prefs }).options[0];
  assert.equal(supplyPhrase(none), '');
  assert.equal(supplyParts(none), null);
});

test('liquide et injectable', () => {
  const drug = normalizeDrug({
    name: 'Méloxicam', route: 'inj', min: 0.2, perDay: 1,
    formats: [{ name: 'Inj 5 mg/mL', unit: 'mL', conc: 5, volume: 10, bottles: 1, route: 'inj' }],
  });
  const best = plan(drug, { weight: 20, days: 3, prefs }).options[0];
  assert.equal(intakeSentence(best, drug, 3), '0,8 mL par injection, 1 fois par jour, pendant 3 jours');
  assert.equal(supplyPhrase(best), '1 flacon de 10 mL');
});

test('prix : coût d’un comprimé et d’un spot-on', () => {
  const drug = stock({ formats: [{ name: 'Amox 250 mg', mg: 250, perBlister: 10, blisters: 2, split: 'half', price: 20 }] });
  const best = plan(drug, { weight: 20, days: 7, prefs }).options[0];
  assert.equal(best.supply.cost, 20); // 2 plaquettes de 10 = 1 boîte de 2 plaquettes
  const boxes = [{ blisters: 3, gtin: '03401234567890', price: 12 }, { blisters: 6, gtin: '03401234567891', price: 20 }];
  const spot = { name: 'S', unit: 'pip', band: { lo: 10, hi: 20, excl: false }, perBox: 3, boxes };
  const r = planBand({ route: 'spot', interval: 30, formats: [spot] }, { weight: 15, days: 90 });
  assert.equal(r.options[0].supply.count, 1);
  assert.equal(r.options[0].supply.cost, 12);
});

test('prix saisis par GTIN appliqués aux articles Med’Vet', () => {
  const formats = marketFormats(index.p, 'Méloxicam', { route: 'oral', species: 'CN' });
  assert.ok(formats.length > 0);
  const f = formats[0];
  const { gtin, n } = boxOf(f);
  assert.ok(gtin && n > 0);
  const priced = withPrices(formats, { [gtin]: 9.5 });
  assert.equal(priced[0].price, 9.5);
  assert.equal(withPrices(formats, {}), formats);
  assert.equal(withPrices(formats, { '99999999': 3 })[0].price, undefined);
  assert.deepEqual(normalizePrices({ '03401234567890': 4.5, abc: 1, '03401234567891': -2, '03401234567892': 'x' }), { '03401234567890': 4.5 });
  assert.deepEqual(normalizePrices(null), {});
});

test('alertes entre les lignes', () => {
  const a = normalizeDrug({ name: 'Méloxicam', substance: 'Méloxicam', family: 'AINS' });
  const b = normalizeDrug({ name: 'Carprofène', substance: 'Carprofène', family: 'ains' });
  const c = normalizeDrug({ name: 'Méloxicam inj', substance: 'Méloxicam', route: 'inj', family: 'AINS' });
  const d = normalizeDrug({ name: 'Amox', substance: 'Amoxicilline', family: 'Antibiotique' });
  const w = orderWarnings([a, b, d]);
  assert.equal(w.get(a).length, 1);
  assert.match(w.get(a)[0], /Même classe \(AINS\) que Carprofène/);
  assert.equal(w.get(d).length, 0);
  const w2 = orderWarnings([a, c]);
  assert.equal(w2.get(a).length, 1); // même substance seulement, pas deux alertes pour la même paire
  assert.match(w2.get(a)[0], /Même substance/);
  assert.equal(orderWarnings([a]).get(a).length, 0);
  assert.equal(orderWarnings([normalizeDrug({ name: 'x' }), normalizeDrug({ name: 'y' })]).size, 2);
});

test('total de l’ordonnance', () => {
  assert.deepEqual(orderTotals([12, null, 8.5]), { total: 20.5, priced: 2, count: 3 });
  assert.deepEqual(orderTotals([null]), { total: null, priced: 0, count: 1 });
  assert.deepEqual(orderTotals([]), { total: null, priced: 0, count: 0 });
});

test('protocoles', () => {
  const p = normalizeProtocol({ name: '  Post-op chien ', items: [{ drug: 'a', days: 5 }, { drug: 'b' }, { nope: 1 }, { drug: 'c', days: 'x' }, { drug: 'd', days: 9999 }] });
  assert.equal(p.name, 'Post-op chien');
  assert.deepEqual(p.items, [{ drug: 'a', days: 5 }, { drug: 'b', days: null }, { drug: 'c', days: null }, { drug: 'd', days: null }]);
  assert.ok(p.id);
  assert.deepEqual(normalizeProtocol({ name: 3, items: 'x' }).items, []);
});

test('associations refusées : NexGard Spectra, Milbemax, Drontal, Bravecto', () => {
  const refused = (brand) => index.p.filter((p) => p.b === brand && routeOf(p) === 'oral').every(isUnhandledCombo);
  for (const brand of ['Nexgard Spectra', 'Milbemax', 'Drontal', 'Bravecto', 'Simparica Trio', 'Credelio Plus']) assert.ok(refused(brand), brand);
});

test('produits calculables jamais refusés', () => {
  const oral = index.p.filter((p) => routeOf(p) === 'oral');
  for (const p of oral) {
    if (p.a.length === 1) assert.equal(isUnhandledCombo(p), false, p.d);
  }
  const amox = oral.filter((p) => /kesium|synulox|clavubactin|noroclav/i.test(p.b));
  assert.ok(amox.length > 0);
  for (const p of amox.filter((x) => x.m != null)) assert.equal(isUnhandledCombo(p), false, p.d);
  assert.equal(index.p.filter((p) => routeOf(p) !== 'oral').some(isUnhandledCombo), false);
});

// --- texte du RCP : mise en forme sans rien changer au texte ------------------------------------

test('RCP : intertitres, puces et suite d’un item', () => {
  const blocks = parseRcp('Posologie recommandée\nChiens :\n- Plaies : 11 mg par kg pendant 7 à 10 jours.\nLe traitement ne sera pas poursuivi.\n\n-Ostéomyélites :\n11 mg de clindamycine par kg.\n\n1. Premier\n2) Second\n\n5,5 mg/kg par prise');
  assert.deepEqual(blocks.map((b) => b.type), ['h', 'h', 'ul', 'p', 'ul', 'ol', 'p']);
  assert.equal(blocks[0].text, 'Posologie recommandée');
  assert.equal(blocks[1].text, 'Chiens :');
  assert.deepEqual(blocks[2].items, [['Plaies : 11 mg par kg pendant 7 à 10 jours.']]);
  assert.deepEqual(blocks[3].lines, ['Le traitement ne sera pas poursuivi.']);
  assert.deepEqual(blocks[4].items, [['Ostéomyélites :', '11 mg de clindamycine par kg.']]); // la ligne après « : » reste dans l’item
  assert.deepEqual(blocks[5].items, [['Premier'], ['Second']]);
  assert.deepEqual(blocks[6].lines, ['5,5 mg/kg par prise']); // un nombre en début de ligne n’est pas une liste
});

test('RCP : tableau « une ligne par ligne » et tableau « une cellule par ligne »', () => {
  const a = parseRcp('Posologie | Volume par kg |\n5,5 mg/kg | 0,25 ml |\n11 mg/kg | 0,5 ml |\nPour assurer une posologie correcte.');
  assert.deepEqual(a.map((b) => b.type), ['table', 'p']);
  assert.equal(a[0].exact, true);
  assert.deepEqual(a[0].rows, [['Posologie', 'Volume par kg'], ['5,5 mg/kg', '0,25 ml'], ['11 mg/kg', '0,5 ml']]);
  const b = parseRcp('Poids (kg)\n| Nombre de comprimés de ZITAC 100 mg\n|\n6 à 10\n| ½\n|\n11 à 20\n| 1\n|');
  assert.equal(b.length, 1);
  assert.equal(b[0].exact, true);
  assert.deepEqual(b[0].rows, [['Poids (kg)', 'Nombre de comprimés de ZITAC 100 mg'], ['6 à 10', '½'], ['11 à 20', '1']]);
});

test('RCP : cellule vide gardée à sa place, tableau irrégulier jamais présenté comme une grille', () => {
  const [full] = parseRcp('Poids\n| 4,8 mg\n| 6,4 mg\n|\n3 - 4\n| 0,5\n|\n|\n4 - 5\n|\n| 0,5\n|');
  assert.equal(full.exact, true);
  assert.deepEqual(full.rows, [['Poids', '4,8 mg', '6,4 mg'], ['3 - 4', '0,5', ''], ['4 - 5', '', '0,5']]); // la valeur reste dans sa colonne
  const [ragged] = parseRcp('Poids du chien\n| Comprimés\n| Nombre\n|\n3 à 7,5 kg\n| Comprimé de 1,875 mg\n| 1 comprimé\n|\n7,5 à 15 kg\n| Comprimé de 3,75 mg\n|');
  assert.equal(ragged.type, 'table');
  assert.equal(ragged.exact, false); // lignes de 3, 3 et 2 cellules : colonnes non fiables
  assert.equal(ragged.rows.length, 3);
});

test('RCP : les * des notes ne sont pas du markdown, un « | » seul disparaît', () => {
  const blocks = parseRcp('** sur la base d’une dose de 25 µg/kg\n\nAttendre 15 minutes avant d’administrer la kétamine par injection |');
  assert.deepEqual(blocks[0].lines, ['** sur la base d’une dose de 25 µg/kg']);
  assert.deepEqual(blocks[1].lines, ['Attendre 15 minutes avant d’administrer la kétamine par injection']);
  assert.deepEqual(parseRcp(''), []);
  assert.deepEqual(parseRcp(null), []);
});

test('RCP : aucun mot perdu ni ajouté sur les 711 fiches', () => {
  const poso = JSON.parse(fs.readFileSync(new URL('../medvet-poso.json', import.meta.url), 'utf8')).p;
  const texts = Object.values(poso).flat().filter((x) => typeof x === 'string');
  assert.ok(texts.length > 700);
  const words = (s) => s.split(/\s+/).filter((w) => w && w !== '|');
  const marker = (l) => l.replace(/^\s*[-–•·]\s*/, '').replace(/^\s*\d{1,2}[.)]\s+/, '');
  for (const text of texts) {
    const out = parseRcp(text).flatMap((b) => (b.type === 'p' ? b.lines.flatMap(words)
      : b.type === 'h' ? words(b.text)
        : b.type === 'table' ? b.rows.flat().flatMap(words)
          : b.items.flat().flatMap(words)));
    const orig = text.split('\n').map(marker).flatMap(words);
    assert.equal(out.sort().join('\u0001'), orig.sort().join('\u0001'), text.slice(0, 80));
  }
});

console.log(process.exitCode ? 'Des tests échouent.' : `${count} tests rx.js : OK`);
