/* Finances service worker: app shell cache-first, data network-first (offline fallback). */
const SHELL_CACHE = 'finances-shell-e80098724c';
const DATA_CACHE = 'finances-data';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const DATA_RE = /\/(data\.json|data\.enc\.json|build\.json)$/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('finances-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (DATA_RE.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const res = await fetch(req, {cache: 'no-store'});
        if (res.ok) cache.put(url.pathname, res.clone());
        else if (res.status === 404) cache.delete(url.pathname);
        return res;
      } catch (err) {
        const hit = await cache.match(url.pathname);
        if (hit) { const h = new Headers(hit.headers); h.set('X-From-Cache', '1'); return new Response(await hit.blob(), {status: 200, headers: h}); }
        throw err;
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, {ignoreSearch: true}) || (url.pathname.endsWith('/') && await cache.match('index.html'));
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('Offline', {status: 503});
  })());
});
