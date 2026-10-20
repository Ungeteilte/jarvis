// Der "Kopf": lokale Skills → lokale Tool-Trigger → KI mit Tool-Schleife.
// Komplett browser-frei – UI und Sprachausgabe hängen sich nur an.

import { handleSkill, loadNotes, parseClockTime } from './skills.js';
import { buildSystemPrompt } from './prompt.js';
import { loadSettings, saveSettings, resolveProvider } from './settings.js';
import { loadPersona } from './persona.js';
import { createDefaultRegistry, tryLocalTool, runToolLoop } from './tools/index.js';
import { createLocalTransport, makeMsgEvent, makeDeltaEvent, newId } from './realtime/index.js';
import { createToolRegistry } from './tools/registry.js';
import { askAIStream } from './ai.js';
import {
  gatherFacts, buildBriefingMessages, templateBriefing, factsContext, localFollowUp,
  isBriefingRequest, handleBriefingCommand, saveBriefingState, loadBriefingState, dayKey, RESSORT_IDS, normalizeBriefingConfig,
  gatherEveningFacts, buildEveningMessages, templateEvening, eveningContext, eveningFollowUp,
  isEveningRequest, eveningCommand, normalizeEveningConfig
} from './briefing/index.js';

const HISTORY_KEY = 'history';
const MAX_HISTORY = 200;
const FOLLOW_UP_MS = 30 * 60000;
// Nach einem Briefing (fremde Schlagzeilen/Termintitel im Kontext) nur Werkzeuge, die lesen
// oder ohnehin per Ja-Karte bestätigt werden – kein stilles Handeln durch eingeschleuste Texte.
export const FOLLOW_UP_TOOLS = new Set([
  'call_phone', 'send_sms', 'send_whatsapp', 'send_email', 'navigate', 'open_youtube', 'open_spotify',
  'open_website', 'get_location', 'get_battery', 'list_notes', 'list_capabilities',
  'get_weather', 'get_news', 'get_calendar_events',
  // Wecker: die Uhr-App zeigt ihn vor dem Speichern an (SKIP_UI=false) → vom Nutzer bestätigt
  'set_alarm'
]);

export function createAssistant({ store, timers, device, fetchFn, now = () => new Date(), registry, transport, stream = true, timeZone } = {}) {
  const tools = registry || createDefaultRegistry();
  // Live-Ereignisse (msg/delta) – lokal No-op, später WebSocket (Option B)
  const rt = transport || createLocalTransport();
  const emitEvent = (ev) => { try { rt.send(ev); } catch { /* Transport darf nie den Chat stören */ } };
  let history = store.get(HISTORY_KEY, []);
  const persist = () => store.set(HISTORY_KEY, history.slice(-MAX_HISTORY));

  function add(role, text, meta = {}) {
    const msg = { id: newId(), role, text, at: now().toISOString(), ...meta };
    history.push(msg);
    persist();
    emitEvent(makeMsgEvent(msg));
    return msg;
  }

  function ctx() {
    const persona = loadPersona(store);
    return {
      store, timers, device, registry: tools, fetchFn, timeZone,
      now: now(), name: persona.name, interactive: true
    };
  }

  /** Letztes Briefing der letzten 30 Minuten (für Nachfragen) oder null. */
  function recentBriefing() {
    const nowMs = now().getTime();
    for (let i = history.length - 1; i >= 0 && i >= history.length - 8; i--) {
      const m = history[i];
      if (m.role === 'assistant' && m.source === 'briefing' && m.facts) {
        return nowMs - Date.parse(m.at) <= FOLLOW_UP_MS ? m : null;
      }
    }
    return null;
  }

  /**
   * Morgen-Briefing (kind='morning') oder Abendzusammenfassung (kind='evening'):
   * Fakten parallel sammeln → KI (gestreamt, OHNE Werkzeuge) oder Vorlage.
   * auto=true: automatisch ausgelöst (fragt nie nach Erlaubnissen).
   */
  async function brief({ onDelta, signal, auto = false, replyTo = 'briefing', kind = 'morning' } = {}) {
    const evening = kind === 'evening';
    const settings = loadSettings(store);
    const cfg = normalizeBriefingConfig(settings.briefing, RESSORT_IDS);
    const c = { ...ctx(), interactive: !auto, signal };
    const nowMs = c.now.getTime();
    if (evening) saveBriefingState(store, { lastEveningDay: dayKey(nowMs, timeZone), lastEveningAt: nowMs });
    else saveBriefingState(store, { lastBriefingDay: dayKey(nowMs, timeZone), lastBriefingAt: nowMs });
    let seq = 0;
    let emitted = false;
    const relay = (d) => {
      if (d.type === 'text') emitted = true;
      if (d.type === 'text' || d.type === 'reset') {
        emitEvent(makeDeltaEvent({ replyTo, seq: seq++, text: d.type === 'text' ? d.text : undefined, reset: d.type === 'reset' }));
      }
      try { onDelta?.(d); } catch { /* UI-Fehler nicht durchreichen */ }
    };
    const facts = evening
      ? await gatherEveningFacts({
        registry: tools, ctx: c, cfg: normalizeEveningConfig(settings.evening), briefingCfg: cfg,
        history: history.filter((m) => m.source !== 'briefing'), firedTimers: loadBriefingState(store).firedTimers || []
      })
      : await gatherFacts({ registry: tools, ctx: c, cfg });
    const pcfg = resolveProvider(settings);
    let text = '';
    let source = 'briefing';
    if (pcfg.apiKey) {
      try {
        const msgs = evening ? buildEveningMessages({ name: c.name, facts }) : buildBriefingMessages({ name: c.name, facts });
        const out = await askAIStream(pcfg, msgs, {
          onDelta: relay, fetchFn, signal, timeoutMs: 25000, stream
        });
        text = String(out.data?.choices?.[0]?.message?.content || '').trim();
      } catch (e) {
        if (e?.code === 'aborted') throw e;
        text = '';
      }
    }
    if (!text) {
      if (emitted) relay({ type: 'reset' });
      text = evening ? templateEvening(facts, { name: c.name }) : templateBriefing(facts, { name: c.name });
      relay({ type: 'text', text });
      source = 'briefing';
    }
    emitEvent(makeDeltaEvent({ replyTo, seq: seq++, done: true }));
    return add('assistant', text, { source, kind: evening ? 'evening' : 'morning', facts, auto: Boolean(auto) });
  }

  return {
    getHistory: () => [...history],
    getRegistry: () => tools,
    getTransport: () => rt,
    clearHistory() { history = []; persist(); },
    add,
    brief,
    recentBriefing,
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
    async process(text, { onDelta, signal } = {}) {
      const input = String(text || '').trim();
      if (!input) return null;
      const userMsg = add('user', input);
      let seq = 0;
      const relay = (d) => {
        if (d.type === 'text' || d.type === 'reset') {
          emitEvent(makeDeltaEvent({ replyTo: userMsg.id, seq: seq++, text: d.type === 'text' ? d.text : undefined, reset: d.type === 'reset' }));
        }
        try { onDelta?.(d); } catch { /* UI-Fehler nicht durchreichen */ }
      };
      const c = ctx();

      // 0) Morgen-Briefing: Einstellungsbefehle und „Guten Morgen“ / „Was steht heute an?“
      const cmd = handleBriefingCommand(input, store);
      if (cmd) return add('assistant', cmd, { source: 'skill', settingsChanged: true });
      if (isBriefingRequest(input)) return brief({ onDelta, signal, auto: false, replyTo: userMsg.id });
      // 0b) Abendzusammenfassung: „Abendzusammenfassung aus/an“, „Wie war mein Tag?“
      const ecfg = normalizeEveningConfig(loadSettings(store).evening);
      const ecmd = eveningCommand(input, ecfg, (next) => saveSettings(store, { evening: normalizeEveningConfig(next) }));
      if (ecmd) return add('assistant', ecmd, { source: 'skill', settingsChanged: true });
      if (isEveningRequest(input)) return brief({ onDelta, signal, auto: false, replyTo: userMsg.id, kind: 'evening' });

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

      // 2b) Nach dem Angebot im Tagesrückblick reicht eine Uhrzeit („7 Uhr“, „halb sieben“) für den Wecker
      const recent = recentBriefing();
      const recentEvening = recent?.kind === 'evening';
      if (recentEvening && input.length <= 40 && /^(?:(?:ja|gerne?|bitte|okay|ok)[ ,]+)*(?:(?:den |einen )?wecker )?(?:um |auf |fuer |für |gegen )?[\wäöü:. ]+$/i.test(input) &&
          !/\b(?:minute|sekunde|stunde|timer)/i.test(input) && parseClockTime(input)) {
        const r = await tools.run('set_alarm', { time: input }, c);
        return add('assistant', r.message || 'Erledigt.', { source: 'tool', tool: 'set_alarm', unsupported: r.unsupported || undefined });
      }

      // 3) KI mit Tool-Schleife
      const cfg = resolveProvider(loadSettings(store));
      if (!cfg.apiKey && recent) {
        const fu = recentEvening ? eveningFollowUp(input, recent.facts) : localFollowUp(input, recent.facts);
        if (fu) return add('assistant', fu, { source: 'skill' });
      }
      if (!cfg.apiKey) {
        return add('assistant',
          'Das habe ich so nicht erkannt. Fragen Sie „Was kannst du?“, oder hinterlegen Sie in den Einstellungen einen API-Schlüssel für freiere Formulierungen.',
          { source: 'system' });
      }
      let system = buildSystemPrompt({
        name: c.name, now: c.now, notes: loadNotes(store), tools: tools.helpLines(), timeZone
      });
      let loopTools = tools;
      if (recent) {
        system += '\n' + (recentEvening ? eveningContext(recent.facts) : factsContext(recent.facts));
        loopTools = createToolRegistry(tools.list().filter((t) => FOLLOW_UP_TOOLS.has(t.name)));
      }
      const chat = history.filter((m) => m.role === 'user' || (m.role === 'assistant' && m.source !== 'system'));
      try {
        const out = await runToolLoop({
          cfg, systemPrompt: system, history: chat, registry: loopTools, ctx: { ...c, registry: loopTools }, fetchFn,
          onDelta: relay, stream, signal
        });
        emitEvent(makeDeltaEvent({ replyTo: userMsg.id, seq: seq++, done: true }));
        const meta = { source: 'ai', toolResults: out.toolResults };
        if (out.confirm) meta.confirm = out.confirm;
        return add('assistant', out.text || 'Fertig.', meta);
      } catch (e) {
        return add('assistant', `Verzeihung, da ging etwas schief. ${e.message}`, { source: 'system', error: true });
      }
    }
  };
}
