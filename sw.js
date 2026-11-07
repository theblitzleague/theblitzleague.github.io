/* Offline support for the installed app. Same-origin GET requests only; Sleeper's API and photos go straight to the network.
   Pages, scripts, styles and data: network first, revalidated with the server (so updates show at once), saved copy when offline.
   Images under assets/: saved copy first (they rarely change). Bump VERSION to drop every saved copy. */
const VERSION = 'blitz-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const save = res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(save)));
  } else {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(save).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || Response.error())));
  }
});
