import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { handleSkill, parseDuration, formatDuration } from '../js/core/skills.js';
import { createTimerManager } from '../js/core/timers.js';
import { buildSystemPrompt } from '../js/core/prompt.js';
import { createAssistant } from '../js/core/assistant.js';
import { savePersona } from '../js/core/persona.js';
import { saveSettings, resolveProvider } from '../js/core/settings.js';

function ctx() {
  const store = createStore(createMemoryAdapter());
  const fired = [];
  const timers = createTimerManager({ store, onDone: (t) => fired.push(t), schedule: () => 0, unschedule: () => {} });
  return { store, timers, fired, now: new Date('2026-10-19T14:05:00Z'), timeZone: 'Europe/Berlin', name: 'Jarvis' };
}

test('Dauer parsen', () => {
  assert.equal(parseDuration('Stell einen Timer auf 5 Minuten'), 300000);
  assert.equal(parseDuration('Timer für eine Minute'), 60000);
  assert.equal(parseDuration('1 Stunde und 30 Minuten'), 5400000);
  assert.equal(parseDuration('fünfundzwanzig Sekunden'), 25000);
  assert.equal(parseDuration('eine halbe Stunde'), 1800000);
  assert.equal(parseDuration('2,5 Minuten'), 150000);
  assert.equal(parseDuration('Timer bitte'), null);
  assert.equal(formatDuration(330000), '5 Minuten und 30 Sekunden');
});

test('Uhrzeit und Datum', () => {
  const c = ctx();
  assert.equal(handleSkill('Wie spät ist es?', c), 'Es ist 16:05 Uhr.');
  assert.equal(handleSkill('Welches Datum haben wir?', c), 'Heute ist Montag, 19. Oktober 2026.');
});

test('Timer stellen, abfragen, stoppen', () => {
  const c = ctx();
  assert.match(handleSkill('Stell einen Timer auf 5 Minuten', c), /5 Minuten gestellt/);
  assert.equal(c.timers.list().length, 1);
  assert.match(handleSkill('Wie lange läuft der Timer noch?', c), /Noch/);
  assert.match(handleSkill('Timer stoppen', c), /gestoppt/);
  assert.equal(c.timers.list().length, 0);
});

test('Notizen merken, abfragen, löschen', () => {
  const c = ctx();
  assert.match(handleSkill('Merke dir, dass der Schlüssel unter der Matte liegt.', c), /Schlüssel unter der Matte liegt/);
  handleSkill('merk dir Milch kaufen', c);
  assert.match(handleSkill('Was habe ich mir gemerkt?', c), /2 Dinge.*Matte.*Milch kaufen/);
  assert.match(handleSkill('Lösche alle Notizen', c), /Erledigt/);
  assert.match(handleSkill('Was habe ich mir gemerkt?', c), /nichts/);
});

test('Unbekanntes geht an die KI (null)', () => {
  assert.equal(handleSkill('Erzähl mir einen Witz', ctx()), null);
});

test('Name im Skill und im System-Prompt', () => {
  const c = { ...ctx(), name: 'Friday' };
  assert.match(handleSkill('Wie heißt du?', c), /Friday/);
  const p = buildSystemPrompt({ name: 'Friday', now: c.now, timeZone: 'Europe/Berlin', notes: [{ text: 'Milch' }] });
  assert.match(p, /Du bist Friday/);
  assert.match(p, /19\. Oktober 2026/);
  assert.match(p, /Milch/);
});

test('Assistent: KI-Aufruf mit Name im Prompt (Mock-fetch)', async () => {
  const c = ctx();
  savePersona(c.store, { name: 'Friday' });
  saveSettings(c.store, { provider: 'xai', apiKeys: { xai: 'test-key' } });
  let sent;
  const fetchFn = async (url, init) => {
    sent = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Sehr gerne.' } }] }) };
  };
  const a = createAssistant({ store: c.store, timers: c.timers, fetchFn });
  const reply = await a.process('Erzähl mir einen Witz');
  assert.equal(reply.text, 'Sehr gerne.');
  assert.equal(sent.url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(sent.body.model, 'grok-4.7');
  assert.equal(sent.init.headers.Authorization, 'Bearer test-key');
  assert.match(sent.body.messages[0].content, /Du bist Friday/);
  assert.equal(a.getHistory().length, 2);
});

test('Assistent ohne Schlüssel gibt Hinweis', async () => {
  const c = ctx();
  const a = createAssistant({ store: c.store, timers: c.timers });
  assert.match((await a.process('Was ist Quantenphysik?')).text, /API-Schlüssel/);
});

test('Eigene Basis-URL', () => {
  const cfg = resolveProvider({ provider: 'custom', customBaseUrl: 'https://x.de/v1/', apiKeys: { custom: 'k' }, models: { custom: 'm' } });
  assert.deepEqual(cfg, { id: 'custom', baseUrl: 'https://x.de/v1', apiKey: 'k', model: 'm' });
});
