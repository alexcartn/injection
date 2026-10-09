// Service worker : l'appli fonctionne hors connexion.
// Incrémenter CACHE à chaque déploiement pour forcer la mise à jour des fichiers.
const CACHE = 'injection-v17';

// Les animations de l'easter egg vivent dans un cache à part : elles ne changent pas, donc
// elles ne sont pas retéléchargées à chaque nouvelle version de l'appli.
const EGG_CACHE = 'injection-egg-v1';

const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'data.js',
  'rx.js',
  'medvet-oral.json',
  'section-icons.js',
  'animals.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'fonts/atkinson-hyperlegible-next-latin-wght-normal.woff2',
  'fonts/barlow-condensed-latin-600-normal.woff2',
  'fonts/barlow-condensed-latin-700-normal.woff2',
];

const EGG_ASSETS = [
  'animals/chat-hilare.webp',
  'animals/chat.webp',
  'animals/chien.webp',
  'animals/lapin.webp',
  'animals/herisson.webp',
  'animals/renard.webp',
  'animals/panda.webp',
  'animals/vache.webp',
  'animals/loutre.webp',
  'animals/poisson-ballon.webp',
  'animals/poussin.webp',
  'animals/hibou.webp',
  'animals/singe.webp',
];

// Ne télécharge que les animations pas encore en cache.
async function precacheEgg() {
  const cache = await caches.open(EGG_CACHE);
  const missing = [];
  for (const url of EGG_ASSETS) if (!(await cache.match(url))) missing.push(url);
  await cache.addAll(missing);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE).then((cache) => cache.addAll(ASSETS)),
      // l'easter egg ne doit jamais empêcher l'installation de l'appli
      precacheEgg().catch(() => {}),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== EGG_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Réponse immédiate depuis le cache, puis mise à jour du cache en arrière-plan.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const target = url.pathname.includes('/animals/') ? EGG_CACHE : CACHE;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(target).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      return refresh;
    }),
  );
});
