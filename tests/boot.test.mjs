import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { waitForBoot, adapterKind, BOOT_TIMEOUT_MS } from '../js/core/boot.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('waitForBoot: ohne Bootstrap sofort „none“ (PWA im Browser)', async () => {
  assert.equal(await waitForBoot({}), 'none');
  assert.equal(await waitForBoot(null), 'none');
});

test('waitForBoot: wartet, bis der Bootstrap die Adapter gesetzt hat', async () => {
  const g = {};
  let done;
  g.__JARVIS_BOOT__ = new Promise((r) => { done = r; });
  setTimeout(() => { g.__JARVIS_ADAPTERS__ = { tts: () => ({}) }; done(); }, 30);
  assert.equal(g.__JARVIS_ADAPTERS__, undefined);
  assert.equal(await waitForBoot(g), 'ready');
  assert.equal(adapterKind(g.__JARVIS_ADAPTERS__), 'native');
});

test('waitForBoot: Zeitlimit (Sicherheitsnetz) → „timeout“, Web-Adapter', async () => {
  const g = { __JARVIS_BOOT__: new Promise(() => {}) };
  const t0 = Date.now();
  assert.equal(await waitForBoot(g, { timeoutMs: 50 }), 'timeout');
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(adapterKind(g.__JARVIS_ADAPTERS__), 'web');
  assert.equal(BOOT_TIMEOUT_MS, 3000);
});

test('waitForBoot: Standard-Zeitlimit 3 s greift (simulierter Timer)', async () => {
  let delay = null;
  const r = await waitForBoot({ __JARVIS_BOOT__: new Promise(() => {}) }, {
    setTimer: (fn, ms) => { delay = ms; return setTimeout(fn, 0); }, clearTimer: clearTimeout
  });
  assert.equal(r, 'timeout');
  assert.equal(delay, 3000);
});

test('waitForBoot: abgelehntes Versprechen → „error“ (Start geht weiter)', async () => {
  assert.equal(await waitForBoot({ __JARVIS_BOOT__: Promise.reject(new Error('x')) }), 'error');
});

test('Reihenfolge: app.js wartet auf den Bootstrap, bevor es die Adapter liest', () => {
  const app = read('../js/app.js');
  const wait = app.indexOf('await waitForBoot(globalThis)');
  const readA = app.indexOf('globalThis.__JARVIS_ADAPTERS__');
  assert.ok(wait > 0, 'await waitForBoot fehlt');
  assert.ok(readA > wait, 'Adapter werden vor dem Warten gelesen');
  // Keine Dienste vor dem Warten anlegen
  for (const s of ['createStore(', 'createWebTTS()', '.tts()']) {
    const i = app.indexOf(s);
    assert.ok(i === -1 || i > wait, `${s} vor dem Warten`);
  }
});

test('Reihenfolge: bootstrap.js legt __JARVIS_BOOT__ vor dem ersten await an und erfüllt es im finally', () => {
  const b = read('../android/native-web/bootstrap.js')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length)); // Kommentare ausblenden
  const create = b.indexOf('window.__JARVIS_BOOT__ = new Promise');
  const firstAwait = b.search(/\bawait\b/);
  assert.ok(create > 0 && firstAwait > create, 'Versprechen muss vor dem ersten await stehen');
  const fin = b.lastIndexOf('finally');
  assert.ok(fin > 0 && b.indexOf('bootDone()', fin) > fin, 'bootDone() fehlt im finally');
  const setA = b.indexOf('window.__JARVIS_ADAPTERS__ =');
  const early = b.indexOf('bootDone();');
  assert.ok(early > setA, 'bootDone erst nach dem Setzen der Adapter');
});

test('Plugin: speak wartet auch auf onStop (stopSpeaking hängt nicht)', () => {
  for (const p of ['../android/android/app/src/main/java/com/jarvis/assistant/JarvisNativePlugin.java',
    '../android/native-android/java/com/jarvis/assistant/JarvisNativePlugin.java']) {
    const s = read(p);
    // v0.7: speak blockiert den Plugin-Thread nicht mehr; done/error/stop beenden den Aufruf.
    assert.match(s, /public void onStop\(String utteranceId, boolean interrupted\) \{ finishSpeak\(utteranceId\); \}/, p);
    assert.match(s, /public void onDone\(String utteranceId\) \{ finishSpeak\(utteranceId\); \}/, p);
    assert.doesNotMatch(s, /CountDownLatch/, p + ': speak darf den Plugin-Thread nicht blockieren');
    assert.match(s, /void stopSpeaking[\s\S]{0,400}resolveAllSpeak\(\)/, p);
  }
});
