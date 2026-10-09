# Natura'Vet : injections et perf hospit

PWA de calcul des doses d'injection et de perfusion à partir du poids de l'animal.
Reprend le Google Sheet "Injections et perf hospit" : dose (mL) = poids (kg) x coefficient (mL/kg).

Un second onglet, « Ordonnance », calcule quel dosage de comprimé et combien de plaquettes remettre selon le poids et la durée du traitement.

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
- Précision d'affichage alignée sur le Sheet d'origine : 2 décimales, sauf la sédation qui en affiche jusqu'à 3 (les cellules du Sheet n'y sont pas arrondies : 0,518 mL à 25,9 kg, 0,043 mL à 4,3 kg). Réglable par section dans « Modifier » (« Précision »). L'arrondi suit celui d'Excel : une demi-unité exacte va vers le haut (5,5 kg d'Insistor chat = 0,165 s'affiche 0,17).
- Un avertissement s'affiche au-delà de 100 kg (faute de frappe probable).
- Thème clair par défaut, quel que soit le réglage du téléphone. Le bouton lune/soleil en haut bascule en mode sombre (choix mémorisé sur l'appareil).

## Ordonnance : quelle version remettre

Onglet « Ordonnance » sous la barre du poids (le poids et le filtre Chien / Chat sont communs aux deux onglets). L'appli ouvre toujours sur « Injections ».

- Catalogue : les médicaments en comprimés ou gélules que la clinique remet. « Ajouter un médicament » permet la saisie à la main (nom, dosages en stock, conditionnement). Si l'index Med'Vet est installé (voir « Données Med'Vet »), la recherche par nom ou principe actif reprend le dosage par comprimé, le conditionnement (plaquettes par boîte, comprimés par plaquette) et le caractère sécable. Tout reste modifiable. Le catalogue est enregistré sur l'appareil, comme les doses d'injection (il n'est pas partagé entre appareils).
- Posologie : jamais préremplie, à saisir pour chaque médicament depuis la fiche (lien « Fiche Med'Vet » dans la carte) : dose en mg/kg (fourchette possible), exprimée par prise ou par jour, et nombre de prises par jour. Tant qu'elle manque, aucun résultat n'est affiché.
- Durée : en jours, saisie libre ou raccourcis (3, 5, 7, 10, 14, 21, 30). Comme le poids, elle n'est jamais mémorisée et se vide avec lui.
- Résultat par médicament : le dosage retenu, le nombre de comprimés par prise (entier, demi ou quart), puis ce qu'il faut remettre pour la durée (plaquettes, boîtes ou comprimés à l'unité), avec le reste et les jours qu'il couvre. Les autres dosages en stock sont repliés dessous, avec leur propre reste.
- Choix du dosage : parmi ceux dont la dose par prise tombe dans la tolérance (±10 % par défaut) autour de la dose cible. Une dose max n'est jamais dépassée, un comprimé non sécable n'est jamais coupé, au plus 6 comprimés par prise. Si aucun dosage ne convient, le plus proche est montré avec un avertissement.
- Réglages (mémorisés) : tolérance, découpe maximale (entiers, moitiés, quarts), remise au client (boîte entière, plaquette entière, à l'unité) et classement (moins de reste, moins cher, moins de comprimés, dose la plus juste). « Moins cher » demande le prix de la boîte, facultatif. Le reste est comparé en mg, pas en nombre de comprimés.
- Limites : seules les posologies en mg/kg sont gérées (pas les produits par tranche de poids, ni les formes liquides), et seule la valeur saisie par la clinique fait foi : les posologies de Med'Vet ne sont pas reprises.

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

## Données Med'Vet (facultatif)

L'index `medvet-oral.json` (comprimés et gélules pour chien et chat, tirés d'un export du recueil Med'Vet, marque du SIMV) n'est volontairement pas dans le dépôt : les mentions légales de Med'Vet ne disent rien sur la réutilisation de ses données, et GitHub Pages le rendrait téléchargeable par tous. Sans lui, la recherche est masquée et les médicaments se saisissent à la main.

Pour l'activer : générer le fichier à la racine, ajouter `'medvet-oral.json'` à la liste `ASSETS` de `sw.js` (pour le mode hors connexion), incrémenter `CACHE`, puis publier.

```sh
python3 -I tools/build-medvet-index.py chemin/vers/medicament.xlsx medvet-oral.json
```

Il ne contient que des faits de catalogue : nom, principes actifs et dosage, espèces, conditionnement, caractère sécable, adresse de la fiche. Ni posologie, ni texte de RCP, ni image. Ne pas l'élargir sans l'accord du SIMV (contact@simv.org). Il sert à préremplir : la clinique vérifie sur la fiche du médicament.

## Crédits

- Polices : Atkinson Hyperlegible Next et Barlow Condensed, licence SIL OFL 1.1 (dossier `fonts/`).
- Pictogrammes de section : Lucide, licence ISC (`icons/LICENSE-lucide.txt`).
- Données produits facultatives de l'ordonnance : Med'Vet (SIMV), voir ci-dessus.
- Clin d'œil caché dans le pied de page (« Made with ♥ pour Dr Matz ») : un toucher sur le cœur fait apparaître un animal tiré au hasard, un second toucher le fait disparaître, et le suivant en montre un autre (jamais deux fois le même d'affilée). Animations Noto Emoji © Google, licence CC BY 4.0, réduites à 160 px et recompressées en WebP animé (`animals/`, détail dans `animals/LICENSE.txt`). Elles sont embarquées : rien n'est chargé depuis Internet, et ça marche hors connexion. Avec « réduire les animations » activé sur l'appareil, un émoji fixe remplace l'animation.

## Lancer en local

```sh
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Mettre en ligne (GitHub Pages)

Settings > Pages > Deploy from a branch > `master` / `/ (root)`.
Les chemins sont relatifs : l'appli fonctionne dans un sous-dossier (`https://<user>.github.io/injection/`).

Sur téléphone : ouvrir l'adresse dans Chrome (Android) puis "Installer l'application", ou dans Safari (iPhone) puis Partager > "Sur l'écran d'accueil".
Une fois chargée, l'appli fonctionne hors connexion.

## Mettre à jour l'appli

Après une modification de code, incrémenter `CACHE` dans `sw.js` (`injection-v2`, ...) pour que les appareils récupèrent les nouveaux fichiers.
