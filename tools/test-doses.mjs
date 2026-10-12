// Tests de la lecture des doses du RCP (doses.js) : `node tools/test-doses.mjs`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readDoses, groupDoses, sentencesOf } from '../doses.js';
import { posoKey, rcpTexts, productLink } from '../rx.js';

let count = 0;
const test = (name, fn) => {
  try { fn(); count++; } catch (error) { console.error(`ÉCHEC : ${name}\n`, error); process.exitCode = 1; }
};
const read = (text, opts) => readDoses(text, opts).map((d) => [d.min, d.max, d.perDay, d.basis]);

test('une dose par prise, rythme dans la phrase', () => {
  assert.deepEqual(read('Administrer 10 mg/kg deux fois par jour.'), [[10, undefined, 2, 'intake']]);
  assert.deepEqual(read('La dose est de 5 mg par kg de poids corporel, une fois par jour.'), [[5, undefined, 1, 'intake']]);
  assert.deepEqual(read('0,5 mg/kg toutes les 12 heures.'), [[0.5, undefined, 2, 'intake']]);
});

test('une dose par jour répartie en deux prises', () => {
  assert.deepEqual(read('20 mg/kg par jour. La dose doit être divisée en deux administrations.'), [[20, undefined, 2, 'day']]);
});

test('une dose par jour dont la répartition est au choix : prises à préciser', () => {
  const [d] = readDoses('10 mg/kg par jour, en une ou deux prises. Cette dose peut être répartie en deux prises.');
  assert.equal(d.perDay, null);
  assert.ok(d.tags.includes('split'));
});

test('fourchette de rythme : la dose est lisible, les prises restent à préciser', () => {
  const [d] = readDoses('Administrer 2 mg/kg, une à deux fois par jour.');
  assert.equal(d.min, 2);
  assert.equal(d.perDay, null);
  assert.ok(d.tags.includes('range'));
  assert.equal(d.tap, true);
});

test('rythme non quotidien : montré, jamais appliqué', () => {
  for (const text of ['Administrer 5 mg/kg tous les 2 jours.', '3 mg/kg une fois par semaine.', 'Administrer 8 mg/kg une fois par mois.']) {
    const [d] = readDoses(text);
    assert.equal(d.tap, false, text);
    assert.ok(d.tags.includes('rhythm'), text);
  }
});

test('dose unique : appliquée sur une prise, signalée', () => {
  const [d] = readDoses('Injection sous-cutanée unique de 0,2 mg de méloxicam par kg de poids corporel.');
  assert.equal(d.tap, true);
  assert.equal(d.perDay, 1);
  assert.ok(d.tags.includes('single'));
});

test('une dose maximale n’est jamais une dose à appliquer', () => {
  const [d] = readDoses('La dose quotidienne maximale recommandée est de 16 mg/kg.');
  assert.equal(d.tap, false);
  assert.ok(d.tags.includes('max'));
  const both = readDoses('À la dose minimale de 0,5 mg/kg et à la dose maximale de 2 mg/kg, une fois par jour.');
  assert.deepEqual(both.map((x) => [x.min, x.tap]), [[0.5, true], [2, false]]);
});

test('« dose quotidienne conseillée » est une dose par jour', () => {
  const text = 'La dose quotidienne conseillée est de 0,5 mg/kg, divisée en deux prises quotidiennes (0,25 mg/kg par prise).';
  const doses = readDoses(text);
  assert.deepEqual(doses.map((d) => [d.min, d.basis, d.perDay]), [[0.5, 'day', 2], [0.25, 'intake', 2]]);
  assert.equal(groupDoses([{ name: 'A', link: 'a', doses }]).length, 1); // 0,5 par jour en 2 prises = 0,25 par prise
});

test('« par jour » d’une dose ne déteint pas sur la suivante de la même phrase', () => {
  const doses = readDoses('0,5 mg/kg par jour réparti en deux administrations de 0,25 mg/kg, matin et soir.');
  assert.deepEqual(doses.map((d) => [d.min, d.basis]), [[0.5, 'day'], [0.25, 'intake']]);
});

test('tableau : une ligne ne prend pas le rythme de sa voisine', () => {
  const [d] = readDoses('Poids | 4 mg/kg\nPoids | 2 mg/kg toutes les 8 heures\nPoids | 1 mg/kg toutes les 12 heures');
  assert.equal(d.perDay, null);
});

test('fourchette de dose', () => {
  assert.deepEqual(read('Entre 0,2 mg et 0,6 mg de pimobendane/kg de poids corporel par jour, en deux prises.')[0].slice(0, 2), [0.2, 0.6]);
  assert.ok(readDoses('1 à 5 mg/kg une fois par jour.')[0].tags.includes('wide'));
});

test('phases, conditions et dose doublée sont signalées', () => {
  assert.ok(readDoses('Dose de charge : 10 mg/kg une fois par jour.')[0].tags.includes('phase'));
  assert.ok(readDoses('Selon la gravité, 5 mg/kg une fois par jour.')[0].tags.includes('condition'));
  assert.ok(readDoses('La dose peut être doublée à 10 mg/kg une fois par jour.')[0].tags.includes('double'));
});

test('autres unités et autres espèces : ignorées', () => {
  assert.deepEqual(read('Administrer 20 µg/kg une fois par jour.'), []);
  assert.deepEqual(read('Chez les bovins : 5 mg/kg une fois par jour.'), []);
  assert.deepEqual(read('Administrer 3 mg/m2 une fois par jour.'), []);
});

test('espèces : titre « Chiens : » puis « Chats : »', () => {
  const text = 'Chiens : 4 mg/kg une fois par jour.\nChats : 2 mg/kg une fois par jour.';
  assert.deepEqual(readDoses(text).map((d) => [d.min, d.species]), [[4, 'CN'], [2, 'CT']]);
  assert.deepEqual(readDoses(text, { species: 'CT' }).map((d) => d.min), [2]);
  assert.deepEqual(readDoses(text, { species: 'CN' }).map((d) => d.min), [4]);
  assert.deepEqual(readDoses('Chez le chat, 2 mg/kg une fois par jour.', { species: 'CN' }), []);
});

test('espèce du patient connue : toutes les doses portent cette espèce', () => {
  const doses = readDoses('10 mg/kg une fois par jour.\nChiens : 5 mg/kg une fois par jour.', { species: 'CN' });
  assert.deepEqual(doses.map((d) => d.species), ['CN', 'CN']);
});

test('la même dose redite n’est comptée qu’une fois', () => {
  assert.equal(readDoses('10 mg/kg deux fois par jour. Soit 10 mg/kg deux fois par jour.').length, 1);
});

test('recoupement avec « 1 comprimé pour 10 kg »', () => {
  const text = 'Administrer 5 mg/kg une fois par jour, soit 1 comprimé pour 10 kg.';
  assert.ok(readDoses(text, { strength: 50 })[0].tags.includes('confirmed'));
  const off = readDoses('Administrer 5 mg/kg une fois par jour, soit 1 comprimé pour 10 kg.', { strength: 20 });
  assert.ok(off[0].tags.includes('mismatch'));
});

test('amoxicilline + acide clavulanique : somme des deux', () => {
  const text = "Administrer 10 mg d'amoxicilline et 2,5 mg d'acide clavulanique par kg, deux fois par jour.";
  assert.deepEqual(read(text, { assoc: true }), [[12.5, undefined, 2, 'intake']]);
});

test('découpage en phrases', () => {
  assert.deepEqual(sentencesOf('A 0,5 mg/kg. B : c\nd; e'), ['A 0,5 mg/kg.', 'B :', 'c', 'd;', 'e']);
});

test('groupes : les marques qui disent la même chose sont regroupées, les plus sûres d’abord', () => {
  const a = { name: 'A', link: 'a', doses: readDoses('10 mg/kg deux fois par jour.') };
  const b = { name: 'B', link: 'b', doses: readDoses('20 mg/kg par jour. La dose doit être divisée en deux administrations.') };
  const c = { name: 'C', link: 'c', doses: readDoses('Selon la gravité, 5 mg/kg une fois par jour.') };
  const groups = groupDoses([a, b, c]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].names, ['A', 'B']); // 10 mg/kg x2 = 20 mg/kg par jour en 2 prises
  assert.deepEqual(groups[1].names, ['C']);
});

// --- sur les vraies données : chaque posologie déjà proposée d'office doit faire partie des doses lues ---------

const index = JSON.parse(fs.readFileSync(new URL('../medvet-oral.json', import.meta.url), 'utf8'));
const poso = JSON.parse(fs.readFileSync(new URL('../medvet-poso.json', import.meta.url), 'utf8'));
const isAssoc = (p) => p.a.length === 2 && p.a.every((x) => /amoxicilline|clavulanique/i.test(x[0]));

test('toute posologie proposée d’office est retrouvée parmi les doses lues', () => {
  let checked = 0;
  const misses = [];
  for (const p of index.p) {
    if (!p.o || !p.l) continue;
    const entry = poso.p[posoKey(productLink(p))];
    for (const [species, o] of Object.entries(p.o)) {
      const texts = rcpTexts(entry, species);
      if (!texts.length || !Array.isArray(o)) continue;
      const doses = readDoses(texts[0].text, { species, assoc: isAssoc(p), strength: p.m || undefined, conc: p.c || undefined });
      const [min, max, perDay, basis] = o;
      const same = (d) => d.min === min && d.max === (max ?? undefined) && d.perDay === perDay && d.basis === (basis === 'day' ? 'day' : 'intake');
      // une même dose peut être lue par prise (0,25 x 2) ou par jour (0,5 par jour en 2 prises) : on compare par prise
      const perIntake = (m, b, n) => (b === 'day' ? m / n : m);
      const equiv = (d) => d.perDay === perDay && Math.abs(perIntake(d.min, d.basis, d.perDay) - perIntake(min, basis === 'day' ? 'day' : 'intake', perDay)) < 1e-6;
      checked += 1;
      if (!doses.some((d) => same(d) || equiv(d))) misses.push(`${p.b} (${species}) : attendu ${JSON.stringify(o)}, lu ${JSON.stringify(doses.map((d) => [d.min, d.max, d.perDay, d.basis]))}`);
    }
  }
  assert.ok(checked > 60, `seulement ${checked} posologies contrôlées`);
  assert.deepEqual(misses, []);
});

test('couverture : combien de textes donnent au moins une dose à toucher', () => {
  let texts = 0;
  let withDose = 0;
  let tappable = 0;
  const products = new Set();
  for (const p of index.p) {
    if (!p.l || p.r === 'spot' || p.a.length !== 1 && !isAssoc(p)) continue;
    const entry = poso.p[posoKey(productLink(p))];
    for (const species of p.s.split(',')) {
      const t = rcpTexts(entry, species)[0];
      if (!t) continue;
      texts += 1;
      const doses = readDoses(t.text, { species, assoc: isAssoc(p), strength: p.m || undefined, conc: p.c || undefined });
      if (doses.length) withDose += 1;
      if (doses.some((d) => d.tap)) { tappable += 1; products.add(p.b); }
    }
  }
  console.log(`  ${texts} textes chien/chat (une substance) : ${withDose} avec au moins une dose lue, ${tappable} avec une dose à toucher, ${products.size} produits`);
  assert.ok(tappable > 400, `couverture trop basse : ${tappable}`);
});

console.log(`${count} tests passés`);
