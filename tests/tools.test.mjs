import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { createTimerManager } from '../js/core/timers.js';
import { createToolRegistry, resultToText } from '../js/core/tools/registry.js';
import { TOOL_DEFINITIONS } from '../js/core/tools/definitions.js';
import { matchLocalTrigger } from '../js/core/tools/triggers.js';
import { tryLocalTool, runToolLoop, createDefaultRegistry } from '../js/core/tools/index.js';
import { createAssistant } from '../js/core/assistant.js';
import { saveSettings } from '../js/core/settings.js';
import { savePersona } from '../js/core/persona.js';

function fakeDevice(overrides = {}) {
  const opened = [];
  return {
    opened,
    canOpenUrl: () => true,
    openUrl: (url) => { opened.push(url); return { ok: true }; },
    canShare: () => true,
    share: async () => ({ ok: true }),
    vibrate: async () => ({ ok: true }),
    getBattery: async () => ({ ok: true, level: 0.64, charging: false }),
    getLocation: async () => ({ ok: true, latitude: 52.52, longitude: 13.405, accuracy: 12 }),
    copyText: async () => ({ ok: true }),
    setFlashlight: async () => ({ ok: false, unsupported: true }),
    ...overrides
  };
}

function ctx(device) {
  const store = createStore(createMemoryAdapter());
  const timers = createTimerManager({ store, onDone: () => {}, schedule: () => 0, unschedule: () => {} });
  const registry = createDefaultRegistry();
  return { store, timers, device: device || fakeDevice(), registry, now: new Date('2026-10-19T14:05:00Z'), name: 'Jarvis' };
}

test('Registry listet alle Werkzeuge ohne Duplikate', () => {
  const r = createDefaultRegistry();
  assert.ok(r.names().length >= 15);
  assert.equal(new Set(r.names()).size, r.names().length);
  const openai = r.toOpenAITools();
  assert.equal(openai[0].type, 'function');
  assert.ok(openai.every((t) => t.function.name && t.function.parameters));
});

test('Doppelter Name wirft', () => {
  assert.throws(() => createToolRegistry([{ name: 'a', execute: async () => ({}) }, { name: 'a', execute: async () => ({}) }]));
});

test('Lokale Trigger: Anruf, SMS, WhatsApp, Maps, YouTube, Website, Akku, Standort, Kopieren', async () => {
  const c = ctx();
  const cases = [
    ['Ruf die 01701234567 an', 'call_phone'],
    ['Schreib eine SMS an 0170 1234567: Hallo Oma', 'send_sms'],
    ['WhatsApp an +491701234567: Bin unterwegs', 'send_whatsapp'],
    ['Schreib eine Mail an max@example.com: Termin', 'send_email'],
    ['Navigiere zum Berliner Hauptbahnhof', 'navigate'],
    ['Such auf YouTube nach Lofi Hip Hop', 'open_youtube'],
    ['Spiel auf Spotify Bohemian Rhapsody', 'open_spotify'],
    ['Öffne wikipedia.org', 'open_website'],
    ['Wie voll ist der Akku?', 'get_battery'],
    ['Wo bin ich?', 'get_location'],
    ['Kopiere den Text: Geheimnis 42', 'copy_to_clipboard'],
    ['Vibriere kurz', 'vibrate'],
    ['Taschenlampe an', 'set_flashlight'],
    ['Teile den Text: Hallo Welt', 'share_text']
  ];
  for (const [text, name] of cases) {
    const hit = matchLocalTrigger(text, c.registry);
    assert.ok(hit, text);
    assert.equal(hit.name, name, text);
  }
});

test('Anruf verlangt Bestätigung und öffnet erst nach confirmAction', async () => {
  const device = fakeDevice();
  const c = ctx(device);
  const hit = await tryLocalTool('Ruf die 01701234567 an', c.registry, c);
  assert.equal(hit.result.needsConfirm, true);
  assert.match(hit.result.confirm.action.url, /^tel:01701234567$/);
  assert.equal(device.opened.length, 0);
  const a = createAssistant({ store: c.store, timers: c.timers, device });
  await a.confirmAction(hit.result.confirm.action);
  assert.deepEqual(device.opened, ['tel:01701234567']);
});

test('WhatsApp: deutsche 0-Nummer → 49…', async () => {
  const hit = await tryLocalTool('WhatsApp an 01701234567: Hi', createDefaultRegistry(), ctx());
  assert.match(hit.result.confirm.action.url, /wa\.me\/491701234567/);
});

test('Taschenlampe: höfliche unsupported-Antwort', async () => {
  const hit = await tryLocalTool('Taschenlampe an', createDefaultRegistry(), ctx());
  assert.equal(hit.result.unsupported, true);
  assert.match(hit.text, /Android-App/);
});

test('Akku und Standort liefern deutsche Antworten', async () => {
  const c = ctx();
  assert.match((await tryLocalTool('Wie voll ist der Akku?', c.registry, c)).text, /64 Prozent/);
  const loc = await tryLocalTool('Wo bin ich?', c.registry, c);
  assert.match(loc.text, /52\.52000/);
  assert.equal(loc.result.needsConfirm, true);
});

test('Was kannst du? listet Werkzeuge', async () => {
  const c = ctx();
  const a = createAssistant({ store: c.store, timers: c.timers, device: c.device, registry: c.registry });
  const r = await a.process('Was kannst du?');
  assert.match(r.text, /Anrufen/);
  assert.match(r.text, /WhatsApp|Navigation|YouTube/);
});

test('Tool-Schleife: Fake-KI ruft navigate, dann finale Antwort', async () => {
  const c = ctx();
  saveSettings(c.store, { provider: 'xai', apiKeys: { xai: 'test-key' } });
  savePersona(c.store, { name: 'Jarvis' });
  let step = 0;
  const fetchFn = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.tools.length >= 10);
    step++;
    if (step === 1) {
      assert.equal(body.messages.at(-1).content, 'Navigiere bitte zum Brandenburger Tor');
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant', content: null,
              tool_calls: [{
                id: 'call_1', type: 'function',
                function: { name: 'navigate', arguments: JSON.stringify({ query: 'Brandenburger Tor', mode: 'driving' }) }
              }]
            }
          }]
        })
      };
    }
    // Zweite Runde käme nur ohne needsConfirm – navigate braucht Confirm, daher stoppt die Schleife früher.
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Bitte bestätigen.' } }] }) };
  };
  const out = await runToolLoop({
    cfg: { baseUrl: 'https://api.x.ai/v1', apiKey: 'test-key', model: 'grok-4.7' },
    systemPrompt: 'Du bist Jarvis.',
    history: [{ role: 'user', text: 'Navigiere bitte zum Brandenburger Tor' }],
    registry: c.registry,
    ctx: c,
    fetchFn
  });
  assert.equal(out.confirm.action.type, 'openUrl');
  assert.match(out.confirm.action.url, /google\.com\/maps/);
  assert.equal(out.toolResults[0].name, 'navigate');
  assert.equal(step, 1); // Confirm stoppt vor zweiter KI-Runde
});

test('Tool-Schleife ohne Confirm: get_battery → zweite Runde mit Text', async () => {
  const c = ctx();
  let step = 0;
  const fetchFn = async (_url, init) => {
    step++;
    if (step === 1) {
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_battery', arguments: '{}' } }]
            }
          }]
        })
      };
    }
    const body = JSON.parse(init.body);
    const toolMsg = body.messages.find((m) => m.role === 'tool');
    assert.match(toolMsg.content, /64 Prozent/);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Der Akku ist gut gefüllt.' } }] }) };
  };
  const out = await runToolLoop({
    cfg: { baseUrl: 'https://api.x.ai/v1', apiKey: 'k', model: 'm' },
    systemPrompt: 's',
    history: [{ role: 'user', text: 'Akku?' }],
    registry: c.registry,
    ctx: c,
    fetchFn
  });
  assert.equal(out.text, 'Der Akku ist gut gefüllt.');
  assert.equal(step, 2);
});

test('Assistent: lokaler Trigger ohne Schlüssel', async () => {
  const device = fakeDevice();
  const store = createStore(createMemoryAdapter());
  const timers = createTimerManager({ store, schedule: () => 0, unschedule: () => {} });
  const a = createAssistant({ store, timers, device });
  const r = await a.process('Kopiere den Text: Test123');
  assert.equal(r.source, 'tool');
  assert.match(r.text, /Zwischenablage/);
});

test('resultToText Fallback', () => {
  assert.equal(resultToText({ ok: true }), 'Erledigt.');
  assert.equal(resultToText(null), 'Keine Antwort vom Werkzeug.');
});
