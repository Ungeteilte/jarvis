// Schnelle Regex-Auslöser ohne KI. Match → { name, args } oder null.
import { normalizeText } from '../wakeword.js';

/**
 * Prüft den Text gegen die localTriggers aller Werkzeuge (Reihenfolge der Registry).
 * Gibt das erste Treffer-Paar zurück oder null.
 */
export function matchLocalTrigger(text, registry) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  for (const tool of registry.list()) {
    for (const trig of tool.localTriggers || []) {
      const m = raw.match(trig.re);
      if (!m) continue;
      try {
        const args = trig.parse ? trig.parse(m, raw) : {};
        if (args === null) continue;
        return { name: tool.name, args: args || {} };
      } catch { /* nächster Trigger */ }
    }
  }
  return null;
}

/** Hilfen für Trigger-Parser */
export const phoneDigits = (s) => String(s || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
export const stripQuotes = (s) => String(s || '').replace(/^["„“»«']|["„“»«']$/g, '').trim();
export const after = (raw, re) => {
  const m = String(raw).match(re);
  return m ? stripQuotes(m[1]).replace(/[.!?]+$/, '').trim() : '';
};
export const ntext = (t) => normalizeText(t);
