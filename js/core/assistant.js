// Der "Kopf": lokale Skills → lokale Tool-Trigger → KI mit Tool-Schleife.
// Komplett browser-frei – UI und Sprachausgabe hängen sich nur an.

import { handleSkill, loadNotes } from './skills.js';
import { buildSystemPrompt } from './prompt.js';
import { loadSettings, resolveProvider } from './settings.js';
import { loadPersona } from './persona.js';
import { createDefaultRegistry, tryLocalTool, runToolLoop } from './tools/index.js';

const HISTORY_KEY = 'history';
const MAX_HISTORY = 200;

export function createAssistant({ store, timers, device, fetchFn, now = () => new Date(), registry } = {}) {
  const tools = registry || createDefaultRegistry();
  let history = store.get(HISTORY_KEY, []);
  const persist = () => store.set(HISTORY_KEY, history.slice(-MAX_HISTORY));

  function add(role, text, meta = {}) {
    const msg = { role, text, at: now().toISOString(), ...meta };
    history.push(msg);
    persist();
    return msg;
  }

  function ctx() {
    const persona = loadPersona(store);
    return {
      store, timers, device, registry: tools,
      now: now(), name: persona.name
    };
  }

  return {
    getHistory: () => [...history],
    getRegistry: () => tools,
    clearHistory() { history = []; persist(); },
    add,
    /** Bestätigte Aktion ausführen (nach Ja auf der Karte). */
    async confirmAction(action) {
      if (!action || action.type !== 'openUrl') {
        return add('assistant', 'Diese Aktion kann ich leider nicht ausführen.', { source: 'system' });
      }
      if (!device?.openUrl) {
        return add('assistant', 'Verzeihung, das Öffnen von Apps ist hier nicht möglich.', { source: 'system' });
      }
      const r = device.openUrl(action.url);
      if (r?.ok) return add('assistant', 'Sehr wohl, ich öffne das für Sie.', { source: 'tool' });
      return add('assistant', r?.message || 'Das hat leider nicht geklappt.', { source: 'system', error: true });
    },
    cancelAction() {
      return add('assistant', 'Alles klar, ich breche ab.', { source: 'system' });
    },
    /** Verarbeitet eine Nutzereingabe und gibt die Antwort-Nachricht zurück. */
    async process(text) {
      const input = String(text || '').trim();
      if (!input) return null;
      add('user', input);
      const c = ctx();

      // 1) Klassische Skills (Uhrzeit, Datum, Timer, Notizen, Name)
      const local = handleSkill(input, c);
      if (local) return add('assistant', local, { source: 'skill' });

      // 2) Schnelle Tool-Trigger ohne KI
      const hit = await tryLocalTool(input, tools, c);
      if (hit) {
        const meta = { source: 'tool', tool: hit.name };
        if (hit.result?.needsConfirm && hit.result.confirm) meta.confirm = hit.result.confirm;
        if (hit.result?.unsupported) meta.unsupported = true;
        if (hit.result && hit.result.ok === false && !hit.result.needsConfirm) meta.error = !hit.result.unsupported;
        return add('assistant', hit.text, meta);
      }

      // 3) KI mit Tool-Schleife
      const cfg = resolveProvider(loadSettings(store));
      if (!cfg.apiKey) {
        return add('assistant',
          'Das habe ich so nicht erkannt. Fragen Sie „Was kannst du?“, oder hinterlegen Sie in den Einstellungen einen API-Schlüssel für freiere Formulierungen.',
          { source: 'system' });
      }
      const system = buildSystemPrompt({
        name: c.name, now: c.now, notes: loadNotes(store), tools: tools.helpLines()
      });
      const chat = history.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.source !== 'system'));
      try {
        const out = await runToolLoop({
          cfg, systemPrompt: system, history: chat, registry: tools, ctx: c, fetchFn
        });
        const meta = { source: 'ai', toolResults: out.toolResults };
        if (out.confirm) meta.confirm = out.confirm;
        return add('assistant', out.text || 'Fertig.', meta);
      } catch (e) {
        return add('assistant', `Verzeihung, da ging etwas schief. ${e.message}`, { source: 'system', error: true });
      }
    }
  };
}
