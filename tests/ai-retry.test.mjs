import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askAI, askAIRaw, friendlyHttpError, fallbackModelsFor, isOverloadError, isGoneModelError,
  preferGeminiFallbacks, backoffForAttempt, MODEL_FALLBACKS, AIError
} from '../js/core/ai.js';
import { PROVIDERS, resolveProvider } from '../js/core/settings.js';

test('Gemini-Standard ist gemini-3.8-flash; keine 2.5 in Defaults/Fallbacks', () => {
  assert.equal(PROVIDERS.gemini.defaultModel, 'gemini-3.8-flash');
  assert.deepEqual(PROVIDERS.gemini.models[0], 'gemini-3.8-flash');
  assert.ok(!PROVIDERS.gemini.models.some((m) => m.includes('2.5')));
  assert.ok(!MODEL_FALLBACKS.gemini.some((m) => m.includes('2.5')));
  assert.deepEqual(
    fallbackModelsFor('gemini', 'gemini-3.8-flash'),
    ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
  );
});

test('preferGeminiFallbacks: 3.x Flash vor Lite vor Rest', () => {
  const sorted = preferGeminiFallbacks([
    'models/gemini-2.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'other-model'
  ], 'gemini-3.8-flash');
  assert.equal(sorted[0], 'gemini-3.8-flash');
  assert.ok(sorted.indexOf('gemini-3.6-flash') < sorted.indexOf('gemini-3.5-flash-lite'));
  assert.ok(sorted.indexOf('gemini-3.5-flash-lite') < sorted.indexOf('gemini-2.5-flash'));
});

test('Backoff-Plan 1s dann 3s', () => {
  assert.equal(backoffForAttempt(0), 1000);
  assert.equal(backoffForAttempt(1), 3000);
  assert.equal(backoffForAttempt(2), 3000);
});

test('Freundliche deutsche Fehlertexte inkl. 404 gone', () => {
  assert.match(friendlyHttpError(503, 'high demand'), /überlastet/);
  assert.match(friendlyHttpError(429, 'rate limit'), /Kontingent|warten/);
  assert.match(friendlyHttpError(401, 'invalid'), /API-Schlüssel/);
  assert.match(friendlyHttpError(404, 'models/gemini-2.5-flash is no longer available to new users'), /nicht mehr verfügbar/);
  assert.equal(isOverloadError(503, 'x'), true);
  assert.equal(isGoneModelError(404, 'no longer available'), true);
  assert.equal(isGoneModelError(404, 'missing page'), false);
});

function seqFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, method: init.method || 'GET', body });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (typeof r === 'function') return r(url, body);
    const { status = 200, json } = r;
    return { ok: status >= 200 && status < 300, status, statusText: 'x', json: async () => json };
  };
  return { fn, calls, get n() { return i; } };
}

const cfg = {
  id: 'gemini',
  providerId: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: 'fake-key',
  model: 'gemini-3.8-flash'
};

const ok = (text) => ({ status: 200, json: { choices: [{ message: { content: text } }] } });
const err = (status, message) => ({ status, json: { error: { message } } });
const modelsList = (ids) => ({ status: 200, json: { data: ids.map((id) => ({ id })) } });

test('503: zwei Retries (1s, 3s), dann Erfolg auf demselben Modell', async () => {
  const sleeps = [];
  const { fn, calls } = seqFetch([
    modelsList(['gemini-3.8-flash', 'gemini-3.6-flash']), // discovery
    err(503, 'This model is currently experiencing high demand'),
    err(503, 'high demand'),
    ok('Hallo!')
  ]);
  const text = await askAI(cfg, 's', [{ role: 'user', text: 'hi' }], {
    fetchFn: fn,
    sleepFn: async (ms) => { sleeps.push(ms); },
    backoffSchedule: [1000, 3000]
  });
  assert.equal(text, 'Hallo!');
  assert.deepEqual(sleeps, [1000, 3000]);
  assert.ok(calls.filter((c) => c.body?.model === 'gemini-3.8-flash').length >= 3);
});

test('503 nach Retries: Fallback auf dynamisches 3.6-flash + Hinweis', async () => {
  const { fn, calls } = seqFetch([
    modelsList(['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']),
    err(503, 'high demand'),
    err(503, 'high demand'),
    err(503, 'high demand'),
    ok('Ersatz OK')
  ]);
  const text = await askAI(cfg, 's', [{ role: 'user', text: 'hi' }], {
    fetchFn: fn, sleepFn: async () => {}, backoffSchedule: [1, 1]
  });
  assert.match(text, /^Ersatz OK/);
  assert.match(text, /Ersatzmodell gemini-3\.6-flash/);
  const chatModels = calls.filter((c) => c.body?.model).map((c) => c.body.model);
  assert.deepEqual(chatModels.slice(0, 4), [
    'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.6-flash'
  ]);
});

test('404 no longer available: /models neu laden und verfügbares Modell nehmen', async () => {
  const { fn, calls } = seqFetch([
    err(404, 'models/gemini-3.8-flash is no longer available to new users. Please use models/gemini-3.6-flash'),
    modelsList(['models/gemini-3.6-flash', 'models/gemini-3.5-flash-lite']), // Refresh nach 404
    ok('Neues Modell')
  ]);
  const text = await askAI(cfg, 's', [{ role: 'user', text: 'hi' }], {
    fetchFn: fn, sleepFn: async () => {}, backoffSchedule: [1, 1],
    skipModelDiscovery: true,
    dynamicFallbacks: []
  });
  assert.match(text, /Neues Modell/);
  assert.match(text, /Ersatzmodell gemini-3\.6-flash/);
  assert.ok(calls.some((c) => c.url.endsWith('/models') && !c.body));
  assert.equal(calls.filter((c) => c.body?.model).at(-1).body.model, 'gemini-3.6-flash');
});

test('401 wird nicht mit Fallback wiederholt', async () => {
  const { fn, calls } = seqFetch([
    err(401, 'API key not valid')
  ]);
  await assert.rejects(
    askAI(cfg, 's', [{ role: 'user', text: 'x' }], { fetchFn: fn, sleepFn: async () => {}, skipModelDiscovery: true }),
    (e) => /API-Schlüssel/.test(e.message) && calls.filter((c) => c.body).length === 1
  );
});

test('429: Retries dann Fallback', async () => {
  const { fn } = seqFetch([
    modelsList(['gemini-3.8-flash', 'gemini-3.6-flash']),
    err(429, 'Resource exhausted'),
    err(429, 'Resource exhausted'),
    err(429, 'Resource exhausted'),
    ok('später')
  ]);
  const { data, usedFallback, model } = await askAIRaw(cfg, [{ role: 'user', content: 'x' }], {
    fetchFn: fn, sleepFn: async () => {}, backoffSchedule: [1, 1]
  });
  assert.equal(data.choices[0].message.content, 'später');
  assert.equal(usedFallback, true);
  assert.equal(model, 'gemini-3.6-flash');
});

test('resolveProvider liefert gemini-3.8-flash', () => {
  const p = resolveProvider({ provider: 'gemini', apiKeys: { gemini: 'k' }, models: {} });
  assert.equal(p.id, 'gemini');
  assert.equal(p.model, 'gemini-3.8-flash');
});
