// Browser-freie Werkzeug-Registry. Jedes Werkzeug hat:
//   name, description (DE), parameters (JSON-Schema),
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
        return await t.execute(args || {}, ctx);
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
