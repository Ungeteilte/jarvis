// v0.9: Einstellungen neu gegliedert – Speicher-Schlüssel und Werte bleiben unverändert (kein Datenverlust beim Update)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../js/core/settings.js';
import { createStore } from '../js/core/storage.js';

function memStore(init = {}) {
  const mem = new Map(Object.entries(init));
  return createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
}

const V081 = {
  provider: 'gemini', apiKeys: { gemini: 'k-alt', xai: 'x-alt' }, models: { gemini: 'gemini-3.6-flash' }, customBaseUrl: 'https://x.test/v1',
  speak: false, wakeWord: true, wakeMuteBeep: false, memoryToAI: false,
  prefs: { antwortlaenge: 'kurz', anrede: 'du', humor: 'wenig' },
  briefing: { enabled: true, gapHours: 6, latestHour: 11, newsRessorts: ['sport'], background: true, speakAloud: false, speakTitles: true,
    content: { weather: true, calendar: false, news: true, battery: true, notes: false } },
  evening: { enabled: true, startHour: 19, content: { chats: true, notes: false, timers: true, calendar: true, weather: false, news: true } },
  zukunftsSchluessel: 'bleibt'
};

test('Stand aus v0.8.1 wird unverändert geladen', () => {
  const s = loadSettings(memStore({ 'jarvis.settings': JSON.stringify(V081) }));
  assert.equal(s.provider, 'gemini');
  assert.deepEqual({ ...s.apiKeys }, { ...DEFAULT_SETTINGS.apiKeys, gemini: 'k-alt', xai: 'x-alt' });
  assert.equal(s.models.gemini, 'gemini-3.6-flash');
  assert.equal(s.customBaseUrl, 'https://x.test/v1');
  assert.equal(s.speak, false); assert.equal(s.wakeWord, true); assert.equal(s.wakeMuteBeep, false); assert.equal(s.memoryToAI, false);
  assert.equal(s.prefs.antwortlaenge, 'kurz');
  assert.equal(s.briefing.latestHour, 11); assert.equal(s.briefing.gapHours, 6); assert.deepEqual(s.briefing.newsRessorts, ['sport']);
  assert.equal(s.briefing.background, true); assert.equal(s.briefing.content.calendar, false);
  assert.equal(s.evening.startHour, 19); assert.equal(s.evening.content.weather, false);
  assert.equal(s.listenOnOpen, false, 'neuer Schalter: Standard aus');
  assert.equal(s.zukunftsSchluessel, 'bleibt');
});

test('Speichern eines neuen Werts verliert keinen alten (auch unbekannte Schlüssel)', () => {
  const store = memStore({ 'jarvis.settings': JSON.stringify(V081) });
  saveSettings(store, { listenOnOpen: true });
  const raw = store.get('settings', {});
  assert.equal(raw.listenOnOpen, true);
  for (const k of Object.keys(V081)) assert.ok(k in raw, `Schlüssel ${k} fehlt`);
  assert.equal(raw.apiKeys.gemini, 'k-alt');
  assert.equal(raw.zukunftsSchluessel, 'bleibt');
  assert.equal(raw.briefing.latestHour, 11);
});

test('Keine Einstellung für „Benachrichtigungen lesen“ in v0.9', () => {
  const keys = Object.keys(loadSettings(memStore()));
  assert.ok(!keys.some((k) => /notif|benachr/i.test(k)), keys.join(','));
});
