#!/usr/bin/env python3
"""Extrait de l'export Med'Vet (medicament.xlsx) l'index des formes orales solides pour chien et chat.

Usage : python3 -I tools/build-medvet-index.py chemin/vers/medicament.xlsx [sortie.json]

Ne garde que des faits de catalogue : nom, principes actifs et dosage, espèces, conditionnement,
caractère sécable et adresse de la fiche. Ni posologie, ni textes de RCP, ni images.
"""
import collections
import json
import re
import sys
import unicodedata

import openpyxl

ORAL_FORM = re.compile(r'compri|gélule|capsule|croquer', re.I)
LINK_PREFIX = 'https://med-vet.fr/produits/medicament/'
UNITS = r'(?:compri\w*|g[ée]lules?|capsules?|cpr?s?\b|cps\b)'
PACK_BLISTERS = re.compile(r'(\d+)\s+(?:plaquettes?|blisters?|films?|barquettes?|pots?|piluliers?|flacons?|tubes?|[ée]tuis?)\b[^\d]{0,40}?(\d+)\s+' + UNITS, re.I)
PACK_ONE = re.compile(r"(?:d['’]une|une?)\s+(?:plaquette|pot|pilulier|flacon|tube)s?\s+de\s+(\d+)\s+" + UNITS, re.I)
PACK_MULTI = re.compile(r'(\d+)\s*x\s*(\d+)\s*(?:tab|cp|compri)', re.I)
PACK_UNITS = re.compile(r'(?:bo[iî]te|flacon|pot|[ée]tui|sachet|tube)\s+(?:de\s+)?(\d+)\s+' + UNITS, re.I)
PACK_SHORT = re.compile(r'\b(?:cpr?|cps)\s*(\d+)\b|\b(\d+)\s*(?:cpr?|cps)\b|\((\d+)\s+compri', re.I)
STOP_WORDS = {'comprime', 'comprimes', 'gelule', 'gelules', 'capsule', 'capsules', 'pour', 'cp', 'cpr', 'cps',
              'mg', 'g', 'ug', 'mcg', 'ui', 'chien', 'chiens', 'chat', 'chats', 'a', 'de', 'et'}


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def clean(text):
    text = (text or '').replace('\xa0', ' ')
    text = re.sub(r'[®Ⓡ™©]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def brand_of(name):
    words = []
    for token in clean(name).split(' '):
        if re.search(r'\d', token) or fold(token).strip('.,()') in STOP_WORDS:
            break
        words.append(token)
    brand = ' '.join(words) or clean(name)
    return ' '.join(w.capitalize() if w.isupper() else w for w in brand.split(' '))


def parse_pack(text):
    m = PACK_BLISTERS.search(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = PACK_MULTI.search(text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = PACK_ONE.search(text)
    if m:
        return 1, int(m.group(1))
    m = PACK_UNITS.search(text)
    if m:
        return 1, int(m.group(1))
    m = PACK_SHORT.search(text)
    if m:
        return 1, int(next(g for g in m.groups() if g))
    return None, None


def split_level(text):
    if re.search(r'non[\s-]+s[ée]cable', text, re.I):
        return 0
    if re.search(r'quadri[\s-]?s[ée]cable', text, re.I):
        return 2
    if re.search(r's[ée]cables?|bis[ée]cable', text, re.I):
        return 1
    return 0


def number(text):
    try:
        return float(str(text).replace(',', '.'))
    except ValueError:
        return None


def strength_of(pa, name):
    """Dosage par comprimé en mg, ou None si on ne peut pas l'affirmer."""
    if any(a[2] != 'mg' or a[1] is None for a in pa):
        return None
    if len(pa) == 1:
        return pa[0][1]
    total = round(sum(a[1] for a in pa), 4)
    written = [number(n) for n in re.findall(r'(\d+(?:[.,]\d+)?)\s*mg', name, re.I)]
    return compact(total) if any(w is not None and abs(w - total) < 1e-6 for w in written) else None


def compact(value):
    return int(value) if isinstance(value, float) and value.is_integer() else value


def main():
    source = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else 'medvet-oral.json'
    wb = openpyxl.load_workbook(source, read_only=True, data_only=True)

    def rows(name):
        it = wb[name].iter_rows(values_only=True)
        header = next(it)
        return [dict(zip(header, r)) for r in it if r and r[0]]

    meds = {m['ID_produit']: m for m in rows('Médicament')}
    species = collections.defaultdict(set)
    for r in rows('Espèces'):
        species[r['ID_produit']].add(r['Espèces cibles'])
    actives = collections.defaultdict(list)
    for r in rows('Principes actifs'):
        actives[r['ID_produit']].append(r)
    packs = collections.defaultdict(list)
    for r in rows('Présentations'):
        packs[r['ID_produit']].append(r['Présentation'] or '')

    products = []
    for pid, m in meds.items():
        form = m['Forme pharmaceutique'] or ''
        codes = [c for c, label in (('CN', 'Chien'), ('CT', 'Chat')) if label in species[pid]]
        if not ORAL_FORM.search(form) or not codes:
            continue

        pa = []
        for a in actives[pid]:
            qty, unit = number(a['Quantité']), (a['Unité'] or '').strip()
            if qty is not None and unit.startswith('µg'):
                qty, unit = qty / 1000, 'mg'
            elif unit.startswith('mg'):
                unit = 'mg'
            pa.append([clean(a['Nom du principes actifs']), compact(round(qty, 4)) if qty is not None else None, unit])

        name = clean(m['Dénomination'])
        if re.search(r'chiens?\s+et\s+chats?|chats?\s+et\s+chiens?', name, re.I):
            codes = ['CN', 'CT']  # le libellé du produit fait foi quand la liste des espèces est incomplète

        # conditionnement : [plaquettes par boîte, comprimés par plaquette, texte d'origine si illisible]
        found, seen = [], set()
        texts = []
        for text in packs[pid]:
            text = clean(text)
            texts.append(text)
            blisters, per = parse_pack(text)
            key = (blisters, per) if blisters else (None, None, text)
            if key in seen:
                continue
            seen.add(key)
            found.append([blisters, per] if blisters else [None, None, text])
        if not found:
            continue

        link = m["Lien vers monographie Med'Vet"] or ''
        link = link[len(LINK_PREFIX):] if link.startswith(LINK_PREFIX) else link
        products.append({
            'b': brand_of(name),
            'd': name,
            'f': form,
            'a': pa,
            'm': strength_of(pa, name),
            's': ','.join(codes),
            'x': split_level(' '.join(texts) + ' ' + name + ' ' + form),
            'u': 'gél.' if re.search(r'gélule|capsule', form, re.I) else 'cp',
            'k': found,
            'l': link,
        })

    products.sort(key=lambda p: (fold(p['b']), p['m'] or 0, fold(p['d'])))
    latest = max((str(m['Date de mise à jour de la monographie'] or '')[:10] for m in meds.values()), default='')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'date': latest, 'p': products}, f, ensure_ascii=False, separators=(',', ':'))
    readable = sum(1 for p in products for k in p['k'] if k[0] is not None)
    total = sum(len(p['k']) for p in products)
    print(f'{len(products)} produits, {total} présentations dont {readable} lisibles, écrit dans {out}')


if __name__ == '__main__':
    main()
