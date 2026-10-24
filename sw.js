// Service Worker: speichert die App-Dateien, damit Jarvis schnell startet
// und installierbar ist. Bei Änderungen an den Dateien VERSION erhöhen!
const VERSION = 'jarvis-v15';
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
  './js/core/listen-loop.js',
  './js/core/skills.js',
  './js/core/timers.js',
  './js/core/prompt.js',
  './js/core/memory.js',
  './js/core/memory-commands.js',
  './js/core/prefs.js',
  './js/core/url-check.js',
  './js/core/confirm-voice.js',
  './js/core/ai.js',
  './js/core/assistant.js',
  './js/core/sentences.js',
  './js/core/realtime/index.js',
  './js/core/realtime/protocol.js',
  './js/core/realtime/transport.js',
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
  './js/core/tools/defs/briefing-tools.js',
  './js/core/tools/defs/memory-tools.js',
  './js/core/boot.js',
  './js/core/briefing/index.js',
  './js/core/briefing/trigger.js',
  './js/core/briefing/state.js',
  './js/core/briefing/sanitize.js',
  './js/core/briefing/net.js',
  './js/core/briefing/weather.js',
  './js/core/briefing/news.js',
  './js/core/briefing/location.js',
  './js/core/briefing/gather.js',
  './js/core/briefing/compose.js',
  './js/core/briefing/commands.js',
  './js/core/briefing/evening-config.js',
  './js/core/briefing/evening.js',
  './js/core/briefing/weekly-config.js',
  './js/core/briefing/weekly.js',
  './js/core/app-match.js',
  './js/core/calendar-draft.js',
  './js/core/files.js',
  './js/core/listen-launch.js',
  './js/core/notes.js',
  './js/core/reminders.js',
  './js/core/tools/defs/device-tools.js',
  './js/core/tools/defs/file-tools.js',
  './js/core/tools/defs/reminder-tools.js',
  './js/core/tools/risk.js',
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
