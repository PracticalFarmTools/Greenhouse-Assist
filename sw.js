// GrowPulse Service Worker — v1
// Caches app shell for offline use + reliable PWA install prompt
const CACHE_NAME = 'growpulse-v1';
const APP_SHELL = [
  './',
  './growpulse.html',
  './growpulse-engine.js',
  './manifest.json',
  './icon-512.png'
];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[sw] caching app shell');
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting(); // activate immediately
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of open tabs
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Skip non-GET requests
  if (e.request.method !== 'GET') return;

  // Network-first for APIs (NWS, Firebase, Govee)
  if (url.hostname !== location.hostname) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for app shell, network-first for everything else
  if (APP_SHELL.some(path => url.pathname.endsWith(path.replace('./', '')))) {
    e.respondWith(
      // Try network first so updates deploy instantly, fall back to cache
      fetch(e.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => caches.match(e.request))
    );
  } else {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
