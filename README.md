# Natura'Vet : injections et perf hospit

PWA de calcul des doses d'injection et de perfusion à partir du poids de l'animal.
Reprend le Google Sheet "Injections et perf hospit" : dose (mL) = poids (kg) x coefficient (mL/kg).

Fichiers statiques uniquement (HTML, CSS, JS), aucun build, aucune dépendance.

## Utilisation

- Saisir le poids (virgule ou point). Les doses se calculent à chaque frappe.
- Filtre Tous / Chien / Chat pour masquer les lignes de l'autre espèce.
- Téléphone : la barre en bas liste les sections. Un toucher y saute, la section en cours est soulignée. Elle s'efface pendant la saisie du poids et en mode paysage. Seule la barre poids + espèce reste collée en haut.
- Grand écran : marque, poids, espèce et actions tiennent sur une seule ligne collée en haut, les sections s'affichent en colonnes.
- Le poids n'est jamais mémorisé : il faut le ressaisir à chaque ouverture, pour ne pas réutiliser par erreur le poids du patient précédent.
- La croix dans le champ Poids l'efface d'un geste entre deux patients.
- Case à cocher devant chaque médicament pour repérer ce qui est déjà prélevé (la ligne s'estompe). Les cases sont vidées à chaque nouveau poids ou quand le poids est effacé.
- Arrondi à la seringue (Aucun, 0,01, 0,05 ou 0,1 mL), dans « Réglages » sous le poids, mémorisé sur l'appareil. Il ne s'applique qu'aux volumes en mL, pas aux débits de perfusion. Si l'arrondi change la dose de plus de 10 % (ou la ramènerait à zéro), la valeur exacte est conservée et signalée. Quand une dose est arrondie, la valeur calculée reste affichée.
- Perfusion : choix du set (20 ou 60 gouttes/mL) dans la section Fluidothérapie, la ligne affiche le débit en gouttes par minute en plus des mL/h.
- Dose en mg : à renseigner par médicament (concentration en mg/mL, dans "Modifier"). Les mg sont calculés sur le volume affiché, donc sur le volume arrondi si l'arrondi est actif. Sans concentration, rien n'est affiché. Aucune concentration n'est préremplie.
- Fiche d'hospitalisation : dans « Fiche et réglages », saisir le nom de l'animal (facultatif, sinon une ligne à remplir à la main) et des notes (imprimées dans le cadre « Notes et observations », au-dessus de lignes vides pour écrire encore à la main), choisir les sections à imprimer et la présence du cadre de notes (mémorisé), puis « Imprimer la fiche ». Elle sort en A4, noir et blanc quel que soit le thème, avec le nom, l'espèce, le poids, la date, des cases vides à cocher à la main et la signature de la clinique. Elle suit le filtre Chien / Chat / Tous et l'arrondi en cours. « Enregistrer au format PDF » dans la fenêtre d'impression en fait un PDF dont le nom contient le nom de l'animal, le poids et la date. Le nom et les notes ne sont jamais mémorisés et s'effacent avec le poids. Pour tenir sur une page, retirer les sections d'anesthésie : antibiotique, AINS, analgésie, perfusion et notes tiennent sur une page.
- Un avertissement s'affiche au-delà de 100 kg (faute de frappe probable).
- Thème clair par défaut, quel que soit le réglage du téléphone. Le bouton lune/soleil en haut bascule en mode sombre (choix mémorisé sur l'appareil).

## Modifier les doses

Bouton "Modifier" : coefficient (et dose max pour une fourchette), nom, voie, espèce, concentration, groupe, note. On peut ajouter ou supprimer des médicaments et des sections. Chaque section est un accordéon replié par défaut : on n'ouvre que celle à modifier.
Les modifications sont enregistrées dans le navigateur de l'appareil (elles ne sont pas partagées entre appareils).
"Rétablir les doses d'origine" revient aux valeurs de `data.js`.

## Design

Signature discrète de la clinique (Natura'Vet, vétérinaire à Mourmelon-le-Grand) en capitales condensées dans l'en-tête, le pied de page et la fiche imprimée : pas de logo, uniquement la typographie de l'appli.

Direction « instrument de précision » : dose en grand, pointillés guides du nom vers la valeur, voie d'administration encadrée, unités toujours en casse d'origine. Le contexte de design est décrit dans `.impeccable.md`.

Pictogrammes de section au trait (seringue, lune, souffle, gélule, flamme, éclair barré, poche de perfusion), à gauche du titre et dans la barre du bas. Tracés tirés de Lucide (https://lucide.dev, licence ISC, texte dans `icons/LICENSE-lucide.txt`). L'icône de chaque section se choisit, ou se retire, dans « Modifier ».

Polices hébergées dans `fonts/` (donc disponibles hors connexion), sous licence SIL OFL 1.1 :
Atkinson Hyperlegible Next (interface) et Barlow Condensed (chiffres et petites capitales). Les textes de licence sont à côté des fichiers.

## Crédits

- Polices : Atkinson Hyperlegible Next et Barlow Condensed, licence SIL OFL 1.1 (dossier `fonts/`).
- Pictogrammes de section : Lucide, licence ISC (`icons/LICENSE-lucide.txt`).
- Clin d'œil caché dans le pied de page (« Made with ♥ pour Dr Matz ») : un toucher sur le cœur fait apparaître un animal tiré au hasard, jamais deux fois le même d'affilée. Animations Noto Emoji © Google, licence CC BY 4.0, réduites à 160 px et recompressées en WebP animé (`animals/`, détail dans `animals/LICENSE.txt`). Elles sont embarquées : rien n'est chargé depuis Internet, et ça marche hors connexion. Avec « réduire les animations » activé sur l'appareil, un émoji fixe remplace l'animation.

## Lancer en local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mettre en ligne (GitHub Pages)

Settings > Pages > Deploy from a branch > `main` / `/ (root)`.
Les chemins sont relatifs : l'appli fonctionne dans un sous-dossier (`https://<user>.github.io/injection/`).

Sur téléphone : ouvrir l'adresse dans Chrome (Android) puis "Installer l'application", ou dans Safari (iPhone) puis Partager > "Sur l'écran d'accueil".
Une fois chargée, l'appli fonctionne hors connexion.

## Mettre à jour l'appli

Après une modification de code, incrémenter `CACHE` dans `sw.js` (`injection-v2`, ...) pour que les appareils récupèrent les nouveaux fichiers.
