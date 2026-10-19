// Transport-Schnittstelle für Live-Ereignisse. Der Assistent sendet msg-/delta-
// Ereignisse; ein späterer WebSocket-Transport (Web + Android-WebView) leitet
// sie an einen Server weiter. Standard: lokaler No-op-Transport.
//
// Schnittstelle (jede Implementierung):
//   connect(): Promise<void>
//   close(): void
//   send(event): { ok, queued?, error? }       – event nach protocol.js
//   onMessage(cb): () => void                   – eingehende Ereignisse, gibt Abmelden zurück
//   onStatus(cb): () => void                    – 'local' | 'connecting' | 'open' | 'closed'
//   status: string
import { validateEvent } from './protocol.js';

/** Lokaler Transport: sendet nirgendwohin (optional Echo/Aufzeichnung für Tests). */
export function createLocalTransport({ echo = false, record = false } = {}) {
  const msgListeners = new Set();
  const statusListeners = new Set();
  const sent = [];
  let status = 'local';
  const setStatus = (s) => { status = s; statusListeners.forEach((cb) => cb(s)); };
  return {
    get status() { return status; },
    sent,
    async connect() { setStatus('local'); },
    close() { setStatus('closed'); },
    send(event) {
      const v = validateEvent(event);
      if (!v.ok) return { ok: false, error: v.error };
      if (record) sent.push(event);
      if (echo) msgListeners.forEach((cb) => cb(event));
      return { ok: true, queued: false };
    },
    onMessage(cb) { msgListeners.add(cb); return () => msgListeners.delete(cb); },
    onStatus(cb) { statusListeners.add(cb); return () => statusListeners.delete(cb); }
  };
}

/** Prüft, ob ein Objekt die Transport-Schnittstelle erfüllt. */
export function isTransport(t) {
  return Boolean(t) && ['connect', 'close', 'send', 'onMessage', 'onStatus'].every((k) => typeof t[k] === 'function');
}
