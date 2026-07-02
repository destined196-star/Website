// Admin PWA Service Worker
const CACHE = 'dmg-admin-v1';
const PRECACHE = [
  '/admin',
  '/admin.js',
  '/styles.css',
  '/favicon.svg',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/admin-manifest.json'
];

// Install: precache static admin assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - API calls: network-only (never serve stale auth/data)
// - Static assets: cache-first, fallback network
// - Admin HTML: network-first, fallback cache (so fresh content when online)
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache API, login, or cross-origin requests
  if (url.pathname.startsWith('/api/') || url.pathname === '/login.html') return;
  if (url.origin !== self.location.origin) return;

  // Admin HTML — network first, fallback to cache
  if (url.pathname === '/admin' || url.pathname === '/admin.html') {
    e.respondWith(
      fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/admin'))
    );
    return;
  }

  // Static assets — cache first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
