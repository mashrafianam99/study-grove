// Offline support. Everything the app needs is on this origin (Three.js and fonts are vendored),
// so the worker never talks to third-party hosts.
const VERSION = 'grove-v6';
const APP_FILES = [
  './', './index.html', './manifest.webmanifest',
  './css/styles.css', './css/fonts.css',
  './fonts/bricolage-grotesque-latin-0.woff2', './fonts/figtree-latin-1.woff2',
  './js/app.js', './js/store.js', './js/views.js', './js/grove.js', './js/timer.js',
  './js/srs.js', './js/stats.js', './js/util.js', './js/ui.js',
  './vendor/three/three.module.js', './vendor/three/addons/OrbitControls.js', './vendor/three/addons/BufferGeometryUtils.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive), cache when offline. Only same-origin GETs are handled.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        // Cache only complete, direct, successful responses.
        if (res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          event.waitUntil(caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
        // Only page loads fall back to the app shell; a missing script or style should fail plainly.
        if (request.mode === 'navigate') return (await caches.match('./index.html')) ?? Response.error();
        return Response.error();
      }),
  );
});
