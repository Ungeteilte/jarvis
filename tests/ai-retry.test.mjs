import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askAI, askAIRaw, friendlyHttpError, fallbackModelsFor, isOverloadError,
  MODEL_FALLBACKS, AIError
} from '../js/core/ai.js';
import { PROVIDERS, resolveProvider } from '../js/core/settings.js';

test('Gemini-Standard ist gemini-2.5-flash mit Fallbacks', () => {
  assert.equal(PROVIDERS.gemini.defaultModel, 'gemini-2.5-flash');
  assert.deepEqual(
    fallbackModelsFor('gemini', 'gemini-2.5-flash'),
    ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash']
  );
  assert.deepEqual(
    fallbackModelsFor('gemini', 'gemini-3.8-flash'),
    ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
  );
});

test('Freundliche deutsche Fehlertexte', () => {
  assert.match(friendlyHttpError(503, 'high demand'), /überlastet/);
  assert.match(friendlyHttpError(429, 'rate limit'), /Kontingent|warten/);
  assert.match(friendlyHttpError(401, 'invalid'), /API-Schlüssel/);
  assert.equal(isOverloadError(503, 'x'), true);
  assert.equal(isOverloadError(400, 'bad request'), false);
  assert.equal(isOverloadError(200, 'high demand'), true);
});

function seqFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, auth: init.headers.Authorization });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    if (typeof r === 'function') return r(body);
    const { status = 200, json } = r;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: 'x',
      json: async () => json
    };
  };
  return { fn, calls, get n() { return i; } };
}

const cfg = {
  id: 'gemini',
  providerId: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: 'fake-key',
  model: 'gemini-2.5-flash'
};

test('503: einmal Retry, dann Erfolg auf demselben Modell', async () => {
  const sleeps = [];
  const { fn, calls } = seqFetch([
    { status: 503, json: { error: { message: 'This model is currently experiencing high demand' } } },
    { status: 200, json: { choices: [{ message: { content: 'Hallo!' } }] } }
  ]);
  const text = await askAI(cfg, 's', [{ role: 'user', text: 'hi' }], {
    fetchFn: fn, sleepFn: async (ms) => { sleeps.push(ms); }, backoffMs: 10
  });
  assert.equal(text, 'Hallo!');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, 'gemini-2.5-flash');
  assert.equal(calls[1].body.model, 'gemini-2.5-flash');
  assert.deepEqual(sleeps, [10]);
});

test('503 dauerhaft: Fallback auf gemini-2.5-flash-lite + Hinweis', async () => {
  const { fn, calls } = seqFetch([
    // primary: retry once
    { status: 503, json: { error: { message: 'high demand' } } },
    { status: 503, json: { error: { message: 'high demand' } } },
    // next fallback lite: success on first try
    { status: 200, json: { choices: [{ message: { content: 'Ersatz OK' } }] } }
  ]);
  // primary is 3.8 so first fallback is 2.5-flash then lite
  const text = await askAI({ ...cfg, model: 'gemini-3.8-flash' }, 's', [{ role: 'user', text: 'hi' }], {
    fetchFn: fn, sleepFn: async () => {}, backoffMs: 1
  });
  assert.match(text, /^Ersatz OK/);
  assert.match(text, /Ersatzmodell gemini-2\.5-flash/);
  assert.deepEqual(calls.map((c) => c.body.model), [
    'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'
  ]);
});

test('Alle Modelle überlastet → freundliche 503-Meldung', async () => {
  const { fn } = seqFetch([
    { status: 503, json: { error: { message: 'high demand' } } }
  ]);
  await assert.rejects(
    askAI(cfg, 's', [{ role: 'user', text: 'x' }], { fetchFn: fn, sleepFn: async () => {}, backoffMs: 1, retries: 0 }),
    (e) => e instanceof AIError && e.status === 503 && /überlastet/.test(e.message)
  );
});

test('401 wird nicht mit Fallback wiederholt', async () => {
  const { fn, calls } = seqFetch([
    { status: 401, json: { error: { message: 'API key not valid' } } }
  ]);
  await assert.rejects(
    askAI(cfg, 's', [{ role: 'user', text: 'x' }], { fetchFn: fn, sleepFn: async () => {} }),
    (e) => /API-Schlüssel/.test(e.message) && calls.length === 1
  );
});

test('429: Retry dann Fallback', async () => {
  const { fn, calls } = seqFetch([
    { status: 429, json: { error: { message: 'Resource exhausted' } } },
    { status: 429, json: { error: { message: 'Resource exhausted' } } },
    { status: 200, json: { choices: [{ message: { content: 'später' } }] } }
  ]);
  const { data, usedFallback, model } = await askAIRaw(cfg, [{ role: 'user', content: 'x' }], {
    fetchFn: fn, sleepFn: async () => {}, backoffMs: 1
  });
  assert.equal(data.choices[0].message.content, 'später');
  assert.equal(usedFallback, true);
  assert.equal(model, 'gemini-2.5-flash-lite');
  assert.equal(calls.length, 3);
});

test('resolveProvider liefert id für Fallback-Kette', () => {
  const p = resolveProvider({ provider: 'gemini', apiKeys: { gemini: 'k' }, models: {} });
  assert.equal(p.id, 'gemini');
  assert.equal(p.model, 'gemini-2.5-flash');
  assert.ok(MODEL_FALLBACKS.gemini.includes('gemini-2.5-flash-lite'));
});
