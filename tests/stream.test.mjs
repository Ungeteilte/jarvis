import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askAIStream, readSSE, createDeltaAssembler, requestStreamOnce, AIError
} from '../js/core/ai.js';
import { runToolLoop } from '../js/core/tools/loop.js';
import { createDefaultRegistry } from '../js/core/tools/index.js';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { createTimerManager } from '../js/core/timers.js';
import { createAssistant } from '../js/core/assistant.js';
import { saveSettings } from '../js/core/settings.js';
import { createLocalTransport } from '../js/core/realtime/index.js';
import { createSentenceChunker } from '../js/core/sentences.js';

const CFG = { id: 'xai', providerId: 'xai', baseUrl: 'https://api.x.ai/v1', apiKey: 'test-key', model: 'grok-4.7' };
const enc = new TextEncoder();

/** Baut eine fetch-Response mit SSE-Body aus Rohtext-Stücken (beliebig zerschnitten). */
function sseResponse(pieces, { status = 200, breakAfter = -1, ctype = 'text/event-stream' } = {}) {
  let i = 0;
  const body = new ReadableStream({
    pull(ctrl) {
      if (i === breakAfter) { ctrl.error(new TypeError('network error')); return; }
      if (i >= pieces.length) { ctrl.close(); return; }
      ctrl.enqueue(enc.encode(pieces[i++]));
    }
  });
  return new Response(body, { status, headers: { 'content-type': ctype } });
}
const ev = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const textChunk = (t) => ev({ choices: [{ index: 0, delta: { content: t } }] });
const DONE = 'data: [DONE]\n\n';
/** Zerschneidet einen String in Stücke fester Länge (simuliert TCP-Fragmente). */
const shred = (s, n = 7) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, 'g'));

test('readSSE: zerschnittene Events, Kommentare, [DONE]', async () => {
  const raw = ': keep-alive\n\n' + textChunk('Hal') + textChunk('lo') + DONE + textChunk('NACH DONE');
  const res = sseResponse(shred(raw, 5));
  const out = [];
  for await (const d of readSSE(res.body)) out.push(JSON.parse(d).choices[0].delta.content);
  assert.deepEqual(out, ['Hal', 'lo']);
});

test('Assembler: Text + Tool-Calls über mehrere Chunks', () => {
  const a = createDeltaAssembler();
  a.push({ choices: [{ delta: { role: 'assistant', content: 'Moment' } }] });
  a.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_', arguments: '' } }] } }] });
  a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'battery', arguments: '{"a"' } }] } }] });
  a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }, { index: 1, function: { name: 'vibrate', arguments: '{}' } }] } }] });
  a.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
  const msg = a.result().choices[0].message;
  assert.equal(msg.content, 'Moment');
  assert.equal(msg.tool_calls.length, 2);
  assert.equal(msg.tool_calls[0].function.name, 'get_battery');
  assert.deepEqual(JSON.parse(msg.tool_calls[0].function.arguments), { a: 1 });
  assert.equal(msg.tool_calls[1].id, 'call_2');
  assert.equal(a.result().choices[0].finish_reason, 'tool_calls');
});

test('askAIStream: Text kommt stückweise, stream:true wird gesendet', async () => {
  let sentBody;
  const fetchFn = async (url, init) => {
    sentBody = JSON.parse(init.body);
    assert.equal(init.headers.Accept, 'text/event-stream');
    return sseResponse(shred(textChunk('Guten ') + textChunk('Abend, ') + textChunk('Sir.') + DONE, 9));
  };
  const deltas = [];
  const out = await askAIStream(CFG, [{ role: 'user', content: 'Hi' }], { fetchFn, onDelta: (d) => deltas.push(d) });
  assert.equal(sentBody.stream, true);
  assert.equal(out.streamed, true);
  assert.equal(out.data.choices[0].message.content, 'Guten Abend, Sir.');
  assert.deepEqual(deltas.map((d) => d.text), ['Guten ', 'Abend, ', 'Sir.']);
});

test('askAIStream: 503 vor Stream-Beginn → Retry, dann Erfolg (Retry-Logik bleibt)', async () => {
  let calls = 0;
  const sleeps = [];
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    return sseResponse([textChunk('OK'), DONE]);
  };
  const out = await askAIStream(CFG, [], { fetchFn, sleepFn: async (ms) => sleeps.push(ms), onDelta: () => {} });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(out.data.choices[0].message.content, 'OK');
});

test('askAIStream: 401 wird nicht verschluckt (kein Rückfall)', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return new Response('{"error":{"message":"bad key"}}', { status: 401, headers: { 'content-type': 'application/json' } }); };
  await assert.rejects(askAIStream(CFG, [], { fetchFn, onDelta: () => {} }), (e) => e instanceof AIError && e.status === 401);
  assert.equal(calls, 1);
});

test('askAIStream: Abbruch mitten im Stream → reset + Rückfall ohne Streaming', async () => {
  const bodies = [];
  const fetchFn = async (url, init) => {
    const b = JSON.parse(init.body);
    bodies.push(b);
    if (b.stream) return sseResponse([textChunk('Halb'), textChunk('fertig')], { breakAfter: 1 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Komplette Antwort.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const deltas = [];
  const out = await askAIStream(CFG, [], { fetchFn, onDelta: (d) => deltas.push(d) });
  assert.equal(out.streamed, false);
  assert.equal(out.streamFallback, 'stream-broken');
  assert.deepEqual(deltas.map((d) => d.type), ['text', 'reset', 'text']);
  assert.equal(deltas.at(-1).text, 'Komplette Antwort.');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].stream, undefined);
});

test('askAIStream: Anbieter ignoriert stream und schickt JSON → funktioniert trotzdem', async () => {
  const fetchFn = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Als JSON.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const deltas = [];
  const out = await askAIStream(CFG, [], { fetchFn, onDelta: (d) => deltas.push(d) });
  assert.equal(out.data.choices[0].message.content, 'Als JSON.');
  assert.deepEqual(deltas, [{ type: 'text', text: 'Als JSON.' }]);
});

test('askAIStream: kein lesbarer Body → Rückfall auf normalen Weg', async () => {
  let n = 0;
  const fetchFn = async (url, init) => {
    n++;
    if (JSON.parse(init.body).stream) return { ok: true, status: 200, headers: { get: () => 'text/event-stream' }, body: null };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Fallback.' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await askAIStream(CFG, [], { fetchFn, onDelta: () => {} });
  assert.equal(n, 2);
  assert.equal(out.streamFallback, 'nostream');
  assert.equal(out.data.choices[0].message.content, 'Fallback.');
});

test('askAIStream: stream:false nutzt direkt den normalen Weg', async () => {
  const fetchFn = async (url, init) => {
    assert.equal(JSON.parse(init.body).stream, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await askAIStream(CFG, [], { fetchFn, stream: false });
  assert.equal(out.streamed, false);
});

test('requestStreamOnce: AbortSignal bricht ab (kein Rückfall)', async () => {
  const ctrl = new AbortController();
  const fetchFn = async (url, init) => new Response(new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(textChunk('Hallo')));
      init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    }
  }), { headers: { 'content-type': 'text/event-stream' } });
  const seen = [];
  const p = askAIStream(CFG, [], {
    fetchFn, signal: ctrl.signal,
    onDelta: (d) => { seen.push(d); if (d.type === 'text') ctrl.abort(); }
  });
  await assert.rejects(p, (e) => e.code === 'aborted');
  assert.deepEqual(seen.map((d) => d.text), ['Hallo']);
  await assert.rejects(requestStreamOnce(CFG, '/chat/completions', { body: {}, fetchFn, signal: ctrl.signal }), (e) => e.code === 'aborted');
});

test('Tool-Schleife streamt: gestückelte tool_calls, reset, dann Antworttext', async () => {
  let round = 0;
  const fetchFn = async (url, init) => {
    const b = JSON.parse(init.body);
    assert.equal(b.stream, true);
    round++;
    if (round === 1) {
      return sseResponse(shred(
        textChunk('Ich prüfe ') +
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'get_bat', arguments: '' } }] } }] }) +
        ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'tery', arguments: '{}' } }] } }] }) +
        ev({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + DONE, 11));
    }
    assert.equal(b.messages.at(-1).role, 'tool');
    assert.equal(b.messages.at(-2).tool_calls[0].function.name, 'get_battery');
    return sseResponse([textChunk('Akku: '), textChunk('80 %.'), DONE]);
  };
  const store = createStore(createMemoryAdapter());
  const device = { getBattery: async () => ({ ok: true, level: 0.8, charging: false }) };
  const deltas = [];
  const out = await runToolLoop({
    cfg: CFG, systemPrompt: 's', history: [{ role: 'user', text: 'Akku?' }],
    registry: createDefaultRegistry(), ctx: { store, device, now: new Date() }, fetchFn,
    onDelta: (d) => deltas.push(d)
  });
  assert.equal(out.text, 'Akku: 80 %.');
  assert.deepEqual(deltas.map((d) => d.type), ['text', 'reset', 'tool', 'tool-result', 'text', 'text']);
  assert.equal(deltas[2].name, 'get_battery');
});

test('Tool-Schleife streamt: Bestätigungskarte bleibt erhalten', async () => {
  const fetchFn = async () => sseResponse([
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'call_phone', arguments: '{"number":' } }] } }] }),
    ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"0151 234567"}' } }] } }] }),
    DONE
  ]);
  const store = createStore(createMemoryAdapter());
  const out = await runToolLoop({
    cfg: CFG, systemPrompt: 's', history: [{ role: 'user', text: 'Ruf an' }],
    registry: createDefaultRegistry(), ctx: { store, device: { canOpenUrl: () => true, openUrl: () => ({ ok: true }) }, now: new Date() },
    fetchFn, onDelta: () => {}
  });
  assert.ok(out.confirm, 'confirm vorhanden');
  assert.match(out.confirm.action.url, /^tel:/);
});

test('Assistent: onDelta + msg/delta-Ereignisse über den Transport', async () => {
  const store = createStore(createMemoryAdapter());
  saveSettings(store, { provider: 'xai', apiKeys: { xai: 'test-key' } });
  const timers = createTimerManager({ store, schedule: () => 0, unschedule: () => {} });
  const transport = createLocalTransport({ record: true });
  const fetchFn = async () => sseResponse([textChunk('Hallo '), textChunk('Welt.'), DONE]);
  const a = createAssistant({ store, timers, device: {}, fetchFn, transport });
  const ui = [];
  const r = await a.process('Erzähl mir etwas Schönes über Wolken bitte', { onDelta: (d) => ui.push(d.text) });
  assert.equal(r.text, 'Hallo Welt.');
  assert.deepEqual(ui, ['Hallo ', 'Welt.']);
  const types = transport.sent.map((e) => e.type);
  assert.deepEqual(types, ['msg', 'delta', 'delta', 'delta', 'msg']);
  const [userEv, d1, , done, replyEv] = transport.sent;
  assert.equal(userEv.role, 'user');
  assert.equal(d1.replyTo, userEv.id);
  assert.equal(d1.seq, 0);
  assert.equal(done.done, true);
  assert.equal(replyEv.text, 'Hallo Welt.');
  assert.equal(replyEv.id, r.id);
});

test('Satz-Zerleger für satzweise Sprachausgabe', () => {
  const c = createSentenceChunker();
  assert.deepEqual(c.push('Guten Tag. Es ist z. B. '), ['Guten Tag.']);
  assert.deepEqual(c.push('der 3. Mai! Wie'), ['Es ist z. B. der 3. Mai!']);
  assert.deepEqual(c.push(' geht es?'), []);
  assert.deepEqual(c.flush(), ['Wie geht es?']);
  assert.deepEqual(c.flush(), []);
});
