import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createListenLoop, nextDelay, DEFAULT_LISTEN_POLICY } from '../js/core/listen-loop.js';
import { createWakeController } from '../js/core/wake-controller.js';

// Virtuelle Uhr: Timer laufen nur, wenn der Test die Zeit vorstellt.
function fakeClock() {
  let now = 0; let id = 0; const timers = new Map();
  return {
    set: (fn, ms) => { const k = ++id; timers.set(k, { at: now + ms, fn }); return k; },
    clear: (k) => timers.delete(k),
    get now() { return now; },
    get pending() { return timers.size; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
        await Promise.resolve(); await Promise.resolve();
      }
      now = end;
      await Promise.resolve(); await Promise.resolve();
    }
  };
}

// Erkennung zum Steuern: zählt Starts und gleichzeitig aktive Segmente.
function fakeEngine() {
  const e = { starts: 0, cancels: 0, active: 0, maxActive: 0, h: null, startedAt: [] };
  e.start = (h) => { e.starts++; e.active++; e.maxActive = Math.max(e.maxActive, e.active); e.h = h; return Promise.resolve(); };
  e.cancel = () => { e.cancels++; if (e.active) e.active--; };
  e.end = (info) => { e.active = Math.max(0, e.active - 1); const h = e.h; e.h = null; h.onEnd(info); };
  e.final = (t) => { e.active = Math.max(0, e.active - 1); const h = e.h; e.h = null; h.onFinal(t); };
  return e;
}

const flush = () => new Promise((r) => setImmediate(r));

test('nextDelay: Satz kurz, Stille wachsend, Fehler exponentiell mit Deckel, fatal = Ende', () => {
  assert.equal(nextDelay({ reason: 'final' }), 300);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((s) => nextDelay({ reason: 'silence', silences: s })), [400, 400, 800, 1500, 3000, 3000]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((n) => nextDelay({ reason: 'error', kind: 'retry', errors: n })), [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  assert.equal(nextDelay({ reason: 'error', kind: 'fatal', errors: 1 }), -1);
});

test('Listen-Loop: nie zwei Segmente gleichzeitig, kein Doppelstart', async () => {
  const clk = fakeClock(); const eng = fakeEngine(); const finals = [];
  const loop = createListenLoop({ engine: eng, onFinal: (t) => finals.push(t), setTimer: clk.set, clearTimer: clk.clear });
  loop.start(); loop.start(); loop.start();
  await flush();
  assert.equal(eng.starts, 1);
  assert.equal(loop.state, 'listening');
  eng.final('Hey Jarvis');
  assert.deepEqual(finals, ['Hey Jarvis']);
  assert.equal(loop.state, 'waiting');
  loop.start(); // während der Pause: kein zusätzlicher Start
  await clk.advance(299); assert.equal(eng.starts, 1);
  await clk.advance(1); assert.equal(eng.starts, 2);
  // Späte Meldungen eines alten Segments werden ignoriert
  const oldH = { ...eng.h };
  eng.final('neu');
  oldH.onFinal('veraltet'); oldH.onEnd({ reason: 'error', kind: 'retry' });
  assert.deepEqual(finals, ['Hey Jarvis', 'neu']);
  assert.equal(eng.maxActive, 1);
  loop.stop();
  assert.equal(loop.state, 'idle');
  const s = eng.starts; // nach stop keine Starts mehr await clk.advance(60000); assert.equal(eng.starts, s);
});

test('Listen-Loop: Stille → wachsende Pausen (weniger Starttöne), Sprache setzt zurück', async () => {
  const clk = fakeClock(); const eng = fakeEngine();
  const loop = createListenLoop({ engine: eng, setTimer: clk.set, clearTimer: clk.clear });
  loop.start(); await flush();
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    eng.end({ reason: 'silence', code: 7 });
    const before = eng.starts; const t0 = clk.now;
    while (eng.starts === before) await clk.advance(100);
    gaps.push(clk.now - t0);
  }
  assert.deepEqual(gaps, [400, 400, 800, 1500, 3000, 3000]);
  eng.h.onPartial('hallo');
  eng.end({ reason: 'silence', code: 7 }); // mit Sprache → wieder kurz
  const b = eng.starts; await clk.advance(400); assert.equal(eng.starts, b + 1);
  loop.stop();
});

test('Listen-Loop: Fehler → exponentielles Warten, nach 6 Fehlern Schluss mit Hinweis', async () => {
  const clk = fakeClock(); const eng = fakeEngine(); const fatal = [];
  const loop = createListenLoop({ engine: eng, onFatal: (e) => fatal.push(e), setTimer: clk.set, clearTimer: clk.clear });
  loop.start(); await flush();
  const gaps = [];
  for (let i = 0; i < 5; i++) {
    eng.end({ reason: 'error', kind: i === 2 ? 'busy' : 'retry', code: 5 });
    const before = eng.starts; const t0 = clk.now;
    while (eng.starts === before) await clk.advance(250);
    gaps.push(clk.now - t0);
  }
  assert.deepEqual(gaps, [1000, 2000, 4000, 8000, 16000]);
  eng.end({ reason: 'error', kind: 'retry', code: 5 });
  assert.equal(loop.state, 'failed');
  assert.equal(fatal.length, 1);
  assert.match(fatal[0].message, /Wake-Word ist pausiert/);
  const s = eng.starts; await clk.advance(120000); assert.equal(eng.starts, s, 'keine Starts mehr nach Aufgeben');
});

test('Listen-Loop: Erlaubnis fehlt → sofort Schluss; Erfolg setzt Fehlerzähler zurück', async () => {
  const clk = fakeClock(); const eng = fakeEngine(); const fatal = [];
  const loop = createListenLoop({ engine: eng, onFatal: (e) => fatal.push(e), setTimer: clk.set, clearTimer: clk.clear });
  loop.start(); await flush();
  eng.end({ reason: 'error', kind: 'retry' }); await clk.advance(1000);
  eng.end({ reason: 'error', kind: 'retry' }); await clk.advance(2000);
  eng.final('hallo'); await clk.advance(300);
  eng.end({ reason: 'error', kind: 'retry' });
  const b = eng.starts; await clk.advance(1000); assert.equal(eng.starts, b + 1, 'wieder 1 s statt 4 s');
  eng.end({ reason: 'error', kind: 'fatal', code: 9, message: 'Mikrofon-Zugriff verweigert.' });
  assert.equal(loop.state, 'failed');
  assert.equal(fatal[0].message, 'Mikrofon-Zugriff verweigert.');
});

test('Listen-Loop: Startfehler und hängendes Segment (Wächter)', async () => {
  const clk = fakeClock(); let n = 0;
  const eng = fakeEngine();
  eng.start = (h) => { n++; eng.h = h; return n === 1 ? Promise.reject(Object.assign(new Error('busy'), { kind: 'retry' })) : Promise.resolve(); };
  const loop = createListenLoop({ engine: eng, setTimer: clk.set, clearTimer: clk.clear });
  loop.start(); await flush();
  assert.equal(loop.state, 'waiting');
  await clk.advance(1000); await flush();
  assert.equal(n, 2);
  assert.equal(loop.state, 'listening');
  const c = eng.cancels;
  await clk.advance(DEFAULT_LISTEN_POLICY.watchdogMs);
  assert.equal(eng.cancels, c + 1, 'Wächter bricht hängendes Segment ab');
  await clk.advance(400);
  assert.equal(n, 3);
  loop.stop();
});

// ---------- Wake-Controller: Pausen mit Gründen ----------
function fakeSTT() {
  const s = { started: 0, stopped: 0, live: 0, maxLive: 0, sessions: [] };
  s.startContinuous = (h) => {
    s.started++; s.live++; s.maxLive = Math.max(s.maxLive, s.live); s.h = h;
    const sess = { stopped: false, stop: () => { if (!sess.stopped) { sess.stopped = true; s.stopped++; s.live--; } } };
    s.sessions.push(sess);
    return sess;
  };
  return s;
}

test('Wake-Controller: verschachtelte Pausen – erst wenn alle Gründe weg sind, wird wieder zugehört', async () => {
  const clk = fakeClock(); const stt = fakeSTT();
  const c = createWakeController({ stt, getName: () => 'Jarvis', onCommand() {}, setTimer: clk.set, clearTimer: clk.clear });
  c.enable();
  assert.equal(stt.live, 1);
  c.pause('turn'); c.pause('tts');
  assert.equal(stt.live, 0);
  c.resume('tts', { delayMs: 700 }); // Timer-Meldung fertig gesprochen, Antwort läuft noch
  await clk.advance(5000);
  assert.equal(stt.live, 0, 'Turn hält das Mikrofon noch zu');
  c.resume('turn', { delayMs: 700 });
  await clk.advance(699); assert.equal(stt.live, 0, 'Nachhall abwarten');
  await clk.advance(1); assert.equal(stt.live, 1);
  assert.equal(stt.maxLive, 1);
});

test('Wake-Controller: Sprechen zwischen Sätzen bricht geplanten Neustart ab; kein Doppelstart', async () => {
  const clk = fakeClock(); const stt = fakeSTT();
  const c = createWakeController({ stt, getName: () => 'Jarvis', onCommand() {}, setTimer: clk.set, clearTimer: clk.clear });
  c.enable();
  for (let i = 0; i < 3; i++) { // drei Sätze nacheinander
    c.pause('tts');
    await clk.advance(1500);
    c.resume('tts', { delayMs: 700 });
    await clk.advance(200); // nächster Satz beginnt vor Ablauf der 700 ms
  }
  assert.equal(stt.started, 1, 'zwischen den Sätzen nie geöffnet');
  await clk.advance(700);
  assert.equal(stt.started, 2);
  c.resume('hidden', { delayMs: 400 }); c.resume('hidden'); c.enable(); // Rückkehr aus dem Hintergrund o. ä.
  await clk.advance(1000);
  assert.equal(stt.live, 1);
  assert.equal(stt.maxLive, 1);
});

test('Wake-Controller: Adapter gibt auf → Sitzung wird beendet (keine verwaiste Schleife)', () => {
  const stt = fakeSTT(); const errs = [];
  const c = createWakeController({ stt, getName: () => 'Jarvis', onCommand() {}, onError: (e) => errs.push(e.message) });
  c.enable();
  stt.h.onError(new Error('Wake-Word ist pausiert'));
  assert.equal(stt.live, 0, 'gestoppt');
  assert.equal(c.enabled, false);
  assert.deepEqual(errs, ['Wake-Word ist pausiert']);
  c.enable();
  assert.equal(stt.live, 1);
  assert.equal(stt.maxLive, 1);
});
