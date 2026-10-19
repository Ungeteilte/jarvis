// Ereignis-Protokoll v1 für Live-Chat (transportunabhängig, browser-frei).
// Gleiche Form später über WebSocket (Option B):
//   { v:1, type:'msg'|'delta'|'ack'|'presence'|'error', id, room, from, ts, ... }
//   msg:   role, text, (source, confirm …)  – fertige Nachricht
//   delta: replyTo, seq, text | reset:true | done:true – Teilstück einer Antwort
//   ack:   replyTo (= id der bestätigten Nachricht)

export const PROTOCOL_VERSION = 1;
export const EVENT_TYPES = Object.freeze(['msg', 'delta', 'ack', 'presence', 'error']);
const ROLES = new Set(['user', 'assistant', 'system', 'tool']);
const MAX_TEXT = 20000;

export function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function base(type, { room = 'local', from = 'local', id = newId(), ts = Date.now() } = {}) {
  return { v: PROTOCOL_VERSION, type, id, room, from, ts };
}

/** Fertige Chat-Nachricht → msg-Ereignis. */
export function makeMsgEvent(msg, meta = {}) {
  const ev = { ...base('msg', { ...meta, id: msg.id || meta.id }), role: msg.role, text: String(msg.text ?? '') };
  if (msg.source) ev.source = msg.source;
  if (msg.confirm) ev.confirm = msg.confirm;
  if (msg.error) ev.error = true;
  return ev;
}

/** Teilstück einer laufenden Antwort. */
export function makeDeltaEvent({ replyTo, seq, text, reset, done }, meta = {}) {
  const ev = { ...base('delta', meta), replyTo, seq };
  if (reset) ev.reset = true;
  if (done) ev.done = true;
  if (text != null) ev.text = String(text);
  return ev;
}

export function makeAckEvent(replyTo, meta = {}) {
  return { ...base('ack', meta), replyTo };
}

/** Prüft ein Ereignis. Gibt { ok, error? } zurück. */
export function validateEvent(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, error: 'kein Objekt' };
  if (ev.v !== PROTOCOL_VERSION) return { ok: false, error: 'falsche Version' };
  if (!EVENT_TYPES.includes(ev.type)) return { ok: false, error: 'unbekannter Typ' };
  if (typeof ev.id !== 'string' || !ev.id) return { ok: false, error: 'id fehlt' };
  if (typeof ev.ts !== 'number') return { ok: false, error: 'ts fehlt' };
  if (ev.text != null && (typeof ev.text !== 'string' || ev.text.length > MAX_TEXT)) return { ok: false, error: 'text ungültig' };
  if (ev.type === 'msg' && !ROLES.has(ev.role)) return { ok: false, error: 'role ungültig' };
  if (ev.type === 'delta' && (typeof ev.replyTo !== 'string' || !Number.isInteger(ev.seq))) {
    return { ok: false, error: 'delta braucht replyTo und seq' };
  }
  if (ev.type === 'ack' && typeof ev.replyTo !== 'string') return { ok: false, error: 'ack braucht replyTo' };
  return { ok: true };
}
