import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, resolveProvider, loadSettings, saveSettings } from '../js/core/settings.js';
import { askAI, listModels, AIError } from '../js/core/ai.js';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';

const FAKE_KEY = 'fake-gemini-key-for-tests';

function fakeFetch(response, status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    return { ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => response };
  };
  return { fn, calls };
}

test('Gemini ist im Anbieter-Register mit kostenlosem Standardmodell', () => {
  const g = PROVIDERS.gemini;
  assert.equal(g.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(g.defaultModel, 'gemini-3.8-flash');
  assert.equal(g.keyUrl, 'https://aistudio.google.com/apikey');
  assert.match(g.keyHint, /keine Kreditkarte/);
});

test('Gemini-Schlüssel wird pro Anbieter gespeichert, letzter Anbieter gemerkt', () => {
  const store = createStore(createMemoryAdapter());
  assert.equal(loadSettings(store).apiKeys.gemini, '');
  saveSettings(store, { provider: 'gemini', apiKeys: { ...loadSettings(store).apiKeys, gemini: FAKE_KEY } });
  const s = loadSettings(store);
  assert.equal(s.provider, 'gemini');
  assert.deepEqual(resolveProvider(s), {
    id: 'gemini', baseUrl: PROVIDERS.gemini.baseUrl, apiKey: FAKE_KEY, model: 'gemini-3.8-flash'
  });
});

test('Gemini-Client: Anfrage-Format und Antwort (Fake)', async () => {
  const { fn, calls } = fakeFetch({ choices: [{ message: { role: 'assistant', content: ' Guten Tag! ' } }] });
  const cfg = resolveProvider({ provider: 'gemini', apiKeys: { gemini: FAKE_KEY }, models: {} });
  const text = await askAI(cfg, 'Du bist Jarvis.', [{ role: 'user', text: 'Hallo' }], { fetchFn: fn });
  assert.equal(text, 'Guten Tag!');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(calls[0].body.model, 'gemini-3.8-flash');
  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'Du bist Jarvis.' },
    { role: 'user', content: 'Hallo' }
  ]);
});

test('Gemini-Client: Fehler als Liste wird verständlich gemeldet', async () => {
  const { fn } = fakeFetch([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.' } }], 400);
  const cfg = resolveProvider({ provider: 'gemini', apiKeys: { gemini: FAKE_KEY }, models: {} });
  await assert.rejects(askAI(cfg, 's', [{ role: 'user', text: 'x' }], { fetchFn: fn }), (e) =>
    e instanceof AIError && /Fehler 400/.test(e.message) && /API key not valid/.test(e.message));
});

test('Gemini-Client: Modelle laden entfernt "models/"-Präfix', async () => {
  const { fn, calls } = fakeFetch({ object: 'list', data: [{ id: 'models/gemini-2.5-flash' }, { id: 'models/gemini-3.8-flash' }, { id: 'gemini-2.5-flash' }] });
  const cfg = resolveProvider({ provider: 'gemini', apiKeys: { gemini: FAKE_KEY }, models: {} });
  assert.deepEqual(await listModels(cfg, { fetchFn: fn }), ['gemini-2.5-flash', 'gemini-3.8-flash']);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/models');
});

test('Ohne Schlüssel kein Netzwerkaufruf', async () => {
  const { fn, calls } = fakeFetch({});
  const cfg = resolveProvider({ provider: 'gemini', apiKeys: {}, models: {} });
  await assert.rejects(askAI(cfg, 's', [], { fetchFn: fn }), /Kein API-Schlüssel/);
  assert.equal(calls.length, 0);
});
