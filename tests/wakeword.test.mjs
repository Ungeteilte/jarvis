import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWakeMatcher, normalizeText } from '../js/core/wakeword.js';

test('normalizeText: Umlaute, ß, Satzzeichen', () => {
  assert.equal(normalizeText('Hey, Jürgen! Größe?'), 'hey juergen groesse');
});

test('Jarvis: Grundfälle', () => {
  const m = createWakeMatcher('Jarvis');
  assert.deepEqual(m('Hey Jarvis wie spät ist es'), { matched: true, command: 'wie spät ist es', greeting: 'hey' });
  assert.equal(m('Jarvis').matched, true);
  assert.equal(m('Jarvis').command, '');
  assert.equal(m('hallo jarvis, stell einen Timer auf 5 Minuten').command, 'stell einen Timer auf 5 Minuten');
  assert.equal(m('JARVIS: Merke dir Milch').command, 'Merke dir Milch');
});

test('Jarvis: typische Erkennungsfehler', () => {
  const m = createWakeMatcher('Jarvis');
  for (const v of ['hey Jarwis', 'hey Dschawis', 'Tscharvis', 'hey Javis', 'hey charvis', 'hey Jarvis.']) {
    assert.equal(m(v).matched, true, v);
  }
});

test('Jarvis: keine Fehlauslöser', () => {
  const m = createWakeMatcher('Jarvis');
  for (const v of ['wie spät ist es', 'hey Paris', 'ich mag Jarvis Filme', 'Service', '']) {
    assert.equal(m(v).matched, false, v);
  }
});

test('Eigener Name mit Umlaut', () => {
  const m = createWakeMatcher('Jürgen');
  assert.equal(m('Hey Jürgen wie spät').command, 'wie spät');
  assert.equal(m('hey juergen').matched, true);
  assert.equal(m('hey Jurgen').matched, true);
  assert.equal(m('hey Jarvis').matched, false);
});

test('Eigener Name: Friday / Großschreibung', () => {
  const m = createWakeMatcher('Friday');
  assert.equal(m('HEY FRIDAY welches Datum').command, 'welches Datum');
  assert.equal(m('ok friday').matched, true);
  assert.equal(m('Freitag').matched, false);
});

test('Zweiteiliger Name (auch zusammengeschrieben erkannt)', () => {
  const m = createWakeMatcher('Mister Smith');
  assert.equal(m('hey mister smith wie spät').command, 'wie spät');
  assert.equal(m('hey Mistersmith').matched, true);
  assert.equal(m('hey mister').matched, false);
});

test('Kurzer Name nur exakt', () => {
  const m = createWakeMatcher('Max');
  assert.equal(m('hey Max').matched, true);
  assert.equal(m('hey Mac').matched, false);
});

test('Name am Satzende löst aus, Befehl ist leer', () => {
  const m = createWakeMatcher('Edith');
  const r = m('bist du da Edith');
  assert.equal(r.matched, true);
  assert.equal(r.command, '');
});

import { createWakeController } from '../js/core/wake-controller.js';

function fakeSTT() {
  const s = { started: 0, stopped: 0 };
  s.startContinuous = (h) => { s.started++; s.h = h; return { stop: () => s.stopped++ }; };
  return s;
}

test('Wake-Controller: Befehl in einem Satz, Namenswechsel zur Laufzeit', () => {
  let name = 'Jarvis';
  const cmds = [];
  const stt = fakeSTT();
  const c = createWakeController({ stt, getName: () => name, onCommand: (t) => cmds.push(t) });
  c.enable();
  assert.equal(stt.started, 1);
  stt.h.onFinal('Hey Jarvis wie spät ist es');
  name = 'Friday';
  stt.h.onFinal('Hey Jarvis welches Datum'); // alter Name zählt nicht mehr
  stt.h.onFinal('Hey Friday welches Datum');
  assert.deepEqual(cmds, ['wie spät ist es', 'welches Datum']);
});

test('Wake-Controller: nur Name → nächster Satz ist Befehl', () => {
  const cmds = [];
  let woke = 0;
  const stt = fakeSTT();
  const c = createWakeController({ stt, getName: () => 'Jarvis', onWake: () => woke++, onCommand: (t) => cmds.push(t), commandWindowMs: 50 });
  c.enable();
  stt.h.onFinal('irgendwas anderes');
  stt.h.onFinal('Jarvis');
  assert.equal(woke, 1);
  assert.equal(c.awaiting, true);
  stt.h.onFinal('Merke dir Milch');
  assert.deepEqual(cmds, ['Merke dir Milch']);
  c.pause();
  assert.equal(stt.stopped, 1);
  c.resume();
  assert.equal(stt.started, 2);
  c.disable();
});
