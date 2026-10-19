import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createMemoryAdapter } from '../js/core/storage.js';
import { loadPersona, savePersona, sanitizeName, pickVoice, sortVoices, voiceIdOf, previewSentence, DEFAULT_PERSONA } from '../js/core/persona.js';

const voices = [
  { name: 'English US', lang: 'en-US', voiceURI: 'en-us-1' },
  { name: 'Deutsch Anna', lang: 'de-DE', voiceURI: 'de-anna' },
  { name: 'Google Deutsch', lang: 'de-DE', voiceURI: 'Google Deutsch' },
  { name: 'Österreich', lang: 'de-AT', voiceURI: '' }
];

test('Standard-Persona ist Jarvis', () => {
  const store = createStore(createMemoryAdapter());
  assert.deepEqual(loadPersona(store), { ...DEFAULT_PERSONA });
});

test('Persona wird gespeichert und geladen', () => {
  const adapter = createMemoryAdapter();
  savePersona(createStore(adapter), { name: '  Friday ', voiceId: 'de-anna', rate: 1.3, pitch: 0.8 });
  const p = loadPersona(createStore(adapter)); // neuer Store, gleicher Speicher
  assert.equal(p.name, 'Friday');
  assert.equal(p.voiceId, 'de-anna');
  assert.equal(p.rate, 1.3);
  assert.equal(p.pitch, 0.8);
});

test('Teil-Updates behalten andere Werte', () => {
  const store = createStore(createMemoryAdapter());
  savePersona(store, { name: 'Edith', rate: 1.2 });
  savePersona(store, { voiceId: 'x' });
  const p = loadPersona(store);
  assert.equal(p.name, 'Edith');
  assert.equal(p.rate, 1.2);
});

test('Ungültige Werte werden bereinigt', () => {
  const store = createStore(createMemoryAdapter());
  const p = savePersona(store, { name: '   ', rate: 99, pitch: 'abc' });
  assert.equal(p.name, 'Jarvis');
  assert.equal(p.rate, 2);
  assert.equal(p.pitch, 1);
  assert.equal(sanitizeName('<b>Max</b>'), 'bMax/b');
  assert.equal(sanitizeName('x'.repeat(50)).length, 30);
});

test('Kaputter Speicher fällt auf Standard zurück', () => {
  const store = createStore(createMemoryAdapter({ 'jarvis.persona': '{kaputt' }));
  assert.equal(loadPersona(store).name, 'Jarvis');
});

test('voiceIdOf nutzt voiceURI, sonst Name|Sprache', () => {
  assert.equal(voiceIdOf(voices[1]), 'de-anna');
  assert.equal(voiceIdOf(voices[3]), 'Österreich|de-AT');
});

test('sortVoices: Deutsch zuerst', () => {
  const sorted = sortVoices(voices);
  assert.ok(sorted.slice(0, 3).every((v) => v.lang.startsWith('de')));
  assert.equal(sorted[3].lang, 'en-US');
});

test('pickVoice: exakt, per Name, Fallback auf Google Deutsch', () => {
  assert.equal(pickVoice(voices, 'de-anna').name, 'Deutsch Anna');
  assert.equal(pickVoice(voices, 'Österreich|de-AT').name, 'Österreich');
  assert.equal(pickVoice(voices, 'Deutsch Anna|de-DE').name, 'Deutsch Anna'); // anderer URI, gleicher Name
  assert.equal(pickVoice(voices, 'gibt-es-nicht').name, 'Google Deutsch');
  assert.equal(pickVoice(voices, '').name, 'Google Deutsch');
  assert.equal(pickVoice([voices[0]], 'x').name, 'English US');
  assert.equal(pickVoice([], 'x'), null);
});

test('Vorhör-Satz enthält den Namen', () => {
  assert.match(previewSentence('Friday'), /Ich bin Friday/);
});
