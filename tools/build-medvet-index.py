#!/usr/bin/env python3
"""Extrait de l'export Med'Vet (medicament.xlsx) l'index des articles pour chien et chat :
formes orales (comprimés, gélules, liquides buvables), injectables à concentration en mg/mL et spot-on.
Les autres espèces et les autres formes (vaccins, colliers, aliments...) ne sont pas retenues.

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
# liquide oral : voie orale, forme buvable ou orale, jamais injectable
LIQUID_FORM = re.compile(r'buvable|orale|sirop|^solution$|^suspension$', re.I)
# contenant : [nombre] flacon [verre...] de 32 mL ; ampoules, poches, seringues, cartouches pour les injectables
PACK_LIQUID = re.compile(r'(?:(\d+)\s+)?(flacons?|ampoules?|poches?|seringues?|cartouches?)\b[^\d]{0,25}?(\d+(?:[.,]\d+)?)\s*m[lL]', re.I)
SPOT_FORM = re.compile(r'spot', re.I)
FLUIDS = re.compile(r'chlorure de sodium|glucose|lactate|ringer|chlorure de potassium|bicarbonate|dextrose', re.I)
# une dénomination qui ne parle que d'autres espèces n'est pas pour le chien ni le chat, quoi qu'en dise la liste des espèces
OTHER_SPECIES = re.compile(r'bovins?|porcins?|chevaux|cheval|[ée]quins?|veaux?|ovins?|caprins?|volailles?|poulets?|dindes?|moutons?|vaches?|porcs?|truies?', re.I)
DOG_CAT = re.compile(r'chiens?|chats?|canin|f[ée]lin', re.I)
NUM = r'(\d+(?:[.,]\d+)?)'

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


def base_name(name):
    return fold(re.sub(r'\s*\(.*?\)', '', name)).strip()


# Associations dosées en mg d'association (somme des deux substances), comme dans les RCP et sur les boîtes.
ASSOCIATIONS = {('acide clavulanique', 'amoxicilline')}


def strength_of(pa, name):
    """Dosage par comprimé en mg, ou None si on ne peut pas l'affirmer."""
    if any(a[2] != 'mg' or a[1] is None for a in pa):
        return None
    if len(pa) == 1:
        value, conflict = label_strength(name, pa[0][1])
        return None if conflict else value
    total = round(sum(a[1] for a in pa), 4)
    if tuple(sorted(base_name(a[0]) for a in pa)) in ASSOCIATIONS:
        return compact(total)
    written = [number(n) for n in re.findall(r'(\d+(?:[.,]\d+)?)\s*mg', name, re.I)]
    return compact(total) if any(w is not None and abs(w - total) < 1e-6 for w in written) else None


def label_strength(name, composition, liquid=False):
    """Dosage de l'étiquette quand la dénomination l'écrit, sinon celui de la composition.

    Les posologies se réfèrent à l'étiquette, pas à la composition : un comprimé étiqueté 2,5 mg peut
    contenir 2,3 mg de base (sel ou base). Renvoie (valeur, conflit) ; conflit = écart inexplicable
    (plus de 25 %) : on ne devine pas, le dosage est alors à saisir à la main."""
    unit = r'mg\s*/\s*m[lL]' if liquid else r'mg'
    written = {number(x) for x in re.findall(r'(\d+(?:[.,]\d+)?)\s*' + unit, name, re.I)}
    written.discard(None)
    if written:
        if any(abs(w - composition) <= 0.01 * composition for w in written):
            return composition, False
        if len(written) == 1:
            only = next(iter(written))
            if abs(only - composition) <= 0.25 * composition:
                return compact(only), False
        return None, True
    if not liquid:
        # pas de « mg » écrit (« Benadil 5 ») : le premier nombre isolé, s'il n'est ni un poids ni une
        # fourchette et reste proche de la composition, est le dosage de l'étiquette
        m = re.search(r'(?<![\d.,])(\d+(?:[.,]\d+)?)(?![\d.,]|\s*(?:kg|[-–/]|à\b))', name)
        if m:
            label = number(m.group(1))
            if label and abs(label - composition) <= 0.15 * composition:
                return compact(label), False
    return composition, False


def liquid_concentration(raw_pa, name):
    """Concentration en mg/mL d'un liquide à une seule substance, ou None si on ne peut pas l'affirmer."""
    qty, unit = number(raw_pa['Quantité']), (raw_pa['Unité'] or '').strip()
    if qty is None or qty <= 0:
        return None
    if unit == 'mg':
        # unité sans « /mL » : on ne l'accepte que si la dénomination écrit la même concentration
        if not any(abs(number(w) - qty) < 1e-6 for w in re.findall(r'(\d+(?:[.,]\d+)?)\s*mg\s*/\s*m[lL]', name, re.I)):
            return None
    elif unit != 'mg/mL':
        return None
    value, conflict = label_strength(name, qty, liquid=True)
    return None if conflict else value


def parse_liquid_pack(text):
    """(nombre de contenants, volume d'un contenant en mL, nom du contenant) ou (None, None, None)."""
    m = PACK_LIQUID.search(text)
    if not m:
        return None, None, None
    volume = number(m.group(3))
    return (int(m.group(1)) if m.group(1) else 1), (compact(volume) if volume and volume > 0 else None), fold(m.group(2)).rstrip('s')


def parse_weight_band(name, presentations):
    """Tranche de poids lue dans la dénomination (ou à défaut la présentation) : [min, max ou None, exclusif].

    Seule une tranche écrite noir sur blanc est retenue (« chiens de 10 à 20 kg », « > 4-10 kg », « ≤ 2,5 kg »).
    Une dénomination qui donne deux tranches (chiens ET chats) est jugée ambiguë : pas de tranche."""
    for text in [name, *presentations]:
        t = (text or '').replace('\xa0', ' ')
        if DOG_CAT_BOTH(t) and len(re.findall(r'kg', t, re.I)) >= 2:
            return None
        m = re.search(r'([>≥])\s*' + NUM + r'\s*(?:kg\s*)?(?:-|–|à|a|et)\s*' + NUM + r'\s*kg', t, re.I)
        if m:
            return [number(m.group(2)), number(m.group(3)), 1 if m.group(1) == '>' else 0]
        m = re.search(NUM + r'\s*(?:kg\s*)?(?:-|–|à|a)\s*' + NUM + r'\s*kg', t, re.I)
        if m:
            return [number(m.group(1)), number(m.group(2)), 0]
        m = re.search(r"(?:[<≤]|jusqu['’]?\s*[àa]|moins de|inf[ée]rieur\w*\s+[àa])\s*" + NUM + r'\s*kg', t, re.I)
        if m:
            return [0, number(m.group(1)), 0]
        m = re.search(r'([>≥]|plus de|sup[ée]rieur\w*\s+[àa]|au[- ]del[àa] de)\s*' + NUM + r'\s*kg', t, re.I)
        if m:
            return [number(m.group(2)), None, 1 if m.group(1).lower() in ('>', 'plus de') else 0]
    return None


def DOG_CAT_BOTH(text):
    return bool(re.search(r'chiens?', text, re.I)) and bool(re.search(r'chats?', text, re.I))


def parse_spot_pack(text, name):
    """(pipettes par boîte, volume d'une pipette en mL ou 0) ou (None, None)."""
    for source in (text, name):
        m = re.search(r'(\d+)\s+(?:plaquettes?|sachets?|blisters?)\b[^\d]{0,40}?(\d+)\s*(?:pipettes?|applicateurs?)', source, re.I)
        count = int(m.group(1)) * int(m.group(2)) if m else None
        if count is None:
            m = re.search(r'(\d+)\s*(?:pipettes?|pip\b|applicateurs?)', source, re.I)
            count = int(m.group(1)) if m else None
        if count:
            v = re.search(r'(?:pipettes?|applicateurs?)[^\d]{0,40}?(\d+(?:[.,]\d+)?)\s*m[lL]', source, re.I)
            volume = number(v.group(1)) if v else None
            return count, compact(volume) if volume else 0
    return None, None


def valid_gtin(code):
    """Chiffres du GTIN s'il est bien formé (longueur et chiffre de contrôle), sinon chaîne vide."""
    code = re.sub(r'\D', '', str(code or ''))
    if len(code) not in (8, 12, 13, 14):
        return ''
    digits = [int(c) for c in code.zfill(14)]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(digits[:-1]))
    return code if (10 - total % 10) % 10 == digits[-1] else ''


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
    routes = collections.defaultdict(set)
    for r in rows("Voie d'administration"):
        routes[r['ID_produit']].add(r["Voie d'administration"])
    packs = collections.defaultdict(list)
    for r in rows('Présentations'):
        packs[r['ID_produit']].append((r['Présentation'] or '', r['GTIN']))

    products = []
    stats = collections.Counter()
    for pid, m in meds.items():
        form = m['Forme pharmaceutique'] or ''
        codes = [c for c, label in (('CN', 'Chien'), ('CT', 'Chat')) if label in species[pid]]
        solid = bool(ORAL_FORM.search(form))
        injectable = not solid and 'injectable' in form.lower()
        spot = not solid and not injectable and bool(SPOT_FORM.search(form))
        liquid = (not solid and not injectable and not spot and 'Orale' in routes[pid]
                  and bool(LIQUID_FORM.search(form)))
        if not (solid or liquid or injectable or spot) or not codes:
            continue
        if OTHER_SPECIES.search(m['Dénomination'] or '') and not DOG_CAT.search(m['Dénomination'] or ''):
            stats['autres espèces dans la dénomination'] += 1
            continue

        conc = None
        if liquid or injectable:
            if len(actives[pid]) != 1:
                continue  # associations liquides ou injectables : pas de règle de dosage, non proposées
            conc = liquid_concentration(actives[pid][0], clean(m['Dénomination']))
            if injectable and conc is not None and (conc > 1000 or FLUIDS.search(actives[pid][0]['Nom du principes actifs'] or '')):
                stats['perfusions et concentrations hors mg/kg'] += 1
                continue  # solutés (sodium, glucose) : la fluidothérapie se calcule dans l'onglet Injections
            if conc is None:
                stats['injectables sans concentration' if injectable else 'liquides sans concentration'] += 1
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
        dog_in_name = bool(re.search(r'\bchiens?\b|\bchiots?\b|\bcanin', name, re.I))
        cat_in_name = bool(re.search(r'\bchats?\b|\bchatons?\b|\bf[ée]lin', name, re.I))
        if dog_in_name and cat_in_name:
            codes = ['CN', 'CT']  # le libellé du produit fait foi quand la liste des espèces est incomplète
        elif dog_in_name != cat_in_name:
            codes = ['CN'] if dog_in_name else ['CT']  # ... ou quand elle se contredit (« chiens » écrit, « chat » listé)

        # conditionnement : [plaquettes par boîte, comprimés par plaquette, texte d'origine si illisible, GTIN]
        found, seen = [], {}
        texts = []
        containers = collections.Counter()
        for text, raw_gtin in packs[pid]:
            text = clean(text)
            texts.append(text)
            container = None
            if liquid or injectable:
                blisters, per, container = parse_liquid_pack(text)
            elif spot:
                blisters, per = parse_spot_pack(text, name)
            else:
                blisters, per = parse_pack(text)
            if (liquid or injectable or spot) and not blisters:
                continue  # sans volume de flacon ni nombre de pipettes, le reste ne se calcule pas
            if container:
                containers[container] += 1
            gtin = valid_gtin(raw_gtin)
            key = (blisters, per) if blisters else (None, None, text)
            if key in seen:
                known = seen[key][3].split(',') if seen[key][3] else []
                if gtin and gtin not in known:
                    known.append(gtin)  # plusieurs codes pour le même conditionnement : on les garde tous
                    stats['gtin_multiples'] += len(known) == 2
                    seen[key][3] = ','.join(known)
                continue
            entry = [blisters, per, '', gtin] if blisters else [None, None, text, gtin]
            seen[key] = entry
            found.append(entry)
        if not found:
            continue

        link = m["Lien vers monographie Med'Vet"] or ''
        link = link[len(LINK_PREFIX):] if link.startswith(LINK_PREFIX) else link
        product = {
            'b': brand_of(name),
            'd': name,
            'f': form,
            'a': pa,
            'm': None if (liquid or injectable or spot) else strength_of(pa, name),
            's': ','.join(codes),
            'x': 0 if (liquid or injectable or spot) else split_level(' '.join(texts) + ' ' + name + ' ' + form),
            'u': 'pip' if spot else 'mL' if (liquid or injectable) else ('gél.' if re.search(r'gélule|capsule', form, re.I) else 'cp'),
            'k': found,
            'l': link,
        }
        if liquid or injectable:
            product['c'] = compact(conc)  # concentration en mg/mL ; k = [contenants par boîte, mL par contenant, '', GTIN]
            kind = containers.most_common(1)[0][0] if containers else 'flacon'
            if kind != 'flacon':
                product['ct'] = kind
        if injectable:
            product['r'] = 'inj'
        if spot:
            # k = [pipettes par boîte, mL par pipette (0 si inconnu), '', GTIN] ; w = tranche de poids du libellé
            product['r'] = 'spot'
            product['w'] = parse_weight_band(name, texts)
            stats['spot-on avec tranche de poids lue' if product['w'] else 'spot-on sans tranche de poids lue'] += 1
        products.append(product)

    products.sort(key=lambda p: (fold(p['b']), p['m'] or p.get('c') or 0, fold(p['d'])))
    latest = max((str(m['Date de mise à jour de la monographie'] or '')[:10] for m in meds.values()), default='')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'v': 1, 'date': latest, 'p': products}, f, ensure_ascii=False, separators=(',', ':'))
    readable = sum(1 for p in products for k in p['k'] if k[0] is not None)
    total = sum(len(p['k']) for p in products)
    with_gtin = sum(1 for p in products for k in p['k'] if k[3])
    kinds = collections.Counter(p.get('r', 'oral') for p in products)
    print(f'{len(products)} produits (voie orale {kinds["oral"]}, injectables {kinds["inj"]}, spot-on {kinds["spot"]}), '
          f'{total} présentations dont {readable} lisibles et {with_gtin} avec GTIN valide '
          f'({stats["gtin_multiples"]} conditionnements avec plusieurs codes)')
    for key in ('liquides sans concentration', 'injectables sans concentration', 'perfusions et concentrations hors mg/kg',
                'autres espèces dans la dénomination',
                'spot-on avec tranche de poids lue', 'spot-on sans tranche de poids lue'):
        print(f'  {key} : {stats[key]}')
    print(f'écrit dans {out}')


if __name__ == '__main__':
    main()
