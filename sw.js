/* Offline support for the installed app. Same-origin GET requests only; Sleeper's API and photos go straight to the network.
   Pages, scripts, styles and data: network first, revalidated with the server (so updates show at once), saved copy when offline.
   Images under assets/: the saved copy shows at once and is refreshed from the server in the background, so a swapped
   image (same file name, new art) shows on the next open. Bump VERSION to drop every saved copy. */
const VERSION = 'blitz-v7';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const save = res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };
  if (url.pathname.includes('/assets/')) {
    const fresh = fetch(req, { cache: 'no-cache' }).then(save);
    e.respondWith(caches.match(req).then(hit => (hit ? (e.waitUntil(fresh.catch(() => {})), hit) : fresh)));
  } else {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(save).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || Response.error())));
  }
});

// Phone notifications (sent by functions/index.js through Firebase Cloud Messaging). Messages are data-only, so this
// worker always draws the notification itself; iPhones require every push to show one.
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { data: { body: e.data ? e.data.text() : '' } }; }
  const d = m.data || {}, n = m.notification || {};
  const title = d.title || n.title || 'Blitz Hub', body = d.body || n.body || '';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, { body, tag: d.tag || undefined, data: { url: d.url || './' },
      icon: 'assets/icons/icon-192.png', badge: 'assets/icons/favicon-32.png' }),
    // If Blitz Hub is open on screen, it shows the announcement itself (iOS may not show a banner over the open app).
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ kind: d.kind || 'announcement' }))),
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.navigate(url).then(c => (c || open).focus()) : clients.openWindow(url);
  }));
});
