# Natura'Vet : injections et perf hospit

PWA de calcul des doses d'injection et de perfusion à partir du poids de l'animal.
Reprend le Google Sheet "Injections et perf hospit" : dose (mL) = poids (kg) x coefficient (mL/kg).

Un second onglet, « Ordonnance », choisit dans le catalogue Med'Vet l'article le mieux adapté selon le poids, la posologie et la durée du traitement, pour avoir le moins de reste possible : comprimés, gélules, liquides buvables, injectables, et spot-on (choisis selon le poids).

Fichiers statiques uniquement (HTML, CSS, JS, un index JSON), aucun build, aucune dépendance.

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

## Ordonnance : quel article Med'Vet remettre

Onglet « Ordonnance » sous la barre du poids (le poids et le filtre Chien / Chat sont communs aux deux onglets). L'appli ouvre toujours sur « Injections ».

- Principe : on donne la substance, la posologie, le poids et la durée ; l'appli croise tout le catalogue Med'Vet (toutes les marques, tous les dosages, tous les conditionnements de la substance, comprimés comme liquides) et propose l'article qui donne la dose avec le moins de reste. Les articles de marques différentes qui donnent exactement le même résultat (même dosage, même forme, même conditionnement) sont regroupés : l'un est proposé, les autres sont listés dessous comme « équivalents » avec leur GTIN et leur fiche. Les autres articles possibles sont repliés plus bas.
- Catalogue : « Ajouter un médicament » cherche dans l'index Med'Vet (nom, marque, principe actif, forme ou GTIN de la boîte) ; le médicament créé porte le nom de la substance (« Méloxicam ») et la voie du produit choisi : orale, injectable ou spot-on. Un même principe actif a donc une carte par voie, sans mélange (un injectable n'est jamais proposé à la place d'un comprimé). Dans « Modifier », la voie et la substance se changent et la marque peut être fixée (« Toutes les marques » par défaut). L'espèce du filtre Chien / Chat restreint les articles à ceux autorisés pour elle. Le catalogue est enregistré sur l'appareil, comme les doses d'injection (il n'est pas partagé entre appareils).
- Posologie : jamais préremplie, à saisir pour chaque médicament : dose en mg/kg (fourchette possible), exprimée par prise ou par jour, et nombre de prises par jour. Elle reste celle de la clinique : deux marques d'une même substance peuvent avoir des posologies différentes, d'où le lien « Fiche Med'Vet » sur chaque article proposé. Tant qu'elle manque, aucun résultat n'est affiché.
- Associations : seule l'amoxicilline + acide clavulanique est gérée, dosée en mg d'association (somme des deux substances, 12,5 mg/kg par exemple). Les autres associations ne sont pas proposées.
- Durée : en jours, saisie libre ou raccourcis (3, 5, 7, 10, 14, 21, 30). Comme le poids, elle n'est jamais mémorisée et se vide avec lui.
- Résultat : l'article (forme, conditionnement, espèces, fiche Med'Vet, GTIN à copier d'un toucher : un code par taille de boîte quand plusieurs sont regroupées), la quantité par prise (nombre de comprimés entier, demi ou quart ; ou volume en mL pour un liquide, à la graduation de la seringue), puis ce qu'il faut remettre pour la durée (plaquettes, boîtes ou comprimés à l'unité ; flacons ou boîtes de flacons pour un liquide), avec le reste en mg et les jours qu'il couvre. En remise par plaquette ou à l'unité, les boîtes de tailles différentes d'un même produit sont regroupées, puisque la plaquette remise est la même.
- Choix de l'article : parmi ceux dont la dose par prise tombe dans la tolérance (±10 % par défaut) autour de la dose cible. Une dose max n'est jamais dépassée, un comprimé non sécable n'est jamais coupé (si le libellé Med'Vet ne dit pas « sécable », il est considéré comme non sécable), au plus 6 comprimés ou 30 mL par prise. Si aucun article ne convient, le plus proche est montré avec un avertissement.
- Réglages (mémorisés) : articles proposés (tout Med'Vet ou « Mon stock »), tolérance, découpe maximale (entiers, moitiés, quarts), graduation de la seringue pour les liquides (0,01, 0,05 ou 0,1 mL), remise au client (boîte entière, plaquette ou flacon entier, à l'unité) et classement (moins de reste, moins cher, moins de comprimés, dose la plus juste). Le reste est comparé en mg, pas en nombre de comprimés : à dose égale, changer de dosage change peu le reste, ce qui compte c'est la taille de la plaquette. « Moins cher » ne sert qu'avec des dosages saisis à la main, car Med'Vet ne donne pas de prix.
- « Mon stock » : un médicament peut aussi garder ses propres dosages saisis à la main (mg par comprimé, comprimés par plaquette, plaquettes par boîte, prix de la boîte), utilisés quand il n'a pas de substance ou quand « Mon stock » est choisi dans les réglages.
- Injectables : même calcul que les liquides buvables (volume par injection à la graduation de la seringue, flacons ou ampoules), avec « Par injection » et « À ouvrir » à la place de « Par prise » et « À remettre ». Seuls les injectables à une substance de concentration connue en mg/mL sont proposés : pas de vaccins, d'insuline (en UI) ni de solutés, la fluidothérapie restant dans l'onglet Injections.
- Spot-on : pas de posologie, l'article se choisit selon le poids d'après la tranche écrite dans le libellé du produit (« chiens de 10 à 20 kg », « > 4–10 kg », « ≤ 2,5 kg »). L'appli donne l'article dont la tranche contient le poids, avec sa pipette, sa boîte et son GTIN ; si l'on indique l'intervalle entre deux applications (« Modifier ») et la durée, elle compte les pipettes et choisit la boîte qui laisse le moins de reste. Un poids hors de toutes les tranches est signalé, avec la tranche la plus proche. Les spot-on dont le libellé ne donne pas de tranche (Frontline, Fiprotec, Effitix et leurs génériques ne parlent que de « petit », « moyen » ou « grand » chien) ne sont jamais proposés au hasard : ils sont comptés et renvoyés vers la fiche Med'Vet.
- Recherche : par nom, marque, principe actif, forme ou GTIN de la boîte. Une faute de frappe est tolérée quand rien ne correspond exactement (« meloxodyl » trouve Meloxidyl), sauf sur les chiffres.
- Limites : seules les posologies en mg/kg sont gérées pour la voie orale et les injectables (pas les comprimés par tranche de poids comme NexGard, ni les pâtes, gels et poudres, ni les colliers, vaccins ou aliments), les autres associations sont écartées, et seule la valeur saisie par la clinique fait foi : les posologies de Med'Vet ne sont pas reprises. L'appli propose, la vétérinaire décide.

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

## Données Med'Vet

`medvet-oral.json` est l'index des articles pour chien et chat tiré d'un export du recueil Med'Vet (marque du SIMV), publié avec l'accord du SIMV (GTIN compris) : 738 produits, dont 538 par voie orale (comprimés, gélules, liquides buvables), 77 injectables et 123 spot-on. Les autres espèces (bovins, porcins, chevaux...) et les autres formes (colliers, vaccins, aliments, biocides, matériel) ne sont pas retenues, et l'export complet n'est pas dans le dépôt. Il ne contient que des faits de catalogue : nom, principe actif et dosage (ou concentration en mg/mL), espèces, conditionnement (comprimés par plaquette, volume du contenant, pipettes par boîte), GTIN de chaque présentation, caractère sécable, tranche de poids d'un spot-on quand le libellé l'écrit, adresse de la fiche. Ni posologie, ni texte de RCP, ni image.

Règles de lecture, pour ne pas calculer sur une donnée douteuse :
- Le dosage est celui de l'étiquette (écrit dans la dénomination) quand il diffère de la composition : un comprimé étiqueté « Nelio 2,5 mg » contient 2,3 mg de bénazépril base, mais la posologie se réfère à 2,5 mg. Quand l'écart est inexplicable (plus de 25 %, par exemple « Zenrelia 15 mg » face à une composition de 8,5 mg), le dosage n'est pas deviné : il est à saisir.
- Un liquide ou un injectable n'est retenu que s'il a une seule substance, une concentration sûre (en mg/mL, ou écrite dans la dénomination) et un volume de contenant lisible. Quatorze liquides et 91 injectables (vaccins, insuline, cellules, produits dont la concentration n'est pas en mg/mL) sont écartés pour cette raison, ainsi que 6 solutés.
- L'espèce est lue aussi dans la dénomination quand la liste des espèces la contredit (« Selames 60 mg pour chiens » listé pour le chat) ; une dénomination qui ne cite que des bovins, porcins ou chevaux est écartée.
- Pour un spot-on, la tranche de poids n'est retenue que si elle est écrite dans la dénomination ou la présentation (55 spot-on sur 123). Lire les tranches dans les RCP en couvrirait davantage, mais ce sont des textes de posologie : à faire seulement avec un nouvel accord du SIMV.
- Les GTIN sont vérifiés (longueur et chiffre de contrôle). Med'Vet les donne sur 14 chiffres, l'appli affiche l'EAN-13 de la boîte (sans le zéro de remplissage) et accepte les deux dans la recherche.
- Seule l'association amoxicilline + acide clavulanique est gérée, dosée en mg d'association (somme des deux substances).

Il se charge à l'ouverture de l'onglet Ordonnance, puis reste en cache pour le mode hors connexion. S'il manque, la recherche est masquée et les médicaments se saisissent à la main. Il se régénère avec :

```sh
python3 -I tools/build-medvet-index.py chemin/vers/medicament.xlsx medvet-oral.json
```

L'index ne doit pas être élargi aux posologies ni aux textes sans nouvel accord du SIMV (contact@simv.org). Il sert à préremplir : la clinique vérifie sur la fiche du médicament.

## Crédits

- Polices : Atkinson Hyperlegible Next et Barlow Condensed, licence SIL OFL 1.1 (dossier `fonts/`).
- Pictogrammes de section : Lucide, licence ISC (`icons/LICENSE-lucide.txt`).
- Données produits de l'ordonnance : Med'Vet (SIMV), voir ci-dessus.
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
