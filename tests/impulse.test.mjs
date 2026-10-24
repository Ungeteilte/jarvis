import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { createTimerManager } from '../js/core/timers.js';
import { createAssistant } from '../js/core/assistant.js';
import { saveSettings, loadSettings } from '../js/core/settings.js';
import { savePersona } from '../js/core/persona.js';
import {
  IMPULSES, impulseSentence, pickImpulse, insertImpulse, lastSentenceStart, createImpulseRelay,
  templateBriefing, buildBriefingMessages, normalizeBriefingConfig, DEFAULT_BRIEFING, handleBriefingCommand
} from '../js/core/briefing/index.js';

const seq = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

test('Impuls-Liste: genug Einträge, deutsch, kurz, eindeutig, ohne Links/Emojis, ohne Schlusszeichen', () => {
  assert.ok(IMPULSES.length >= 50);
  const set = new Set(IMPULSES.map((e) => e.t));
  assert.equal(set.size, IMPULSES.length, 'keine Dubletten');
  for (const e of IMPULSES) {
    assert.ok(['fact', 'mind'].includes(e.k), e.t);
    assert.ok(e.t.length >= 15 && e.t.length <= 140, e.t);
    assert.ok(!/https?:|www\.|[\u{1F300}-\u{1FAFF}]/u.test(e.t), e.t);
    assert.ok(!/[.!?]$/.test(e.t), e.t);
    assert.ok(!/\b(du|dich|dir|dein)\b/i.test(e.t), 'siezen: ' + e.t);
  }
  assert.ok(IMPULSES.some((e) => e.k === 'fact') && IMPULSES.some((e) => e.k === 'mind'));
  assert.equal(impulseSentence({ k: 'fact', t: 'Elefanten können nicht springen' }), 'Übrigens: Elefanten können nicht springen.');
  assert.match(impulseSentence({ k: 'mind', t: 'Fortschritt zählt mehr als Perfektion' }), /^Und ein Gedanke für heute: .+\.$/);
});

test('pickImpulse: gleicher Tag → gleicher Satz; keine Wiederholung, bis alle dran waren; auch nicht an der Rundengrenze', () => {
  const rnd = seq(7);
  const n = IMPULSES.length;
  let st = null; const seen = [];
  for (let d = 0; d < n; d++) {
    const day = `2026-11-${String(d).padStart(3, '0')}`;
    const a = pickImpulse(st, day, { rnd });
    const b = pickImpulse(a.state, day, { rnd });
    assert.equal(a.index, b.index, 'gleicher Tag');
    seen.push(a.index); st = b.state;
  }
  assert.equal(new Set(seen).size, n, 'jeder genau einmal pro Runde');
  const next = pickImpulse(st, 'neue-runde', { rnd });
  assert.notEqual(next.index, seen.at(-1), 'kein Doppel über die Rundengrenze');
  assert.equal(next.state.pos, 1);
  // Liste geändert (andere Länge) → neu mischen statt kaputter Indizes
  const other = pickImpulse({ ...st, n: 3 }, 'x', { rnd });
  assert.ok(other.index >= 0 && other.index < n);
  assert.ok(pickImpulse('Unsinn', 'y').text.length > 10);
});

test('insertImpulse: direkt vor der abschließenden Rückfrage, sonst ans Ende; Abkürzungen bleiben heil', () => {
  const I = 'Übrigens: Elefanten können nicht springen.';
  assert.equal(insertImpulse('Guten Morgen. Es ist sonnig. Soll ich mehr sagen?', I), `Guten Morgen. Es ist sonnig. ${I} Soll ich mehr sagen?`);
  assert.equal(insertImpulse('Guten Morgen. Es ist sonnig.', I), `Guten Morgen. Es ist sonnig. ${I}`);
  assert.equal(insertImpulse('Soll ich mehr sagen?', I), `${I} Soll ich mehr sagen?`);
  assert.equal(insertImpulse('Guten Morgen. Soll ich z. B. die Termine vorlesen?', I), `Guten Morgen. ${I} Soll ich z. B. die Termine vorlesen?`);
  assert.equal(insertImpulse('Guten Morgen! „Regen“ kommt. Mehr dazu?', I), `Guten Morgen! „Regen“ kommt. ${I} Mehr dazu?`);
  assert.equal(insertImpulse('Text?', ''), 'Text?');
  assert.equal(lastSentenceStart('Eins. Zwei. Drei?'), 'Eins. Zwei. '.length);
});

test('createImpulseRelay: gestreamter Text = Endtext, letzter Satz wird zurückgehalten', () => {
  const I = 'Übrigens: Elefanten können nicht springen.';
  const out = []; const r = createImpulseRelay((d) => out.push(d), I);
  const full = 'Guten Morgen. Heute wird es sonnig. Soll ich Ihnen mehr zu den Nachrichten sagen?';
  for (let i = 0; i < full.length; i += 7) r.push({ type: 'text', text: full.slice(i, i + 7) });
  assert.ok(!out.map((d) => d.text).join('').includes('Soll ich'), 'Rückfrage noch zurückgehalten');
  const fin = r.finish(full);
  const streamed = out.filter((d) => d.type === 'text').map((d) => d.text).join('');
  assert.equal(streamed, fin);
  assert.equal(fin, `Guten Morgen. Heute wird es sonnig. ${I} Soll ich Ihnen mehr zu den Nachrichten sagen?`);
  assert.ok(!out.some((d) => d.type === 'reset'));
  // abweichender Endtext → Reset + kompletter Text
  const out2 = []; const r2 = createImpulseRelay((d) => out2.push(d), I);
  r2.push({ type: 'text', text: 'Hallo. Welt. ' });
  const f2 = r2.finish('Ganz anders. Frage?');
  assert.deepEqual(out2.slice(-2), [{ type: 'reset' }, { type: 'text', text: f2 }]);
});

test('Vorlage: Impuls vor der Rückfrage; Konfiguration Standard an, abschaltbar; KI-Prompt ohne eigene Sprüche', () => {
  const facts = { date: 'Montag', time: '8:00', weather: null, weatherNote: '', events: null, news: [{ title: 'A' }], notes: [], timers: 0 };
  const t = templateBriefing(facts, { impulse: 'Übrigens: Elefanten können nicht springen.' });
  assert.match(t, /Übrigens: Elefanten können nicht springen\. Soll ich Ihnen mehr zu den Nachrichten sagen\?$/);
  assert.ok(!/Übrigens/.test(templateBriefing(facts)));
  assert.equal(DEFAULT_BRIEFING.content.impulse, true);
  assert.equal(normalizeBriefingConfig({}).content.impulse, true);
  assert.equal(normalizeBriefingConfig({ content: { impulse: false } }).content.impulse, false);
  assert.equal(normalizeBriefingConfig({ content: { weather: true, calendar: false, news: true, battery: true, notes: false } }).content.impulse, true, 'alte Einstellungen → an');
  const sys = (o) => buildBriefingMessages({ facts, ...o })[0].content;
  assert.match(sys({ impulse: true }), /keinen eigenen Spruch/);
  assert.ok(!/keinen eigenen Spruch/.test(sys({})));
});

test('Sprachbefehle: „Morgen-Impuls aus/an“; „Morgen“ allein bleibt das Briefing', () => {
  const store = createStore(createMemoryAdapter());
  assert.match(handleBriefingCommand('Morgen-Impuls aus', store), /ohne Impuls/);
  assert.equal(loadSettings(store).briefing.content.impulse, false);
  assert.match(handleBriefingCommand('Schalte den Morgenimpuls wieder an', store), /kleinen Impuls/);
  assert.equal(loadSettings(store).briefing.content.impulse, true);
  assert.match(handleBriefingCommand('Kein Impuls mehr', store), /ohne Impuls/);
  assert.equal(handleBriefingCommand('Guten Morgen', store), null);
  assert.equal(handleBriefingCommand('Impulse für mein Projekt', store), null);
});

function setup({ apiKey = '', impulse } = {}) {
  const store = createStore(createMemoryAdapter());
  if (apiKey) saveSettings(store, { provider: 'openai', apiKeys: { openai: apiKey } });
  if (impulse === false) saveSettings(store, { briefing: { content: { impulse: false } } });
  savePersona(store, { name: 'Jarvis', onboarded: true });
  const timers = createTimerManager({ store, onDone: () => {}, schedule: () => 0, unschedule: () => {} });
  let now = new Date('2026-10-26T07:30:00+01:00');
  const fetchFn = async (url, opts = {}) => {
    if (url.includes('/chat/completions')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'Guten Morgen. Es ist ruhig. Womit kann ich helfen?' } }] }), text: async () => '' };
    }
    throw new Error('kein Netz erwartet: ' + url);
  };
  const assistant = createAssistant({ store, timers, device: {}, fetchFn, now: () => now, timeZone: 'Europe/Berlin', stream: false });
  return { store, assistant, setNow: (d) => { now = new Date(d); } };
}

test('brief(): Impuls am Morgen (Vorlage und KI), gleicher Tag gleich, neuer Tag anders; nicht abends/Woche; abschaltbar', async () => {
  const { store, assistant, setNow } = setup();
  const m1 = await assistant.brief({ auto: true });
  const imp = m1.text.match(/(Übrigens|Und ein Gedanke für heute): [^.]+\./)?.[0];
  assert.ok(imp, m1.text);
  assert.match(m1.text, /\?$/, 'Rückfrage bleibt letzter Satz');
  const m2 = await assistant.brief({ auto: false });
  assert.ok(m2.text.includes(imp), 'gleicher Tag → gleicher Impuls');
  setNow('2026-10-27T07:30:00+01:00');
  const m3 = await assistant.brief({ auto: true });
  assert.ok(!m3.text.includes(imp), 'neuer Tag → anderer Impuls');
  assert.equal(store.get('impulse').pos, 2);
  const ev = await assistant.brief({ auto: true, kind: 'evening' });
  assert.ok(!/Übrigens:|Gedanke für heute/.test(ev.text));

  const ai = setup({ apiKey: 'sk-test' });
  const a = await ai.assistant.brief({ auto: true });
  assert.match(a.text, /^Guten Morgen\. Es ist ruhig\. (Übrigens|Und ein Gedanke für heute): .+\. Womit kann ich helfen\?$/);

  const off = setup({ impulse: false });
  const o = await off.assistant.brief({ auto: true });
  assert.ok(!/Übrigens:|Gedanke für heute/.test(o.text));
  assert.equal(off.store.get('impulse', null), null);
});

test('Impuls-Modul im Offline-Cache, Schalter in „Morgen-Briefing & Abend“', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/core/briefing/impulse.js'"));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const grp = html.slice(html.indexOf('id="grp-briefing"'), html.indexOf('id="grp-memory"'));
  assert.ok(grp.includes('id="set-brief-impulse"'));
});
