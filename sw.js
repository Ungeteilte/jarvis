// Service Worker: speichert die App-Dateien, damit Jarvis schnell startet
// und installierbar ist. Bei Änderungen an den Dateien VERSION erhöhen!
const VERSION = 'jarvis-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/core/storage.js',
  './js/core/settings.js',
  './js/core/persona.js',
  './js/core/wakeword.js',
  './js/core/wake-controller.js',
  './js/core/skills.js',
  './js/core/timers.js',
  './js/core/prompt.js',
  './js/core/ai.js',
  './js/core/assistant.js',
  './js/adapters/web-storage.js',
  './js/adapters/web-tts.js',
  './js/adapters/web-stt.js',
  './js/adapters/web-audio.js',
  './js/adapters/web-device.js',
  './js/core/tools/index.js',
  './js/core/tools/loop.js',
  './js/core/tools/definitions.js',
  './js/core/tools/triggers.js',
  './js/core/tools/registry.js',
  './js/ui/view.js',
  './js/ui/settings-view.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Nur eigene GET-Anfragen werden aus dem Cache bedient (Netzwerk zuerst,
// damit Updates sofort ankommen). API-Aufrufe (andere Domains) laufen normal.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
