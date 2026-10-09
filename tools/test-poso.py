#!/usr/bin/env python3
"""Garde-fous de l'extraction des posologies proposées à l'avance (tools/build-medvet-index.py).

Usage : python3 -I tools/test-poso.py

Les textes sont des paraphrases écrites pour le test, une par piège rencontré dans les vraies fiches : un cas
accepté doit donner exactement la posologie attendue, un cas refusé doit rester sans proposition."""
import importlib.util
import os
import sys

sys.dont_write_bytecode = True  # ne laisse pas de __pycache__ dans le dépôt
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('build', os.path.join(here, 'build-medvet-index.py'))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

ONE = {'a': [['Substance', 10, 'mg']], 'm': 50}
LIQUID = {'a': [['Substance', 40, 'mg']], 'c': 40}
ASSOC = {'a': [['Amoxicilline (sous forme de trihydrate)', 40, 'mg'], ['Acide clavulanique (sous forme de sel de potassium)', 10, 'mg']], 'm': 50}
TWO = {'a': [['Substance A', 10, 'mg'], ['Substance B', 20, 'mg']], 'm': 30}

CASES = [
    # (nom, produit, texte, attendu ou None)
    ('dose et rythme simples', ONE, "10 mg de substance par kg de poids corporel, deux fois par jour pendant 5 jours.", [10, None, 2, 'intake']),
    ('toutes les 12 heures', ONE, "La dose recommandée est de 5 mg/kg toutes les 12 heures.", [5, None, 2, 'intake']),
    ('une fois par jour, dose écrite par jour', ONE, "5 mg de substance par kg de poids corporel et par jour, en une prise quotidienne.", [5, None, 1, 'intake']),
    ('fourchette étroite, kilogramme écrit en toutes lettres', ONE, "De 15 à 30 mg de substance par kilogramme de poids corporel, deux fois par jour.", [15, 30, 2, 'intake']),
    ('dose par jour à répartir', ONE, "0,2 mg de substance par kg de poids corporel par jour à répartir en deux prises, matin et soir.", [0.2, None, 2, 'day']),
    ('dose doublée annoncée comme telle', ONE, "15 mg/kg deux fois par jour. Dans les cas graves, la dose peut être doublée et portée à 30 mg/kg deux fois par jour.", [15, None, 2, 'intake']),
    ('association : somme des deux substances', ASSOC, "10 mg d'amoxicilline et 2,5 mg d'acide clavulanique par kg de poids corporel, deux fois par jour.", [12.5, None, 2, 'intake']),
    ('association : dose doublée', ASSOC, "10 mg d'amoxicilline et 2,5 mg d'acide clavulanique par kg, deux fois par jour. La dose peut être doublée à 20 mg d'amoxicilline et 5 mg d'acide clavulanique par kg.", [12.5, None, 2, 'intake']),
    ('équivalence du RCP cohérente (comprimé)', ONE, "5 mg/kg une fois par jour, soit 1 comprimé pour 10 kg de poids corporel.", [5, None, 1, 'intake']),
    ('équivalence du RCP cohérente (liquide)', LIQUID, "1 mg/kg une fois par jour, soit 0,025 mL pour 1 kg.", [1, None, 1, 'intake']),

    ('plusieurs substances : on ne devine pas laquelle porte la dose', TWO, "10 mg/kg deux fois par jour.", None),
    ('phases : premier jour puis la suite', ONE, "4 mg/kg le premier jour, puis 2 mg/kg une fois par jour.", None),
    ('deux indications, deux doses', ONE, "Plaies : 5,5 mg/kg toutes les 12 heures pendant 7 jours. Autre infection : 11 mg/kg toutes les 12 heures pendant 4 semaines.", None),
    ('répartition laissée au choix', ONE, "10 mg/kg par jour. La dose journalière peut être répartie en deux prises.", None),
    ('dose par jour et deux fois par jour : ambigu', ONE, "10 mg de substance par kg par jour, deux fois par jour.", None),
    ('texte qui parle d\'autres espèces', ONE, "Chez les bovins : 20 mg/kg une fois par jour. Chez le chien : 10 mg/kg une fois par jour.", None),
    ('traitement mensuel écrit « quotidien » dans une négation', ONE, "Il ne s'agit pas d'un traitement quotidien. 2 mg/kg, répété 14 jours plus tard, puis un mois après.", None),
    ('dose unique', ONE, "Une dose unique de 8 mg/kg par voie sous-cutanée.", None),
    ('dose augmentée sous condition', ONE, "2 mg/kg une fois par jour. Si nécessaire, la dose peut être augmentée à 4 mg/kg.", None),
    ('fourchette trop large', ONE, "1 à 10 mg/kg une fois par jour.", None),
    ('microgrammes', ONE, "50 µg/kg une fois par jour.", None),
    ('rythme un jour sur deux', ONE, "2 mg/kg un jour sur deux.", None),
    ('tous les deux jours', ONE, "5 mg/kg tous les deux jours.", None),
    ('rythme variable', ONE, "5 mg/kg deux à trois fois par jour.", None),
    ('équivalence du RCP contradictoire avec la dose lue', LIQUID, "1 mg/kg trois fois par jour (équivalent à 0,1 mL pour 5 kg).", None),
    ('comprimé pour N kg contradictoire', ONE, "5 mg/kg une fois par jour, soit 1 comprimé pour 20 kg de poids corporel.", None),
    ('aucune dose en mg/kg', ONE, "Un comprimé par jour pour un chien de 10 à 20 kg.", None),
    ('aucun rythme', ONE, "5 mg/kg de poids corporel.", None),
]


def main():
    failures = 0
    for name, product, text, expected in CASES:
        got, why = build.suggest(text, product)
        if got != expected:
            failures += 1
            print(f'ÉCHEC  {name} : attendu {expected}, obtenu {got} ({why})')
    # la mise en forme du texte : balises retirées, tableaux aplatis
    flat = build.poso_text('<p>Dose :<br>5&nbsp;mg/kg</p><table><tr><td>1 kg</td><td>½</td></tr></table>')
    if '<' in flat or '5 mg/kg' not in flat or '1 kg | ½' not in flat.replace('\n', ' '):
        failures += 1
        print(f'ÉCHEC  mise en forme du texte : {flat!r}')
    if failures:
        sys.exit(1)
    print(f'OK  {len(CASES)} cas de posologie + mise en forme du texte')


if __name__ == '__main__':
    main()
