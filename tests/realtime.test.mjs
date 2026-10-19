import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION, makeMsgEvent, makeDeltaEvent, makeAckEvent, validateEvent,
  createLocalTransport, isTransport
} from '../js/core/realtime/index.js';

test('Ereignisse haben {v,type,id,room,from,ts} und sind gültig', () => {
  const m = makeMsgEvent({ id: 'm1', role: 'user', text: 'Hallo' });
  assert.equal(m.v, PROTOCOL_VERSION);
  assert.equal(m.type, 'msg');
  assert.equal(m.id, 'm1');
  assert.equal(m.room, 'local');
  assert.ok(validateEvent(m).ok);
  const d = makeDeltaEvent({ replyTo: 'm1', seq: 0, text: 'Ha' });
  assert.ok(validateEvent(d).ok);
  assert.notEqual(d.id, m.id);
  assert.ok(validateEvent(makeDeltaEvent({ replyTo: 'm1', seq: 1, done: true })).ok);
  assert.ok(validateEvent(makeAckEvent('m1')).ok);
});

test('validateEvent lehnt Kaputtes ab', () => {
  assert.equal(validateEvent(null).ok, false);
  assert.equal(validateEvent({ ...makeMsgEvent({ role: 'user', text: 'x' }), v: 99 }).ok, false);
  assert.equal(validateEvent({ ...makeMsgEvent({ role: 'user', text: 'x' }), role: 'hacker' }).ok, false);
  assert.equal(validateEvent({ ...makeDeltaEvent({ replyTo: 'a', seq: 0 }), seq: 'x' }).ok, false);
  assert.equal(validateEvent({ ...makeMsgEvent({ role: 'user', text: 'x' }), type: 'exec' }).ok, false);
  assert.equal(validateEvent(makeMsgEvent({ role: 'user', text: 'x'.repeat(20001) })).ok, false);
});

test('Lokaler Transport: No-op, Echo, Abmelden, Status', async () => {
  const t = createLocalTransport({ echo: true, record: true });
  assert.ok(isTransport(t));
  assert.equal(isTransport({}), false);
  const got = [];
  const statuses = [];
  const off = t.onMessage((e) => got.push(e.id));
  t.onStatus((s) => statuses.push(s));
  await t.connect();
  assert.deepEqual(t.send(makeMsgEvent({ id: 'a', role: 'assistant', text: 'x' })), { ok: true, queued: false });
  off();
  t.send(makeMsgEvent({ id: 'b', role: 'assistant', text: 'y' }));
  assert.deepEqual(got, ['a']);
  assert.equal(t.sent.length, 2);
  assert.equal(t.send({ type: 'msg' }).ok, false);
  t.close();
  assert.deepEqual(statuses, ['local', 'closed']);
  const silent = createLocalTransport();
  assert.equal(silent.send(makeAckEvent('a')).ok, true);
  assert.equal(silent.sent.length, 0);
});
