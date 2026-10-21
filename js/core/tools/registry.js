import { gate, markOrigin } from './risk.js';

// Browser-freie Werkzeug-Registry. Jedes Werkzeug hat:
//   name, description (DE), parameters (JSON-Schema),
//   risk: 'lesen' | 'lokal' | 'schreiben' | 'aussen' (v0.9, siehe risk.js; fehlt → 'aussen'),
//   confirms?: 'always' | 'system' | 'self', describe?(args) → { title, detail } für die zentrale Karte,
//   externalData?: true (liefert fremde Texte → Taint), sourceLabel?: z. B. 'Nachrichten',
//   execute(args, ctx) → { ok, message, needsConfirm?, confirm?, data?, unsupported? }
//   localTriggers?: [{ re, parse(match, text) → args|null }]
//
// ctx = { device, store, timers, now, name, timeZone }
// device = injizierter Adapter (Web oder später Android).

export function createToolRegistry(tools = []) {
  const byName = new Map();
  for (const t of tools) {
    if (!t?.name || typeof t.execute !== 'function') throw new Error(`Ungültiges Werkzeug: ${t?.name}`);
    if (byName.has(t.name)) throw new Error(`Doppeltes Werkzeug: ${t.name}`);
    byName.set(t.name, t);
  }
  return {
    list: () => [...byName.values()],
    get: (name) => byName.get(name) || null,
    names: () => [...byName.keys()],
    /** OpenAI-kompatible tools-Liste für die Chat-API. */
    toOpenAITools() {
      return this.list().map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters || { type: 'object', properties: {} }
        }
      }));
    },
    /** Kurzbeschreibung für „Was kannst du?“ und den System-Prompt. */
    helpLines() {
      return this.list().map((t) => t.userHint || t.description);
    },
    async run(name, args, ctx) {
      const t = byName.get(name);
      if (!t) return { ok: false, message: `Unbekanntes Werkzeug: ${name}.` };
      try {
        // Zentrale Regel (v0.9 W0): Risikoklasse + Taint entscheiden, ob eine Karte nötig ist.
        const g = gate(t, args || {}, ctx || {});
        if (g && !g.selfConfirm) return g;
        // confirms='self' unter Taint: Werkzeug baut seine eigene Karte (z. B. mit Paketname)
        const runCtx = g?.selfConfirm ? { ...ctx, mustConfirm: true } : ctx;
        const r = await t.execute(args || {}, runCtx);
        if (g?.selfConfirm && r?.ok !== false && !r?.needsConfirm) {
          // Vertrag gebrochen: Werkzeug hat trotz mustConfirm ohne Karte gehandelt – laut melden (Test fängt das)
          return { ok: false, blocked: true, message: `Werkzeug „${name}“ hat ohne Bestätigung gehandelt.` };
        }
        // Fremde Daten gelesen → Taint für den Rest der Runde, mit Herkunft für den Kartenhinweis
        if (t.externalData && ctx?.turn) {
          ctx.turn.external = true;
          (ctx.turn.sources ||= new Set()).add(t.sourceLabel || 'fremden Quellen');
        }
        return markOrigin(r, ctx || {});
      } catch (e) {
        return { ok: false, message: `Werkzeug „${name}“ ist fehlgeschlagen: ${e.message || e}` };
      }
    }
  };
}

/** Ergebnis als kurzen Text für die KI / den Chat. */
export function resultToText(r) {
  if (!r) return 'Keine Antwort vom Werkzeug.';
  return r.message || (r.ok ? 'Erledigt.' : 'Fehlgeschlagen.');
}
