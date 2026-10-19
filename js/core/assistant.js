// Der "Kopf": entscheidet zwischen lokalen Skills und KI, verwaltet den Verlauf.
// Komplett browser-frei – UI und Sprachausgabe hängen sich nur an.

import { handleSkill, loadNotes } from './skills.js';
import { buildSystemPrompt } from './prompt.js';
import { askAI } from './ai.js';
import { loadSettings, resolveProvider } from './settings.js';
import { loadPersona } from './persona.js';

const HISTORY_KEY = 'history';
const MAX_HISTORY = 200;

export function createAssistant({ store, timers, fetchFn, now = () => new Date() }) {
  let history = store.get(HISTORY_KEY, []);
  const persist = () => store.set(HISTORY_KEY, history.slice(-MAX_HISTORY));

  function add(role, text, meta = {}) {
    const msg = { role, text, at: now().toISOString(), ...meta };
    history.push(msg);
    persist();
    return msg;
  }

  return {
    getHistory: () => [...history],
    clearHistory() { history = []; persist(); },
    add,
    /** Verarbeitet eine Nutzereingabe und gibt die Antwort-Nachricht zurück. */
    async process(text) {
      const input = String(text || '').trim();
      if (!input) return null;
      add('user', input);
      const persona = loadPersona(store);
      const local = handleSkill(input, { store, timers, now: now(), name: persona.name });
      if (local) return add('assistant', local, { source: 'skill' });

      const cfg = resolveProvider(loadSettings(store));
      if (!cfg.apiKey) {
        return add('assistant',
          'Für diese Frage brauche ich mein KI-Gehirn. Bitte hinterlegen Sie in den Einstellungen einen API-Schlüssel.',
          { source: 'system' });
      }
      const system = buildSystemPrompt({ name: persona.name, now: now(), notes: loadNotes(store) });
      const chat = history.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.source !== 'system'));
      try {
        const reply = await askAI(cfg, system, chat, { fetchFn });
        return add('assistant', reply, { source: 'ai' });
      } catch (e) {
        return add('assistant', `Verzeihung, da ging etwas schief. ${e.message}`, { source: 'system', error: true });
      }
    }
  };
}
