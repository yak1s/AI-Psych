// Offline cache (stale-while-revalidate). A refresh keeps working during short
// internet outages; new deploys are picked up on the following load.
const CACHE = 'aipsych-v9';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './assets/icon.svg',
  './assets/fonts/finger-paint.woff2',
  './assets/fonts/patrick-hand.woff2',
  './assets/fonts/caveat.woff2',
  './js/main.js',
  './js/config.js',
  './js/storage.js',
  './js/host-controller.js',
  './js/player-controller.js',
  './js/game/util.js',
  './js/game/deck.js',
  './js/game/starter.js',
  './js/game/engine.js',
  './js/game/dynamic.js',
  './js/signals.js',
  './js/stats.js',
  './js/net/host-net.js',
  './js/net/client-net.js',
  './js/net/mqtt.js',
  './js/net/secure.js',
  './js/ui/app.js',
  './js/ui/art.js',
  './js/ui/audio.js',
  './js/ui/common.js',
  './js/ui/home.js',
  './js/ui/lobby.js',
  './js/ui/game.js',
  './js/ui/results.js',
  './js/ui/lines.js',
  './js/ui/chat.js',
  './js/ui/people.js',
  './js/ui/notify.js',
  './js/ui/fullscreen.js',
  './js/ui/deckprompt.js',
  './js/vendor/preact-htm.js',
  './js/vendor/peer.js',
  './js/vendor/qrcode.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return fresh;
    }),
  );
});

// Tapping a reminder brings the game back to the front.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow ? self.clients.openWindow('./') : null;
    }),
  );
});
