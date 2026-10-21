// v0.9 Stufe 0: „Jarvis fragen“ – öffnen und sofort zuhören
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideListen, parseListenUrl, LISTEN_GUIDE } from '../js/core/listen-launch.js';
import { loadSettings, saveSettings } from '../js/core/settings.js';
import { createStore } from '../js/core/storage.js';

const OK = { onboarded: true, busy: false, listening: false, hidden: false };

test('Kachel/Verknüpfung/jarvis://zuhoeren → sofort zuhören', () => {
  assert.equal(decideListen({ listen: true }, {}, OK).listen, true);
  assert.equal(decideListen({ listen: true }, { listenOnOpen: false }, OK).listen, true);
});

test('Normaler Start hört nur mit „Beim Öffnen sofort zuhören“', () => {
  assert.equal(decideListen({ opened: true }, { listenOnOpen: false }, OK).listen, false);
  assert.equal(decideListen({ opened: true }, {}, OK).listen, false);
  assert.equal(decideListen({ opened: true }, { listenOnOpen: true }, OK).listen, true);
  assert.equal(decideListen(null, { listenOnOpen: true }, OK).listen, false);
  assert.equal(decideListen({ listen: false, opened: false }, { listenOnOpen: true }, OK).listen, false);
});

test('Nie bei Einrichtung, verborgen, beschäftigt oder schon hörend', () => {
  assert.equal(decideListen({ listen: true }, {}, { ...OK, onboarded: false }).listen, false);
  assert.equal(decideListen({ listen: true }, {}, { ...OK, hidden: true }).listen, false);
  assert.equal(decideListen({ listen: true }, {}, { ...OK, busy: true }).listen, false);
  assert.equal(decideListen({ listen: true }, {}, { ...OK, listening: true }).listen, false);
});

test('PWA: ?zuhoeren=1 erkannt und aus der Adresse entfernt', () => {
  assert.deepEqual(parseListenUrl('https://x.test/jarvis/index.html?zuhoeren=1'), { listen: true, cleanUrl: '/jarvis/index.html' });
  assert.deepEqual(parseListenUrl('https://x.test/index.html?a=2&zuhoeren=1#h'), { listen: true, cleanUrl: '/index.html?a=2#h' });
  assert.equal(parseListenUrl('https://x.test/index.html?zuhoeren=0').listen, false);
  assert.deepEqual(parseListenUrl('https://x.test/index.html'), { listen: false, cleanUrl: null });
  assert.equal(parseListenUrl('kaputt').listen, false);
});

test('Einstellung listenOnOpen: Standard aus, nur echtes true, wird gespeichert', () => {
  const mem = new Map();
  const store = createStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) });
  assert.equal(loadSettings(store).listenOnOpen, false);
  saveSettings(store, { listenOnOpen: 'ja' });
  assert.equal(loadSettings(store).listenOnOpen, false);
  saveSettings(store, { listenOnOpen: true });
  assert.equal(loadSettings(store).listenOnOpen, true);
});

test('Anleitung deckt Kachel, Startbildschirm, Hey Google, Bixby, Seitentaste ab', () => {
  const ids = LISTEN_GUIDE.map((g) => g.id);
  for (const id of ['tile', 'shortcut', 'google', 'bixby', 'sidekey']) assert.ok(ids.includes(id), id);
  assert.match(LISTEN_GUIDE.find((g) => g.id === 'google').title, /Hey Google, öffne Jarvis/);
  assert.match(LISTEN_GUIDE.find((g) => g.id === 'sidekey').text, /Doppelt drücken/);
});
