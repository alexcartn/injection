// Doses par défaut, en mL par kg de poids (mL/kg/h pour la fluidothérapie).
// Elles viennent des formules du classeur de la clinique : dose = poids x coefficient.
//   min     coefficient (obligatoire)
//   max     coefficient haut si la dose est une fourchette (optionnel)
//   route   voie d'administration (optionnel)
//   note    texte libre (optionnel)
//   species 'CN' (chien), 'CT' (chat), ou absent pour les deux
//   group   sous-titre pour regrouper des lignes d'une même section (optionnel)
// Chaque section a aussi une icône (clé de section-icons.js, vide = aucune) et, en option,
// decimals : nombre maximal de décimales affichées pour les volumes (2 par défaut).
// La sédation est à 3 : dans le Sheet ces cellules ne sont pas arrondies (0,518 et non 0,52).
//
// Deux modèles, comme les onglets du classeur :
//   hospit  l'onglet "Injections et perf hospit"
//   ambu    les onglets "Chirurgie ambulatoire" : mêmes coefficients, mais Sedator à la place de
//           Dormilan, Trymox à la place de Shotapen, Comfortan à la place d'Insistor, sans sédation.
// Les sections identiques dans les deux onglets sont définies une seule fois ci-dessous.

const gazeuse = {
  title: 'Anesthésie gazeuse',
  icon: 'wind',
  unit: 'mL',
  items: [
    { name: 'Diazépam', min: 0.1, route: 'IV' },
    { name: 'Propofol', min: 0.4, route: 'IV' },
  ],
};

const ains = {
  title: 'AINS',
  icon: 'flame',
  unit: 'mL',
  items: [
    { name: 'Metacam', min: 0.04, route: 'SC', species: 'CN' },
    { name: 'Metacam', min: 0.1, route: 'SC', species: 'CT' },
    { name: 'Onsior', min: 0.1, route: 'SC' },
  ],
};

const bupaq = {
  name: 'Bupaq',
  min: 0.03,
  max: 0.06,
  route: 'IM, IV',
  note: 'Effet 4h (dose mini), 6h (dose max). Chat : refaire à +2h si besoin',
};

const fluidotherapie = {
  title: 'Fluidothérapie',
  icon: 'iv-bag',
  unit: 'mL/h',
  items: [
    { name: 'Perfusion d’entretien', min: 2, route: 'IV' },
    { name: 'Perfusion, déshydraté', min: 5, route: 'IV', species: 'CN' },
    { name: 'Perfusion, déshydraté', min: 4, route: 'IV', species: 'CT' },
  ],
};

export const MODELS = {
  hospit: {
    label: 'Hospit',
    title: 'Injections et perf hospit',
    sections: [
      {
        title: 'Anesthésie fixe',
        icon: 'syringe',
        unit: 'mL',
        items: [
          { name: 'Kétamine', min: 0.1, group: 'Kétamine + Xylazine' },
          { name: 'Xylazine', min: 0.1, group: 'Kétamine + Xylazine' },
          { name: 'Kétamine', min: 0.08, group: 'Kétamine + Dormilan' },
          { name: 'Dormilan', min: 0.08, group: 'Kétamine + Dormilan' },
          { name: 'Zoletil', min: 0.025, group: 'Zoletil + Dormilan' },
          { name: 'Dormilan', min: 0.025, group: 'Zoletil + Dormilan' },
        ],
      },
      {
        title: 'Sédation',
        icon: 'moon',
        decimals: 3,
        unit: 'mL',
        items: [
          { name: 'Torbugésic', min: 0.02, route: 'IM', species: 'CT' },
          { name: 'Dormilan', min: 0.02, route: 'IM', species: 'CT' },
          { name: 'Antidorm', min: 0.01, species: 'CT' },
          { name: 'Torbugésic', min: 0.01, route: 'IV', species: 'CN' },
          { name: 'Dormilan', min: 0.01, route: 'IV', species: 'CN' },
          { name: 'Antidorm', min: 0.01, species: 'CN' },
        ],
      },
      gazeuse,
      {
        title: 'Antibiothérapie',
        icon: 'pill',
        unit: 'mL',
        items: [{ name: 'Shotapen', min: 0.1, route: 'SC' }],
      },
      ains,
      {
        title: 'Analgésie',
        icon: 'zap-off',
        unit: 'mL',
        items: [
          { name: 'Insistor', min: 0.05, max: 0.1, route: 'SC, IM, IV', note: 'Effet 4h', species: 'CN' },
          { name: 'Insistor', min: 0.03, max: 0.06, route: 'SC, IM, IV', note: 'Effet 4h', species: 'CT' },
          bupaq,
        ],
      },
      fluidotherapie,
    ],
  },

  ambu: {
    label: 'Ambulatoire',
    title: 'Chirurgie ambulatoire',
    sections: [
      {
        title: 'Anesthésie fixe',
        icon: 'syringe',
        unit: 'mL',
        items: [
          { name: 'Kétamine', min: 0.1, group: 'Kétamine + Xylazine' },
          { name: 'Xylazine', min: 0.1, group: 'Kétamine + Xylazine' },
          { name: 'Kétamine', min: 0.08, group: 'Kétamine + Sedator' },
          { name: 'Sedator', min: 0.08, group: 'Kétamine + Sedator' },
          { name: 'Zoletil', min: 0.025, group: 'Zoletil + Sedator' },
          { name: 'Sedator', min: 0.025, group: 'Zoletil + Sedator' },
        ],
      },
      gazeuse,
      {
        title: 'Antibiothérapie',
        icon: 'pill',
        unit: 'mL',
        items: [{ name: 'Trymox', min: 0.1, route: 'SC' }],
      },
      ains,
      {
        title: 'Analgésie',
        icon: 'zap-off',
        unit: 'mL',
        items: [
          { name: 'Comfortan', min: 0.05, max: 0.1, route: 'SC, IM, IV', note: 'Effet 4h', species: 'CN' },
          { name: 'Comfortan', min: 0.03, max: 0.06, route: 'SC, IM, IV', note: 'Effet 4h', species: 'CT' },
          bupaq,
        ],
      },
      fluidotherapie,
    ],
  },
};

export const DEFAULT_MODEL = 'hospit';

// Alias conservé pour les outils de contrôle : les doses du modèle par défaut.
export const DEFAULT_SECTIONS = MODELS[DEFAULT_MODEL].sections;
