/* Směnovník – service worker: offline cache, cache-first.
 * Při nahrání nové verze appky zvyš číslo ve VERZE (např. smenovnik-v2),
 * nový sw.js se pak nainstaluje a při aktivaci smaže staré cache. */
const VERZE = 'smenovnik-v1';
const SOUBORY = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERZE).then(c => c.addAll(SOUBORY)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== VERZE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).then(res => {
      if (res.ok) { const kopie = res.clone(); caches.open(VERZE).then(c => c.put(r, kopie)); }
      return res;
    }).catch(() => r.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
