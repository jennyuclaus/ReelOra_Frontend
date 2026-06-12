// ReelOra Service Worker
const CACHE_NAME = 'reelora-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/series.js',
  '/logo.png',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Jost:wght@300;400;500;600&display=swap'
];

// Install – statische Assets cachen
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('http')));
    })
  );
  self.skipWaiting();
});

// Activate – alte Caches löschen
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch – Cache-First für statische Assets, Network-First für API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API-Calls (TMDB, Vercel Backend) → immer Netzwerk
  if (url.hostname.includes('themoviedb.org') ||
      url.hostname.includes('vercel.app') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('accounts.google.com')) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Statische Assets → Cache-First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline-Fallback für Navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// Background Sync für Drive (falls offline gespeichert)
self.addEventListener('sync', event => {
  if (event.tag === 'drive-sync') {
    event.waitUntil(
      self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'SYNC_DRIVE' }));
      })
    );
  }
});
