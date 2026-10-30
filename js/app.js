// Einstiegspunkt: verbindet Kern (js/core), Browser-Adapter (js/adapters)
// und Oberfläche (js/ui). Für eine native App werden später nur die
// Adapter und die UI ersetzt – der Kern bleibt gleich.
import { createStore } from './core/storage.js';
import { loadSettings, saveSettings, PROVIDERS } from './core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName, effectiveRate } from './core/persona.js';
import { createFollowUp, shouldFollowUp, normalizeFollowUpConfig, FOLLOW_UP_TIMING } from './core/follow-up.js';
import { createWakeMatcher, isBareWake } from './core/wakeword.js';
import { createTimerManager } from './core/timers.js';
import { createAssistant } from './core/assistant.js';
import { createWakeController } from './core/wake-controller.js';
import { formatDuration, loadNotes } from './core/skills.js';
import { dueReminders, markDone, formatWhen } from './core/reminders.js';
import { decideListen, parseListenUrl } from './core/listen-launch.js';
import { createSentenceChunker } from './core/sentences.js';
import { createWebStorageAdapter } from './adapters/web-storage.js';
import { createWebTTS } from './adapters/web-tts.js';
import { createWebSTT } from './adapters/web-stt.js';
import { beep, vibrate } from './adapters/web-audio.js';
import { createWebDevice } from './adapters/web-device.js';
import { waitForBoot, adapterKind } from './core/boot.js';
import {
  shouldBrief, recordActivity, mergeNativeState, loadBriefingState, saveBriefingState, dayKey, localParts, NIGHT_LOCK_HOUR, DAY_START_HOUR,
  shouldEvening, recordTimerFired, todayStats, shouldWeekly, weeklyReplacesEvening, weekStats, upcomingReminders
} from './core/briefing/index.js';
import { loadMemory } from './core/memory.js';
import { loadReminders } from './core/reminders.js';

// Native Capacitor-App setzt window.__JARVIS_ADAPTERS__ im Bootstrap – erst darauf warten
// (höchstens 3 s, dann Web-Adapter), sonst gewinnt dieses Modul das Rennen.
await waitForBoot(globalThis);
const _A = globalThis.__JARVIS_ADAPTERS__;
import * as view from './ui/view.js';
import { applyAndRemember } from './ui/appearance.js';
import { createSettingsView } from './ui/settings-view.js';

const { $ } = view;

// ---------- Dienste ----------
const store = createStore(_A?.storage ? _A.storage() : createWebStorageAdapter());
const tts = _A?.tts ? _A.tts() : createWebTTS();
// getMuteBeep: Android – Startton der Erkennung beim Wake-Word kurz stummschalten (Einstellung)
const stt = _A?.stt ? _A.stt({ lang: 'de-DE', getMuteBeep: () => settings.wakeMuteBeep !== false }) : createWebSTT({ lang: 'de-DE' });
const device = _A?.device ? _A.device() : createWebDevice();
console.info(`[Jarvis] Adapter: ${adapterKind(_A)}`);
let settings = loadSettings(store);
try { applyAndRemember(settings.appearance); } catch (e) { console.warn('[Jarvis] Design:', e); }
let persona = loadPersona(store);
let busy = false;

const timers = createTimerManager({
  store,
  onDone: (t) => {
    beep({ freq: 988, times: 4 });
    try { saveBriefingState(store, recordTimerFired(loadBriefingState(store), t.label, Date.now())); } catch { /* nur Statistik */ }
    vibrate([300, 150, 300, 150, 600]);
    const msg = assistant.add('assistant', `Verzeihung, dass ich störe: Ihr Timer über ${t.label} ist abgelaufen.`, { source: 'system' });
    view.addMessage(msg);
    say(msg.text);
  }
});
const assistant = createAssistant({ store, timers, device });

const wake = createWakeController({
  stt,
  getName: () => persona.name,
  onWake: () => {
    beep({ freq: 1320, duration: 0.08 });
    view.setOrbState('listening');
    view.setStatus('Ja, bitte?');
  },
  onCommand: (text) => handleInput(text, { voice: true }),
  onState: (s) => {
    if (s === 'followup-end') { followUpUi(false); return; }
    if (busy) return;
    if (s === 'followup') { followUpUi(true); return; }
    if (s === 'standby') { view.setOrbState('standby'); view.setStatus(`Sagen Sie „Hey ${persona.name}“ …`); }
    if (s === 'awaiting') { view.setOrbState('listening'); view.setStatus('Ja, bitte?'); }
    if (s === 'stopped' && !wake.enabled) { view.setOrbState('idle'); view.setStatus('Bereit.'); }
  },
  onError: (e) => {
    setWake(false);
    showError(e.message);
  }
});

// Liest der Android-Hintergrunddienst gerade vor, darf das Wake-Word nicht mithören.
let bgSpeechTimer = null;
device.onBackgroundSpeech?.((speaking) => {
  clearTimeout(bgSpeechTimer);
  if (speaking) {
    wake.pause('bg-tts');
    bgSpeechTimer = setTimeout(() => wake.resume('bg-tts'), 100000); // Sicherheitsnetz (max. Vorlesedauer 90 s)
  } else wake.resume('bg-tts', { delayMs: 800 });
});

// ---------- Kernabläufe ----------
function idle() {
  busy = false;
  view.setMicActive(false);
  if (wake.enabled) {
    view.setOrbState('standby');
    view.setStatus(`Sagen Sie „Hey ${persona.name}“ …`);
  } else {
    view.setOrbState('idle');
    view.setStatus('Bereit.');
  }
}

function showError(text) {
  view.setOrbState('error');
  view.setStatus(text);
  setTimeout(() => { if (!busy) idle(); }, 4000);
}

// Jede Sprachausgabe läuft hier durch: Wake-Word ist pausiert, solange IRGENDEINE Ausgabe läuft,
// und hört erst kurz danach wieder zu (sonst hört Jarvis den Nachhall der eigenen Stimme).
const WAKE_RESUME_AFTER_TTS_MS = 700;
let ttsActive = 0;
async function speakTts(text, p = persona) {
  stopFollowUp('tts'); // neue Ausgabe → Nachfrage-Fenster schließen (Jarvis hört sich nie selbst)
  ttsActive++;
  wake.pause('tts');
  try {
    await tts.speak(text, { ...p, rate: effectiveRate(p?.rate) });
  } finally {
    ttsActive = Math.max(0, ttsActive - 1);
    if (!ttsActive) wake.resume('tts', { delayMs: WAKE_RESUME_AFTER_TTS_MS });
  }
}

/** Spricht einen Text (falls Sprachausgabe an ist). Wake-Word pausiert solange. */
async function say(text) {
  if (!settings.speak || !tts.isSupported()) return;
  view.setOrbState('speaking');
  await speakTts(text);
}

/**
 * Satzweise Sprachausgabe für gestreamte Antworten: fertige Sätze werden
 * nacheinander gesprochen, während der Rest noch ankommt (Web + nativ).
 */
function createSentenceSpeaker(myTurn) {
  const chunker = createSentenceChunker();
  let chain = Promise.resolve();
  let spoken = '';
  let cancelled = false;
  let started = false;
  const enqueue = (sentences) => {
    for (const s of sentences) {
      spoken += (spoken ? ' ' : '') + s;
      chain = chain.then(async () => {
        if (cancelled || myTurn !== turn || !settings.speak || !tts.isSupported()) return;
        started = true;
        view.setOrbState('speaking');
        try { await speakTts(s); } catch { /* nächster Satz */ }
      });
    }
  };
  return {
    push(text) { if (!cancelled) enqueue(chunker.push(text)); },
    reset() { chunker.reset(); cancelled = true; tts.cancel(); },
    get spoken() { return spoken; },
    get cancelled() { return cancelled; },
    async finish() {
      if (!cancelled) enqueue(chunker.flush());
      await chain;
    }
  };
}

const openCards = new Map(); // Antwort-ID → offene Ja/Nein-Karte (für gesprochenes Ja/Nein)
let turn = 0; // zählt Eingaben, damit eine alte Sprachausgabe keine neue stört
async function handleInput(text, { voice = false } = {}) {
  const input = String(text || '').trim();
  if (!input || busy) return;
  stopFollowUp('input');
  touchActivity();
  view.addMessage({ role: 'user', text: input });
  const reply = await runTurn((onDelta) => assistant.process(input, { onDelta }));
  if (reply?.settingsChanged || reply?.source === 'briefing') { settings = loadSettings(store); syncNative(); }
  maybeFollowUp(reply, voice);
}

// ---------- v0.9.6 Nachfrage-Modus ----------
// Nach einer per Sprache gestellten Frage und vorgelesener Antwort hört Jarvis kurz weiter zu.
// Mit Wake-Word: dieselbe (ohnehin laufende) Erkennung, nur das Befehlsfenster wird geöffnet.
// Ohne Wake-Word: wenige kurze Einzel-Erkennungen (FOLLOW_UP_TIMING), Ende bei Stille.
// Start erst NACH dem Ende der Sprachausgabe, nie im Hintergrund.
let followUpTimer = null;
const followUp = createFollowUp({
  listen: ({ onInterim }) => stt.listenOnce({ onInterim, muteBeep: settings.wakeMuteBeep !== false }),
  abort: () => stt.abort(),
  matchWake: (t) => { const m = createWakeMatcher(persona.name)(t); return { ...m, bare: isBareWake(m) }; },
  onState: (s, info) => {
    if (s === 'waiting') followUpUi(true);
    else if (s === 'hearing') { view.setOrbState('listening'); view.setStatus(`„${info?.text || ''}“`); }
    else if (s === 'ended') {
      listening = false;
      followUpUi(false);
      wake.resume('followup', { delayMs: 300 });
    }
  },
  onText: (t) => { handleInput(t, { voice: true }); }
});

function followUpUi(on) {
  if (busy) return;
  if (on) {
    view.setOrbState('followup');
    view.setStatus('Ich höre noch zu … einfach weitersprechen.');
    document.body.dataset.followup = '1';
  } else {
    delete document.body.dataset.followup;
    if (!listening && !ttsActive) idle();
  }
}

function followUpActive() { return followUp.active || wake.followUp || Boolean(followUpTimer); }

function stopFollowUp(reason = 'stopped') {
  const had = followUpActive();
  if (followUpTimer) { clearTimeout(followUpTimer); followUpTimer = null; }
  wake.cancelFollowUp();
  followUp.stop(reason);
  if (had) delete document.body.dataset.followup;
  return had;
}

function maybeFollowUp(reply, viaVoice) {
  const spoken = Boolean(settings.speak && tts.isSupported());
  if (!shouldFollowUp({ cfg: settings.followUp, viaVoice, spoken, hidden: document.hidden, reply, sttSupported: stt.isSupported() })) return;
  if (busy || listening || ttsActive) return;
  const myTurn = turn;
  const windowMs = normalizeFollowUpConfig(settings.followUp).windowSec * 1000;
  if (wake.enabled) {
    // Fenster zählt ab dem Wiederanlaufen der Erkennung (nach der Nachhall-Pause)
    wake.armFollowUp(windowMs + WAKE_RESUME_AFTER_TTS_MS);
    if (wake.listening) followUpUi(true);
    return;
  }
  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    if (myTurn !== turn || busy || listening || ttsActive || document.hidden) return;
    wake.pause('followup');
    listening = true;
    followUp.start(windowMs);
  }, FOLLOW_UP_TIMING.startDelayMs);
}

/**
 * Ein Antwort-Durchlauf (Nutzereingabe oder Briefing): Streaming-Blase, satzweise
 * Sprachausgabe, Bestätigungskarten. exec(onDelta) → Antwort-Nachricht.
 */
async function runTurn(exec, { status = 'Einen Moment …' } = {}) {
  if (busy) return null;
  const myTurn = ++turn;
  busy = true;
  wake.pause('turn');
  tts.cancel();
  view.setOrbState('thinking');
  view.setStatus(status);
  let hideTyping = view.showTyping();
  let reply = null;
  let bubble = null;   // wachsende Blase (nur bei Streaming)
  let speaker = null;  // satzweise Sprachausgabe
  let streamedText = '';
  const onDelta = (d) => {
    if (myTurn !== turn) return;
    if (d.type === 'text') {
      if (!bubble) {
        hideTyping(); hideTyping = () => {};
        bubble = view.addStreamingMessage();
        speaker = createSentenceSpeaker(myTurn);
        view.setStatus('');
      }
      bubble.append(d.text);
      streamedText += d.text;
      speaker.push(d.text);
    } else if (d.type === 'reset') {
      streamedText = '';
      bubble?.reset();
      speaker?.reset();
      speaker = null; bubble?.remove(); bubble = null;
    } else if (d.type === 'tool') {
      view.setStatus(`Werkzeug: ${d.name} …`);
    }
  };
  try {
    reply = await exec(onDelta);
  } catch (e) {
    showError(e.message);
  } finally {
    hideTyping();
    busy = false; // neue Eingaben sind ab jetzt wieder möglich (unterbrechen die Sprachausgabe)
  }
  if (reply && bubble && !reply.confirm && streamedText.trim() === String(reply.text).trim()) {
    // Live gestreamt: Blase abschließen, restliche Sätze sprechen
    bubble.finish(reply);
    view.setStatus(reply.error ? 'Es gab ein Problem.' : '');
    await speaker.finish();
  } else if (reply) {
    if (bubble) { speaker?.reset(); bubble.remove(); }
    view.addMessage(reply);
    if (reply.confirmResolved) { openCards.get(reply.confirmResolved)?.closeCard?.(); openCards.delete(reply.confirmResolved); }
    if (reply.memoryChanged && !$('#view-settings').classList.contains('hidden')) settingsView.refreshMemory();
    if (reply.confirm) attachCard(reply);
    view.setStatus(reply.error ? 'Es gab ein Problem.' : '');
    await say(reply.text);
  }
  if (myTurn === turn && !busy) { wake.resume('turn', { delayMs: WAKE_RESUME_AFTER_TTS_MS }); idle(); }
  return reply;
}

/**
 * Ja/Nein- bzw. Auswahlkarte zu einer Antwort anzeigen. Das Ergebnis eines „Ja“ kann selbst wieder
 * eine Karte tragen (z. B. App-Auswahl nach der zentralen Karte) – dann folgt die nächste Karte.
 */
function attachCard(reply) {
  const cardId = reply.id;
  const after = async (r) => {
    if (!r) return;
    view.addMessage(r);
    if (r.confirm) attachCard(r);
    await say(r.text);
  };
  openCards.set(cardId, view.addConfirmCard(reply.confirm, {
    onYes: async () => {
      openCards.delete(cardId);
      await after(await assistant.confirmAction(reply.confirm.action));
    },
    onChoose: async (i) => {
      openCards.delete(cardId);
      const c = reply.confirm.choices?.[i];
      if (c) await after(await assistant.confirmAction(c.action));
    },
    onNo: async () => {
      openCards.delete(cardId);
      await after(assistant.cancelAction());
    }
  }));
}

/** Fällige Erinnerungen melden (Browser) bzw. still abhaken (Android hat sie schon gezeigt). */
function checkReminders() {
  const due = dueReminders(store, new Date());
  if (!due.length) return;
  markDone(store, due.map((r) => r.id));
  if (device.reminders) return;
  for (const r of due) {
    const late = Date.now() - Date.parse(r.at) > 2 * 60000;
    beep({ freq: 880, times: 3 });
    vibrate([300, 150, 300]);
    const text = late ? `Verpasste Erinnerung (${formatWhen(new Date(r.at))}): ${r.text}` : `Erinnerung: ${r.text}`;
    const msg = assistant.add('assistant', text, { source: 'system', reminder: true });
    view.addMessage(msg);
    say(msg.text);
  }
}

// ---------- Morgen-Briefing ----------
const nativeBriefing = device.briefing || null; // nur Android-App
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
let briefingChecking = false;

/** Aktivität merken (Öffnen, Eingabe, Herzschlag alle 60 s bei sichtbarer App). */
function touchActivity() {
  saveBriefingState(store, recordActivity(loadBriefingState(store), Date.now()));
}

/** Konfiguration + Zustand an den nativen Hintergrund-Teil geben (Android). */
function syncNative() {
  if (!nativeBriefing) return null;
  const st = loadBriefingState(store);
  // Für den Tagesrückblick im Hintergrund nur Zahlen und feste Themen-Etiketten – keine Texte
  const stats = todayStats({ history: assistant.getHistory(), notes: loadNotes(store), firedTimers: st.firedTimers || [], nowMs: Date.now() });
  // Wochenrückblick im Hintergrund: ebenfalls nur Zahlen und Etiketten (keine Notiz-/Gedächtnis-Texte)
  const wk = weekStats({
    history: assistant.getHistory().filter((m) => m.source !== 'briefing'), notes: loadNotes(store), memory: loadMemory(store).items,
    reminders: loadReminders(store), firedTimers: st.firedTimers || [], nowMs: Date.now(), memoryTexts: false
  });
  return nativeBriefing.sync({
    config: settings.briefing,
    evening: settings.evening,
    weekly: settings.weekly,
    events: settings.eventReminders, // v0.9.4: Termin-Hinweise (nativer Kalender-Scan + Alarm)
    lastWeeklyDay: st.lastWeeklyDay || '',
    week: {
      day: stats.day, chats: wk.chats, activeDays: wk.activeDays, topics: wk.topics, notes: wk.notes, memories: wk.memories,
      remindersDone: wk.remindersDone, timers: wk.timers, nextReminders: upcomingReminders(loadReminders(store), Date.now()).length
    },
    lastActiveAt: st.lastActiveAt || 0,
    lastBriefingDay: st.lastBriefingDay || '',
    lastEveningDay: st.lastEveningDay || '',
    today: { day: stats.day, chats: stats.chats, topics: stats.topics, notes: stats.notes, timers: stats.timers },
    coords: st.coords || null,
    tz: deviceTz(),
    name: persona.name,
    onboarded: Boolean(persona.onboarded),
    voice: { voiceId: persona.voiceId || '', rate: effectiveRate(persona.rate), pitch: persona.pitch }
  });
}

/** Tages-Anspruch sichern (mehrere Tabs: Web-Locks; sonst einfache Prüfung). */
async function claimBriefingDay(day, kind = 'morning') {
  const key = kind === 'weekly' ? 'lastWeeklyDay' : kind === 'evening' ? 'lastEveningDay' : 'lastBriefingDay';
  const claim = () => {
    if (loadBriefingState(store)[key] === day) return false;
    saveBriefingState(store, { [key]: day });
    return true;
  };
  if (globalThis.navigator?.locks?.request) {
    try { return await navigator.locks.request(`jarvis-${kind}`, { ifAvailable: true }, (lock) => (lock ? claim() : false)); } catch { /* weiter */ }
  }
  return claim();
}

/** Briefing starten – im Browser ohne vorherige Geste erst per Tipp-Karte (Autoplay-Sperre). */
const DEFAULT_CARDS = {
  morning: { id: 'briefing-card', title: '☀️ Guten Morgen – Ihr Briefing ist bereit', detail: 'Tippen zum Starten (Wetter, Termine, Nachrichten).', button: '▶ Briefing starten' },
  evening: { id: 'evening-card', title: '🌙 Guten Abend – Ihr Tagesrückblick ist bereit', detail: 'Tippen zum Starten (Ihr Tag, Ausblick auf morgen).', button: '▶ Rückblick starten' },
  weekly: { id: 'weekly-card', title: '🗓️ Ihr Wochenrückblick ist bereit', detail: 'Tippen zum Starten (Höhepunkte der Woche, Ausblick auf die neue Woche).', button: '▶ Wochenrückblick starten' }
};

function startBriefing({ auto = true, card = null, kind = 'morning' } = {}) {
  const k = kind === 'weekly' || kind === 'evening' ? kind : 'morning';
  const STATUS = { weekly: 'Ich stelle Ihren Wochenrückblick zusammen …', evening: 'Ich stelle Ihren Tagesrückblick zusammen …', morning: 'Ich stelle Ihr Briefing zusammen …' };
  const run = () => runTurn((onDelta) => assistant.brief({ onDelta, auto, kind: k }), { status: STATUS[k] })
    .then(() => syncNative());
  const needsGesture = !globalThis.__JARVIS_NATIVE__ && settings.speak && tts.isSupported()
    && globalThis.navigator?.userActivation && !navigator.userActivation.hasBeenActive;
  if (card || needsGesture) {
    view.addStartCard(card || DEFAULT_CARDS[k], run);
    return;
  }
  run();
}

const inAutoWindow = (nowMs, cfg) => {
  const h = localParts(nowMs).h;
  return h >= DAY_START_HOUR && h < NIGHT_LOCK_HOUR && h < cfg.latestHour;
};

/** Prüft beim Öffnen/Zurückkehren, ob jetzt das Morgen-Briefing (oder abends der Tagesrückblick) fällig ist. Danach Aktivität merken. */
async function maybeAutoBriefing() {
  if (briefingChecking) return;
  briefingChecking = true;
  try {
    settings = loadSettings(store);
    const cfg = settings.briefing;
    if ((!cfg.enabled && !settings.evening.enabled && !settings.weekly.enabled) || !persona.onboarded || busy) return;
    // „Jarvis fragen“ hat Vorrang: wer gerade fragen will, bekommt kein Briefing dazwischen (kommt beim nächsten Öffnen)
    if (listening || followUpActive() || Date.now() - listenRequestedAt < 5000) return;
    const nowMs = Date.now();
    const today = dayKey(nowMs);
    if (nativeBriefing) {
      // Aus der Benachrichtigung geöffnet? Dann gilt das (einmalig abgeholt – kein doppeltes Briefing)
      const launch = await nativeBriefing.consumeLaunch();
      if (launch?.requested) { onNativeLaunch(launch); return; }
    }
    const native = nativeBriefing ? await nativeBriefing.getState() : null;
    applyNativeBackgroundOff(native);
    const state = mergeNativeState(loadBriefingState(store), native);
    if (!cfg.enabled) { await maybeEvening(nowMs, today, state, native); return; }
    if (native?.bgDay === today && state.lastBriefingDay !== today && inAutoWindow(nowMs, cfg)) {
      // Der Hintergrund-Dienst hat beim Entsperren schon geprüft (und ggf. benachrichtigt/vorgelesen)
      if (!(await claimBriefingDay(today))) return;
      if (native.bgSpoken) {
        startBriefing({ card: { id: 'briefing-card', title: 'Ausführliches Briefing?', detail: 'Die Kurzfassung habe ich Ihnen vorhin schon vorgelesen.', button: '▶ Ausführlich' } });
      } else startBriefing();
      return;
    }
    const d = shouldBrief({ nowMs, state, cfg, onboarded: persona.onboarded });
    if (!d.ok) { await maybeEvening(nowMs, today, state, native); return; }
    if (await claimBriefingDay(d.day)) startBriefing();
  } catch (e) {
    console.warn('[Jarvis] Briefing-Prüfung', e);
  } finally {
    touchActivity();
    briefingChecking = false;
  }
}

/** Abends: erster Besuch im Fenster (Start … 23 Uhr) → Tagesrückblick, einmal pro Tag. */
async function maybeEvening(nowMs, today, state, native) {
  // Sonntags (Wochenrückblick an): der Wochenrückblick ersetzt die Abendzusammenfassung
  if (weeklyReplacesEvening({ nowMs, cfg: settings.weekly })) { await maybeWeekly(nowMs, today, state, native); return; }
  const ecfg = settings.evening;
  if (!ecfg.enabled) return;
  const st = { ...state, lastEveningDay: state.lastEveningDay || '' };
  const d = shouldEvening({ nowMs, state: st, cfg: ecfg, onboarded: persona.onboarded });
  if (!d.ok) return;
  if (!(await claimBriefingDay(d.day, 'evening'))) return;
  if (native?.bgEveningDay === today && native.bgEveningSpoken) {
    startBriefing({ kind: 'evening', card: { id: 'evening-card', title: 'Ausführlicher Tagesrückblick?', detail: 'Die Kurzfassung habe ich Ihnen vorhin schon vorgelesen.', button: '▶ Ausführlich' } });
  } else startBriefing({ kind: 'evening' });
}

/** Sonntags: erster Besuch ab der eingestellten Uhrzeit (bis 23 Uhr) → Wochenrückblick, einmal pro Sonntag. */
async function maybeWeekly(nowMs, today, state, native) {
  const d = shouldWeekly({ nowMs, state: { ...state, lastWeeklyDay: state.lastWeeklyDay || '' }, cfg: settings.weekly, onboarded: persona.onboarded });
  if (!d.ok) return;
  if (!(await claimBriefingDay(d.day, 'weekly'))) return;
  if (native?.bgWeeklyDay === today && native.bgWeeklySpoken) {
    startBriefing({ kind: 'weekly', card: { id: 'weekly-card', title: 'Ausführlicher Wochenrückblick?', detail: 'Die Kurzfassung habe ich Ihnen vorhin schon vorgelesen.', button: '▶ Ausführlich' } });
  } else startBriefing({ kind: 'weekly' });
}

/** „Ausschalten“ in der Dauer-Benachrichtigung → Einstellung übernehmen (statt sie wieder einzuschalten). */
function applyNativeBackgroundOff(native) {
  if (!nativeBriefing || !native?.bgOffByNotification) return;
  if (settings.briefing.background) {
    settings = saveSettings(store, { briefing: { ...settings.briefing, background: false } });
  }
  nativeBriefing.setBackground(false); // quittiert den Hinweis
}

/** Start aus der Benachrichtigung „Guten Morgen – Ihr Briefing ist bereit“ (Android). */
function onNativeLaunch(r) {
  if (!r?.requested) return;
  const kind = r.kind === 'evening' || r.kind === 'weekly' ? r.kind : 'morning';
  const st = loadBriefingState(store);
  const last = (kind === 'weekly' ? st.lastWeeklyAt : kind === 'evening' ? st.lastEveningAt : st.lastBriefingAt) || 0;
  if (busy || Date.now() - last < 2 * 60000) return; // läuft schon / gerade erst
  touchActivity();
  if (kind === 'evening') saveBriefingState(store, { lastEveningDay: dayKey(Date.now()) });
  if (kind === 'weekly') saveBriefingState(store, { lastWeeklyDay: dayKey(Date.now()) });
  if (r.trusted) startBriefing({ auto: true, kind });
  else if (kind === 'weekly') startBriefing({ kind, card: { id: 'weekly-card', title: 'Wochenrückblick starten?', detail: 'Möchten Sie jetzt Ihren Wochenrückblick hören?', button: '▶ Wochenrückblick starten' } });
  else if (kind === 'evening') startBriefing({ kind, card: { id: 'evening-card', title: 'Tagesrückblick starten?', detail: 'Möchten Sie jetzt Ihren Tagesrückblick hören?', button: '▶ Rückblick starten' } });
  else startBriefing({ card: { id: 'briefing-card', title: 'Briefing starten?', detail: 'Möchten Sie jetzt Ihr Morgen-Briefing hören?', button: '▶ Briefing starten' } });
}

let listening = false;
// ---------- v0.9 Stufe 0: „Jarvis fragen“ ----------
let listenRequestedAt = 0;

/** Start abholen: Android über das Plugin, PWA über ?zuhoeren=1 (danach aus der Adresse entfernt). */
async function consumeListenLaunch() {
  if (device.listenLaunch?.consume) return (await device.listenLaunch.consume()) || null;
  const u = parseListenUrl(location.href);
  if (u.cleanUrl !== null) { try { history.replaceState(null, '', u.cleanUrl); } catch { /* egal */ } }
  return u.listen ? { listen: true, opened: false } : null;
}

/** Zuhören, wenn angefordert. Normaler Start (mit „Beim Öffnen sofort zuhören“) lässt dem Briefing kurz den Vortritt. */
function onListenLaunch(launch) {
  if (!launch || (!launch.listen && !launch.opened)) return;
  const go = () => {
    const d = decideListen(launch, settings, { onboarded: persona.onboarded, busy, listening, hidden: document.hidden });
    if (d.listen) onMic();
  };
  if (launch.listen) go(); else setTimeout(go, 1200);
}

async function onMic() {
  if (!stt.isSupported()) return view.toast('Spracherkennung wird hier nicht unterstützt. Bitte Chrome verwenden.');
  if (!window.isSecureContext) return view.toast('Das Mikrofon funktioniert nur über HTTPS.');
  if (followUpActive()) {
    // Antippen während der Nachfrage: Fenster schließen (ohne Wake-Word: Mikrofon direkt aus)
    const wasListening = followUp.active;
    stopFollowUp('tap');
    if (wasListening) return;
  }
  if (listening) { stt.abort(); return; }
  if (busy) return;
  tts.cancel();
  wake.pause('mic');
  listening = true;
  view.setMicActive(true);
  view.setOrbState('listening');
  view.setStatus('Ich höre …');
  try {
    const text = await stt.listenOnce({ onInterim: (t) => view.setStatus(`„${t}“`) });
    listening = false;
    view.setMicActive(false);
    if (text) await handleInput(text, { voice: true });
    else { idle(); view.setStatus('Ich habe nichts verstanden.'); }
  } catch (e) {
    listening = false;
    view.setMicActive(false);
    showError(e.message);
  } finally {
    wake.resume('mic', { delayMs: 300 });
  }
}

function setWake(on) {
  settings = saveSettings(store, { wakeWord: on });
  view.updateWakeChip(on);
  if (on) {
    if (!stt.isSupported()) { view.toast('Spracherkennung nicht verfügbar.'); return setWake(false); }
    wake.enable();
  } else {
    wake.disable();
  }
  if (!busy) idle();
}

function applyPersona(p) {
  persona = p;
  view.applyName(p.name);
}

function greet() {
  const h = new Date().getHours();
  const salut = h < 5 ? 'Guten Abend' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  return `${salut}. ${persona.name} zu Ihren Diensten. Fragen Sie mich etwas oder tippen Sie auf das Mikrofon.`;
}

// ---------- Ansichten ----------
function showSettings(open) {
  $('#view-main').classList.toggle('hidden', open);
  $('#view-settings').classList.toggle('hidden', !open);
  if (open) { stopFollowUp('settings'); settingsView.fill(); }
  else applyAndRemember(settings.appearance); // Vorschau verwerfen bzw. Gespeichertes anwenden
}

const settingsView = createSettingsView({
  store,
  tts,
  device,
  onSaved: ({ settings: s, persona: p }) => {
    settings = s;
    applyPersona(p);
    view.updateMute(s.speak);
    setWake(s.wakeWord);
    showSettings(false);
    if (nativeBriefing) {
      Promise.resolve(syncNative()).then(() => nativeBriefing.setBackground(s.briefing.background && (s.briefing.enabled || s.evening.enabled || s.weekly.enabled)));
    }
  },
  onTestBriefing: () => {
    settings = loadSettings(store);
    showSettings(false);
    startBriefing({ auto: false });
  },
  onTestEvening: () => {
    settings = loadSettings(store);
    showSettings(false);
    startBriefing({ auto: false, kind: 'evening' });
  },
  onTestWeekly: () => {
    settings = loadSettings(store);
    showSettings(false);
    startBriefing({ auto: false, kind: 'weekly' });
  },
  onClearChat: () => { assistant.clearHistory(); view.renderHistory([]); }
});

async function onboarding() {
  const dlg = $('#onboarding');
  if (persona.onboarded || typeof dlg.showModal !== 'function') return;
  $('#ob-name').value = persona.name;
  const fillVoices = async () => view.fillVoiceSelect($('#ob-voice'), sortVoices(await tts.listVoices()), persona.voiceId);
  fillVoices();
  tts.onVoicesChanged(fillVoices);
  const obProvider = $('#ob-provider');
  obProvider.value = settings.apiKeys[settings.provider] ? settings.provider : 'gemini';
  const showHint = () => view.renderKeyHint($('#ob-key-hint'), PROVIDERS[obProvider.value]);
  obProvider.addEventListener('change', showHint);
  showHint();
  $('#ob-preview').onclick = () => {
    const p = { ...persona, name: sanitizeName($('#ob-name').value), voiceId: $('#ob-voice').value };
    speakTts(previewSentence(p.name), p);
  };
  dlg.addEventListener('close', () => {
    applyPersona(savePersona(store, { name: $('#ob-name').value, voiceId: $('#ob-voice').value, onboarded: true }));
    const key = $('#ob-apikey').value.trim();
    if (key) {
      settings = saveSettings(store, { provider: obProvider.value, apiKeys: { ...settings.apiKeys, [obProvider.value]: key } });
    }
    say(greet());
    touchActivity();
  }, { once: true });
  dlg.showModal();
}

// ---------- Start ----------
function init() {
  applyPersona(persona);
  view.updateMute(settings.speak);
  view.updateWakeChip(false);
  const history = assistant.getHistory();
  view.renderHistory(history);
  if (!history.length) view.addMessage({ role: 'assistant', text: greet() });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#input').value;
    $('#input').value = '';
    handleInput(v);
  });
  $('#btn-mic').addEventListener('click', onMic);
  $('#orb').addEventListener('click', onMic);
  $('#btn-mute').addEventListener('click', () => {
    settings = saveSettings(store, { speak: !settings.speak });
    if (!settings.speak) tts.cancel();
    view.updateMute(settings.speak);
  });
  $('#btn-wake').addEventListener('click', () => setWake(!wake.enabled));
  $('#btn-settings').addEventListener('click', () => showSettings(true));
  $('#btn-back').addEventListener('click', () => showSettings(false));

  // App im Hintergrund → Mikrofon freigeben; wieder sichtbar → weiter hören
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopFollowUp('hidden'); wake.pause('hidden'); tts.cancel(); touchActivity(); syncNative(); }
    else { wake.resume('hidden', { delayMs: 400 }); maybeAutoBriefing(); }
  });
  // Herzschlag: solange die App sichtbar ist, gilt der Nutzer als aktiv
  setInterval(() => { if (!document.hidden && !briefingChecking) touchActivity(); }, 60000);

  timers.restore();
  setInterval(() => view.updateTimerChip(timers.list(), formatDuration), 1000);
  // v0.9 W4: Erinnerungen. Android meldet sie als Benachrichtigung (auch bei geschlossener App) – hier nur
  // als erledigt markieren. Im Browser meldet Jarvis sie selbst, solange die App offen ist; verpasste beim Öffnen.
  checkReminders();
  setInterval(() => { if (!document.hidden) checkReminders(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkReminders(); });
  view.updateTimerChip(timers.list(), formatDuration);

  if (settings.wakeWord) setWake(true); // Chrome fragt ggf. nach Mikrofon-Erlaubnis
  if (!window.isSecureContext) view.setStatus('⚠️ Ohne HTTPS funktioniert das Mikrofon nicht.');
  else if (!stt.isSupported()) view.setStatus('Spracherkennung nicht verfügbar – bitte Chrome nutzen.');

  onboarding();

  // Morgen-Briefing: beim ersten Öffnen nach dem Aufwachen (bzw. aus der Benachrichtigung)
  (async () => {
    // v0.9 Stufe 0: zuerst schauen, ob Jarvis zum Fragen geöffnet wurde (Kachel/Verknüpfung/jarvis://zuhoeren)
    const firstLaunch = await consumeListenLaunch();
    if (firstLaunch?.listen) listenRequestedAt = Date.now();
    await maybeAutoBriefing(); // holt auch einen Start aus der Benachrichtigung ab
    onListenLaunch(firstLaunch);
    device.listenLaunch?.onLaunch?.(async (ev) => {
      if (ev?.listen) listenRequestedAt = Date.now(); // vor dem Briefing-Check beim Zurückkehren
      onListenLaunch(await device.listenLaunch.consume());
    });
    nativeBriefing?.onLaunch?.(async () => {
      const r = await nativeBriefing.consumeLaunch();
      if (r?.requested) onNativeLaunch(r);
    });
    await syncNative();
    if (nativeBriefing) {
      applyNativeBackgroundOff(await nativeBriefing.getState());
      if ((settings.briefing.enabled || settings.evening.enabled || settings.weekly.enabled) && settings.briefing.background) nativeBriefing.setBackground(true);
    }
  })();
  globalThis.__JARVIS_BRIEFING__ = { check: maybeAutoBriefing, start: (o) => startBriefing(o) };

  if (!globalThis.__JARVIS_NATIVE__ && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

init();
