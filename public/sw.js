// Prismo PWA Service Worker — network-first with versioned cache
// IMPORTANT: Bump version on every deploy to bust stale chunks
const CACHE_VERSION = 'prismo-v2-' + Date.now();
const STATIC_CACHE = 'prismo-static-v2';

// Install: skip waiting immediately to activate new SW
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: purge ALL old caches so stale chunks are never served
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: NETWORK-FIRST for everything (live data app)
// Static assets get cached AFTER successful network fetch (stale-while-revalidate pattern)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // For static assets: network-first, fall back to cache
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // Cache the fresh response for offline fallback
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
