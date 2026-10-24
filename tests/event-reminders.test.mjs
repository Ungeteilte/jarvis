import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { createTimerManager } from '../js/core/timers.js';
import { createAssistant } from '../js/core/assistant.js';
import { saveSettings, loadSettings, DEFAULT_SETTINGS } from '../js/core/settings.js';
import { savePersona } from '../js/core/persona.js';
import {
  EVENT_LEAD_OPTIONS, DEFAULT_EVENT_REMINDERS, clampLead, normalizeEventRemindersConfig, eventRemindersCommand
} from '../js/core/event-reminders.js';

test('Termin-Hinweise: Standard an, 15 Min., ohne Vorlesen; Optionen wie im Java-Teil', () => {
  assert.deepEqual({ ...DEFAULT_EVENT_REMINDERS }, { enabled: true, leadMin: 15, speak: false });
  assert.deepEqual(EVENT_LEAD_OPTIONS, [5, 10, 15, 30, 60]);
  assert.deepEqual(loadSettings(createStore(createMemoryAdapter())).eventReminders, { enabled: true, leadMin: 15, speak: false });
  assert.ok(DEFAULT_SETTINGS.eventReminders);
  // gleiche Werte wie EventReminderRulesTest.clampLeadMatchesJs
  for (const [i, o] of [[0, 15], [-3, 15], [1, 5], [9, 10], [14, 15], [25, 30], [240, 60]]) assert.equal(clampLead(i), o, `clampLead(${i})`);
  assert.equal(clampLead('abc'), 15);
});

test('Termin-Hinweise: Normalisierung (Unsinn → Standard, Vorlauf auf erlaubte Werte)', () => {
  assert.deepEqual(normalizeEventRemindersConfig(null), { enabled: true, leadMin: 15, speak: false });
  assert.deepEqual(normalizeEventRemindersConfig({ enabled: false, leadMin: 45, speak: true }), { enabled: false, leadMin: 30, speak: true });
  assert.deepEqual(normalizeEventRemindersConfig({ enabled: 'ja', leadMin: 'x', speak: 1 }), { enabled: true, leadMin: 15, speak: false });
  const store = createStore(createMemoryAdapter());
  saveSettings(store, { eventReminders: { enabled: false, leadMin: 7 } });
  assert.deepEqual(loadSettings(store).eventReminders, { enabled: false, leadMin: 5, speak: false });
});

test('Termin-Hinweise: Sprachbefehle aus/an/Vorlauf, sonst null', () => {
  let saved = null;
  const save = (n) => { saved = n; };
  const cur = { enabled: true, leadMin: 15, speak: true };
  assert.match(eventRemindersCommand('Terminhinweise aus', cur, save), /nicht mehr von selbst/);
  assert.deepEqual(saved, { enabled: false, leadMin: 15, speak: true });
  assert.match(eventRemindersCommand('Schalte die Termin-Hinweise ab', cur, save), /nicht mehr/);
  assert.match(eventRemindersCommand('Termin Erinnerungen einschalten', { ...cur, enabled: false }, save), /etwa 15 Minuten vor jedem Termin/);
  assert.equal(saved.enabled, true);
  assert.match(eventRemindersCommand('Terminhinweise 30 Minuten vorher', cur, save), /30 Minuten vor Ihren Terminen/);
  assert.equal(saved.leadMin, 30);
  assert.match(eventRemindersCommand('Terminhinweise 20 min vorher', cur, save), /15|30/);
  for (const t of ['Erinnere mich um 5 an Tee', 'Erinnerungen aus', 'Was steht heute an?', 'Abendzusammenfassung aus', 'Termin morgen um 10 eintragen']) {
    assert.equal(eventRemindersCommand(t, cur, save), null, t);
  }
});

test('Termin-Hinweise: Befehl im Assistenten speichert lokal, ohne Netz, ohne Kalenderzugriff', async () => {
  const store = createStore(createMemoryAdapter());
  savePersona(store, { name: 'Jarvis', onboarded: true });
  const timers = createTimerManager({ store, onDone: () => {}, schedule: () => 0, unschedule: () => {} });
  const device = { getCalendarEvents: async () => { throw new Error('kein Kalender erwartet'); } };
  const fetchFn = async (u) => { throw new Error('kein Netz erwartet: ' + u); };
  const assistant = createAssistant({ store, timers, device, fetchFn, now: () => new Date('2026-10-21T12:00:00+02:00'), timeZone: 'Europe/Berlin', stream: false });
  let r = await assistant.process('Terminhinweise aus');
  assert.equal(r.source, 'skill');
  assert.equal(r.settingsChanged, true);
  assert.equal(loadSettings(store).eventReminders.enabled, false);
  r = await assistant.process('Terminhinweise 60 Minuten vorher');
  assert.deepEqual(loadSettings(store).eventReminders, { enabled: true, leadMin: 60, speak: false });
});

test('Termin-Hinweise: Modul im Offline-Cache, Einstellungen in „Werkzeuge & Berechtigungen“', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./js/core/event-reminders.js'"));
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tools = html.slice(html.indexOf('id="grp-tools"'), html.indexOf('id="grp-notif"'));
  for (const id of ['set-ev-enabled', 'set-ev-lead', 'set-ev-speak', 'btn-ev-test', 'ev-status']) assert.ok(tools.includes(`id="${id}"`), id);
});
