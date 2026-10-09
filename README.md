# Injections et perf hospit

PWA de calcul des doses d'injection et de perfusion à partir du poids de l'animal.
Reprend le Google Sheet "Injections et perf hospit" : dose (mL) = poids (kg) x coefficient (mL/kg).

Fichiers statiques uniquement (HTML, CSS, JS), aucun build, aucune dépendance.

## Utilisation

- Saisir le poids (virgule ou point). Les doses se calculent à chaque frappe.
- Filtre Tous / Chien / Chat pour masquer les lignes de l'autre espèce.
- Le poids n'est jamais mémorisé : il faut le ressaisir à chaque ouverture, pour ne pas réutiliser par erreur le poids du patient précédent.
- La croix dans le champ Poids l'efface d'un geste entre deux patients.
- Un avertissement s'affiche au-delà de 100 kg (faute de frappe probable).
- Thème clair par défaut, quel que soit le réglage du téléphone. Le bouton lune/soleil en haut bascule en mode sombre (choix mémorisé sur l'appareil).

## Modifier les doses

Bouton "Modifier" : coefficient (et dose max pour une fourchette), nom, voie, espèce, groupe, note. On peut ajouter ou supprimer des médicaments et des sections.
Les modifications sont enregistrées dans le navigateur de l'appareil (elles ne sont pas partagées entre appareils).
"Rétablir les doses d'origine" revient aux valeurs de `data.js`.

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
