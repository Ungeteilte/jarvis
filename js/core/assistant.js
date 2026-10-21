// Der "Kopf": lokale Skills → lokale Tool-Trigger → KI mit Tool-Schleife.
// Komplett browser-frei – UI und Sprachausgabe hängen sich nur an.

import { handleSkill, loadNotes, parseClockTime, parseAlarmTime } from './skills.js';
import { buildSystemPrompt } from './prompt.js';
import { handleMemoryCommand } from './memory-commands.js';
import { loadMemory, addMemory, removeMemory, clearMemory } from './memory.js';
import { voiceAnswer, CONFIRM_TTL_MS } from './confirm-voice.js';
import { pickChoice } from './app-match.js';
import { buildExport } from './files.js';
import { parseWhen } from './reminders.js';
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
// Zusätzlich gilt seit v0.9 überall die zentrale Regel aus tools/risk.js (Taint → Karte).
export const FOLLOW_UP_TOOLS = new Set([
  'call_phone', 'send_sms', 'send_whatsapp', 'send_email', 'navigate', 'open_youtube', 'open_spotify',
  'open_website', 'search_web', 'get_location', 'get_battery', 'list_notes', 'list_memory', 'list_capabilities',
  'get_weather', 'get_news', 'get_calendar_events',
  // Wecker/Erinnerung: kommt der Aufruf von der KI, während fremde Texte im Kontext stehen,
  // zeigt die zentrale Regel (risk 'schreiben') vorher eine Karte mit Herkunftshinweis
  'set_alarm', 'set_reminder',
  // v0.9: nur lesend bzw. immer mit eigener Karte
  'list_reminders'
]);

export function createAssistant({ store, timers, device, fetchFn, now = () => new Date(), registry, transport, stream = true, timeZone } = {}) {
  const tools = registry || createDefaultRegistry();
  // Live-Ereignisse (msg/delta) – lokal No-op, später WebSocket (Option B)
  const rt = transport || createLocalTransport();
  const emitEvent = (ev) => { try { rt.send(ev); } catch { /* Transport darf nie den Chat stören */ } };
  let history = store.get(HISTORY_KEY, []);
  const persist = () => store.set(HISTORY_KEY, history.slice(-MAX_HISTORY));
  // Offene Ja/Nein-Karte (für gesprochenes „Ja“/„Nein“) und zuletzt Gemerktes (für „Vergiss das“)
  let pending = null;
  let lastAdded = null;
  // „Stell mir einen Wecker“ ohne Uhrzeit → Jarvis fragt nach; die nächste Antwort („7 Uhr“) stellt ihn
  let pendingAlarm = null;
  // „Erinnere mich an die Milch“ ohne Zeit → Jarvis fragt „Wann …?“; die nächste Antwort („morgen um 9“) plant sie
  let pendingReminder = null;
  const askedForAlarmTime = (results) => {
    if ((results || []).some((t) => t.name === 'set_alarm' && t.result?.needsTime)) pendingAlarm = { at: now().getTime() };
    const rem = (results || []).find((t) => t.name === 'set_reminder' && t.result?.needsTime && t.result.reminderText);
    if (rem) pendingReminder = { text: rem.result.reminderText, at: now().getTime() };
  };

  function add(role, text, meta = {}) {
    const msg = { id: newId(), role, text, at: now().toISOString(), ...meta };
    history.push(msg);
    persist();
    emitEvent(makeMsgEvent(msg));
    if (role === 'assistant' && meta.confirm?.action) pending = { action: meta.confirm.action, msgId: msg.id, at: now().getTime() };
    // Auswahlkarte (v0.9: mehrere passende Apps) – gesprochen „die erste“ oder der Name
    else if (role === 'assistant' && Array.isArray(meta.confirm?.choices)) pending = { choices: meta.confirm.choices, msgId: msg.id, at: now().getTime() };
    return msg;
  }

  /** Hatten die letzten Antworten fremde Daten (Nachrichten/Termine/Wetter)? */
  function recentExternal() {
    let seen = 0;
    for (let i = history.length - 1; i >= 0 && seen < 2; i--) {
      const m = history[i];
      if (m.role !== 'assistant') continue;
      seen++;
      if ((m.toolResults || []).some((t) => tools.get(t.name)?.externalData)) return true;
      if (m.source === 'briefing') return true;
    }
    return false;
  }

  async function runAction(action) {
    pending = null;
    switch (action?.type) {
      case 'openUrl': {
        if (!device?.openUrl) {
          return add('assistant', 'Verzeihung, das Öffnen von Apps ist hier nicht möglich.', { source: 'system' });
        }
        const r = device.openUrl(action.url);
        if (r?.ok) return add('assistant', 'Sehr wohl, ich öffne das für Sie.', { source: 'tool' });
        return add('assistant', r?.message || 'Das hat leider nicht geklappt.', { source: 'system', error: true });
      }
      case 'rememberFact': {
        const r = addMemory(store, action.text, { kategorie: action.kategorie, quelle: 'ki-vorschlag', now: now() });
        if (r.ok && !r.duplicate) lastAdded = { id: r.item.id, at: now().getTime() };
        return add('assistant', r.ok ? (r.duplicate ? r.message : `Gemerkt: ${r.item.text}.`) : r.message,
          { source: 'skill', memoryChanged: r.ok || undefined });
      }
      case 'forgetMemory': {
        const gone = removeMemory(store, action.id);
        return add('assistant', gone ? `Erledigt, vergessen: ${gone.text}.` : 'Diesen Eintrag gibt es nicht mehr.', { source: 'skill', memoryChanged: true });
      }
      case 'clearMemory': {
        const n = clearMemory(store);
        lastAdded = null;
        return add('assistant', `Erledigt. ${n === 1 ? 'Ein Eintrag ist' : n + ' Einträge sind'} gelöscht. Notizen bleiben erhalten.`, { source: 'skill', memoryChanged: true });
      }
      case 'runTool': {
        // Zentrale Karte (v0.9 W0): genau den bestätigten Aufruf ausführen – confirmed überspringt die Regel einmalig
        const tool = tools.get(action.name);
        if (!tool) return add('assistant', 'Dieses Werkzeug gibt es nicht mehr.', { source: 'system' });
        const r = await tools.run(action.name, action.args || {}, { ...ctx(), confirmed: true });
        const meta = { source: 'tool', tool: action.name };
        if (r?.needsConfirm && r.confirm) meta.confirm = r.confirm;
        if (r?.unsupported) meta.unsupported = true;
        if (r && r.ok === false && !r.needsTime && !r.unsupported) meta.error = true;
        return add('assistant', r?.message || (r?.ok ? 'Erledigt.' : 'Das hat leider nicht geklappt.'), meta);
      }
      case 'exportFile': {
        // Nach „Ja“: Inhalt frisch bauen, dann System-Dialog „Speichern unter“ (Browser: Download)
        if (!device?.saveTextFile) return add('assistant', 'Dateien speichern geht hier leider nicht.', { source: 'system', unsupported: true });
        const ex = buildExport(store, action.was, action.format, { now: now(), history });
        if (!ex.ok) return add('assistant', ex.message, { source: 'tool', tool: 'export_file' });
        const r = await device.saveTextFile({ name: ex.name, mime: ex.mime, text: ex.text });
        const msg = r?.ok ? (r.message || `Gespeichert: ${ex.what} in „${r.name || ex.name}“.`) : (r?.cancelled ? 'Speichern abgebrochen.' : (r?.message || 'Speichern hat nicht geklappt.'));
        return add('assistant', msg, { source: 'tool', tool: 'export_file', error: r?.ok || r?.cancelled ? undefined : true });
      }
      case 'launchApp': {
        // App aus der Karte starten – nativ nur Pakete aus der Launcher-Liste (LaunchPolicy)
        if (!device?.launchApp) return add('assistant', 'Apps öffnen geht nur in der Android-App.', { source: 'system', unsupported: true });
        const r = await device.launchApp(String(action.package || ''), String(action.label || ''));
        return add('assistant', r?.message || (r?.ok ? 'Erledigt.' : 'Das hat leider nicht geklappt.'), { source: 'tool', tool: 'open_app', error: r?.ok ? undefined : true });
      }
      case 'setAlarm': { // Karten aus v0.8 (vor der zentralen Regel) bleiben bedienbar
        const r = await tools.run('set_alarm', { time: `${action.hour}:${String(action.minute).padStart(2, '0')}`, label: action.label }, ctx());
        return add('assistant', r.message, { source: 'tool', tool: 'set_alarm', error: r.ok === false && !r.unsupported ? true : undefined, unsupported: r.unsupported || undefined });
      }
      default:
        return add('assistant', 'Diese Aktion kann ich leider nicht ausführen.', { source: 'system' });
    }
  }

  function ctx() {
    const persona = loadPersona(store);
    return {
      store, timers, device, registry: tools, fetchFn, timeZone,
      getHistory: () => [...history], // für export_file/share_file („Chat als Datei“)
      now: now(), name: persona.name, interactive: true,
      // turn.external wird true, sobald ein Werkzeug fremde Daten liefert (registry.run); sources = Herkunft für Karten
      turn: (() => { const ext = recentExternal(); return { external: ext, sources: new Set(ext ? ['vorherigen Antworten (Nachrichten, Wetter, Termine)'] : []) }; })()
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
      return runAction(action);
    },
    cancelAction() {
      pending = null;
      return add('assistant', 'Alles klar, ich breche ab.', { source: 'system' });
    },
    /** Offene Karte (für Tests/UI). */
    pendingConfirm: () => (pending ? { ...pending } : null),
    /** Verarbeitet eine Nutzereingabe und gibt die Antwort-Nachricht zurück. */
    async process(text, { onDelta, signal } = {}) {
      const input = String(text || '').trim();
      if (!input) return null;
      const userMsg = add('user', input);
      // Offene Karte: kurzes gesprochenes „Ja“/„Nein“ bestätigt bzw. bricht ab; alles andere verwirft die Karte.
      if (pending) {
        const p = pending;
        const fresh = now().getTime() - p.at <= CONFIRM_TTL_MS;
        const ans = fresh ? voiceAnswer(input) : null;
        pending = null;
        if (p.choices) {
          const i = fresh ? pickChoice(input, p.choices) : -1;
          if (i >= 0) {
            const r = await runAction(p.choices[i].action);
            r.confirmResolved = p.msgId;
            return r;
          }
          if (ans === 'no') return add('assistant', 'Alles klar, ich breche ab.', { source: 'system', confirmResolved: p.msgId });
        } else if (ans === 'yes') {
          const r = await runAction(p.action);
          r.confirmResolved = p.msgId;
          return r;
        }
        if (ans === 'no') {
          const r = add('assistant', 'Alles klar, ich breche ab.', { source: 'system', confirmResolved: p.msgId });
          return r;
        }
      }
      let seq = 0;
      const relay = (d) => {
        if (d.type === 'text' || d.type === 'reset') {
          emitEvent(makeDeltaEvent({ replyTo: userMsg.id, seq: seq++, text: d.type === 'text' ? d.text : undefined, reset: d.type === 'reset' }));
        }
        try { onDelta?.(d); } catch { /* UI-Fehler nicht durchreichen */ }
      };
      const c = ctx();

      // Antwort auf „Für wie viel Uhr soll ich den Wecker stellen?“ (2 Minuten gültig)
      if (pendingAlarm) {
        const fresh = now().getTime() - pendingAlarm.at <= CONFIRM_TTL_MS;
        pendingAlarm = null;
        if (fresh && (voiceAnswer(input) === 'no' || /^(?:doch nicht|kein wecker|vergiss es)\b/i.test(input))) {
          return add('assistant', 'Alles klar, kein Wecker.', { source: 'system' });
        }
        if (fresh && input.length <= 40 && parseAlarmTime(input)) {
          const r = await tools.run('set_alarm', { time: input }, c);
          if (r.needsTime) pendingAlarm = { at: now().getTime() };
          return add('assistant', r.message, { source: 'tool', tool: 'set_alarm', error: r.ok === false && !r.unsupported && !r.needsTime ? true : undefined, unsupported: r.unsupported || undefined });
        }
      }

      // Antwort auf „Wann soll ich Sie an … erinnern?“ (2 Minuten gültig)
      if (pendingReminder) {
        const p = pendingReminder;
        pendingReminder = null;
        if (now().getTime() - p.at <= CONFIRM_TTL_MS) {
          if (voiceAnswer(input) === 'no' || /^(?:doch nicht|keine erinnerung|vergiss es)\b/i.test(input)) {
            return add('assistant', 'Alles klar, keine Erinnerung.', { source: 'system' });
          }
          if (input.length <= 60 && parseWhen(input, now())) {
            const r = await tools.run('set_reminder', { text: p.text, zeit: input }, c);
            askedForAlarmTime([{ name: 'set_reminder', result: r }]);
            const meta = { source: 'tool', tool: 'set_reminder' };
            if (r.needsConfirm && r.confirm) meta.confirm = r.confirm;
            return add('assistant', r.message, meta);
          }
        }
      }

      // 0) Morgen-Briefing: Einstellungsbefehle und „Guten Morgen“ / „Was steht heute an?“
      const cmd = handleBriefingCommand(input, store);
      if (cmd) return add('assistant', cmd, { source: 'skill', settingsChanged: true });
      if (isBriefingRequest(input)) return brief({ onDelta, signal, auto: false, replyTo: userMsg.id });
      // 0b) Abendzusammenfassung: „Abendzusammenfassung aus/an“, „Wie war mein Tag?“
      const ecfg = normalizeEveningConfig(loadSettings(store).evening);
      const ecmd = eveningCommand(input, ecfg, (next) => saveSettings(store, { evening: normalizeEveningConfig(next) }));
      if (ecmd) return add('assistant', ecmd, { source: 'skill', settingsChanged: true });
      if (isEveningRequest(input)) return brief({ onDelta, signal, auto: false, replyTo: userMsg.id, kind: 'evening' });

      // 0c) Gedächtnis und Vorlieben („Merk dir …“, „Vergiss, dass …“, „Was weißt du über mich?“, „Antworte kürzer“)
      const mc = handleMemoryCommand(input, { store, now: now(), lastAdded });
      if (mc) {
        if (mc.added) lastAdded = { id: mc.added.id, at: now().getTime() };
        if (mc.undone) lastAdded = null;
        const meta = { source: 'skill' };
        if (mc.confirm) meta.confirm = mc.confirm;
        if (mc.settingsChanged) meta.settingsChanged = true;
        if (mc.memoryChanged) meta.memoryChanged = true;
        return add('assistant', mc.text, meta);
      }

      // 1) Klassische Skills (Uhrzeit, Datum, Timer, Notizen, Name)
      const local = handleSkill(input, c);
      if (local) return add('assistant', local, { source: 'skill' });

      // 2) Schnelle Tool-Trigger ohne KI
      const hit = await tryLocalTool(input, tools, c);
      if (hit) {
        const meta = { source: 'tool', tool: hit.name };
        if (hit.result?.needsConfirm && hit.result.confirm) meta.confirm = hit.result.confirm;
        if (hit.result?.unsupported) meta.unsupported = true;
        if (hit.result && hit.result.ok === false && !hit.result.needsConfirm && !hit.result.needsTime) meta.error = !hit.result.unsupported;
        askedForAlarmTime([{ name: hit.name, result: hit.result }]);
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
      const st = loadSettings(store);
      let system = buildSystemPrompt({
        name: c.name, now: c.now, notes: loadNotes(store), tools: tools.helpLines(), timeZone,
        prefs: st.prefs, memory: st.memoryToAI ? loadMemory(store).items : [], query: input
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
        askedForAlarmTime(out.toolResults);
        if (out.confirm) meta.confirm = out.confirm;
        return add('assistant', out.text || 'Fertig.', meta);
      } catch (e) {
        return add('assistant', `Verzeihung, da ging etwas schief. ${e.message}`, { source: 'system', error: true });
      }
    }
  };
}
