/* Směnovník – service worker: offline cache.
 * Stránka se načítá nejdřív ze sítě (nová verze je vidět hned), offline z cache.
 * Ostatní vlastní soubory z cache a na pozadí se obnoví (příště už nové).
 * Knihovny Firebase mají verzi v adrese, takže se jen jednou stáhnou a drží v cache.
 * Při větší změně zvyš VERZE (např. smenovnik-v6), staré cache se pak smažou. */
const VERZE = 'smenovnik-v5';
const SOUBORY = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'firebase-config.js'];
const FIREBASE = 'https://www.gstatic.com/firebasejs/';

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
  if (r.method !== 'GET') return;
  const vlastni = new URL(r.url).origin === self.location.origin;
  if (!vlastni && !r.url.startsWith(FIREBASE)) return;
  const uloz = res => {
    if (res.ok) { const kopie = res.clone(); caches.open(VERZE).then(c => c.put(r, kopie)); }
    return res;
  };
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(uloz).catch(() =>
      caches.match(r, { ignoreSearch: true }).then(hit => hit || caches.match('index.html'))));
    return;
  }
  if (!vlastni) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(uloz)));
    return;
  }
  const sit = fetch(r).then(uloz);
  e.waitUntil(sit.catch(() => {}));
  e.respondWith(caches.match(r, { ignoreSearch: true }).then(hit => hit || sit).catch(() => Response.error()));
});

/* Notifikace z týmu (posílá je server push/worker.js) – ukážou se i při zavřené aplikaci. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Směnovník', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icon-192.png', lang: 'cs',
    data: { url: d.url || './' }
  }));
});
/* klepnutí na notifikaci: otevřít aplikaci (nebo přepnout do už otevřené) na správném místě */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(okna => {
    const okno = okna.find(o => o.url.startsWith(self.registration.scope));
    if (okno) { okno.postMessage({ otevri: url }); return okno.focus(); }
    return self.clients.openWindow(url);
  }));
});
