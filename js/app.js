// Einstiegspunkt: verbindet Kern (js/core), Browser-Adapter (js/adapters)
// und Oberfläche (js/ui). Für eine native App werden später nur die
// Adapter und die UI ersetzt – der Kern bleibt gleich.
import { createStore } from './core/storage.js';
import { loadSettings, saveSettings, PROVIDERS } from './core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName } from './core/persona.js';
import { createTimerManager } from './core/timers.js';
import { createAssistant } from './core/assistant.js';
import { createWakeController } from './core/wake-controller.js';
import { formatDuration, loadNotes } from './core/skills.js';
import { createSentenceChunker } from './core/sentences.js';
import { createWebStorageAdapter } from './adapters/web-storage.js';
import { createWebTTS } from './adapters/web-tts.js';
import { createWebSTT } from './adapters/web-stt.js';
import { beep, vibrate } from './adapters/web-audio.js';
import { createWebDevice } from './adapters/web-device.js';
import { waitForBoot, adapterKind } from './core/boot.js';
import {
  shouldBrief, recordActivity, mergeNativeState, loadBriefingState, saveBriefingState, dayKey, localParts, NIGHT_LOCK_HOUR, DAY_START_HOUR,
  shouldEvening, recordTimerFired, todayStats
} from './core/briefing/index.js';

// Native Capacitor-App setzt window.__JARVIS_ADAPTERS__ im Bootstrap – erst darauf warten
// (höchstens 3 s, dann Web-Adapter), sonst gewinnt dieses Modul das Rennen.
await waitForBoot(globalThis);
const _A = globalThis.__JARVIS_ADAPTERS__;
import * as view from './ui/view.js';
import { createSettingsView } from './ui/settings-view.js';

const { $ } = view;

// ---------- Dienste ----------
const store = createStore(_A?.storage ? _A.storage() : createWebStorageAdapter());
const tts = _A?.tts ? _A.tts() : createWebTTS();
const stt = _A?.stt ? _A.stt({ lang: 'de-DE' }) : createWebSTT({ lang: 'de-DE' });
const device = _A?.device ? _A.device() : createWebDevice();
console.info(`[Jarvis] Adapter: ${adapterKind(_A)}`);
let settings = loadSettings(store);
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
  onCommand: (text) => handleInput(text),
  onState: (s) => {
    if (busy) return;
    if (s === 'standby') { view.setOrbState('standby'); view.setStatus(`Sagen Sie „Hey ${persona.name}“ …`); }
    if (s === 'awaiting') { view.setOrbState('listening'); view.setStatus('Ja, bitte?'); }
    if (s === 'stopped' && !wake.enabled) { view.setOrbState('idle'); view.setStatus('Bereit.'); }
  },
  onError: (e) => {
    setWake(false);
    showError(e.message);
  }
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

/** Spricht einen Text (falls Sprachausgabe an ist). Wake-Word pausiert solange. */
async function say(text) {
  if (!settings.speak || !tts.isSupported()) return;
  wake.pause();
  view.setOrbState('speaking');
  try {
    await tts.speak(text, persona);
  } finally {
    wake.resume();
  }
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
        if (!started) { started = true; wake.pause(); }
        view.setOrbState('speaking');
        try { await tts.speak(s, persona); } catch { /* nächster Satz */ }
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
      if (started) wake.resume();
    }
  };
}

let turn = 0; // zählt Eingaben, damit eine alte Sprachausgabe keine neue stört
async function handleInput(text) {
  const input = String(text || '').trim();
  if (!input || busy) return;
  touchActivity();
  view.addMessage({ role: 'user', text: input });
  const reply = await runTurn((onDelta) => assistant.process(input, { onDelta }));
  if (reply?.settingsChanged || reply?.source === 'briefing') { settings = loadSettings(store); syncNative(); }
}

/**
 * Ein Antwort-Durchlauf (Nutzereingabe oder Briefing): Streaming-Blase, satzweise
 * Sprachausgabe, Bestätigungskarten. exec(onDelta) → Antwort-Nachricht.
 */
async function runTurn(exec, { status = 'Einen Moment …' } = {}) {
  if (busy) return null;
  const myTurn = ++turn;
  busy = true;
  wake.pause();
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
    if (reply.confirm) {
      view.addConfirmCard(reply.confirm, {
        onYes: async () => {
          const r = await assistant.confirmAction(reply.confirm.action);
          if (r) { view.addMessage(r); await say(r.text); }
        },
        onNo: async () => {
          const r = assistant.cancelAction();
          if (r) { view.addMessage(r); await say(r.text); }
        }
      });
    }
    view.setStatus(reply.error ? 'Es gab ein Problem.' : '');
    await say(reply.text);
  }
  if (myTurn === turn && !busy) { wake.resume(); idle(); }
  return reply;
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
  return nativeBriefing.sync({
    config: settings.briefing,
    evening: settings.evening,
    lastActiveAt: st.lastActiveAt || 0,
    lastBriefingDay: st.lastBriefingDay || '',
    lastEveningDay: st.lastEveningDay || '',
    today: { day: stats.day, chats: stats.chats, topics: stats.topics, notes: stats.notes, timers: stats.timers },
    coords: st.coords || null,
    tz: deviceTz(),
    name: persona.name,
    onboarded: Boolean(persona.onboarded),
    voice: { voiceId: persona.voiceId || '', rate: persona.rate, pitch: persona.pitch }
  });
}

/** Tages-Anspruch sichern (mehrere Tabs: Web-Locks; sonst einfache Prüfung). */
async function claimBriefingDay(day, kind = 'morning') {
  const key = kind === 'evening' ? 'lastEveningDay' : 'lastBriefingDay';
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
  evening: { id: 'evening-card', title: '🌙 Guten Abend – Ihr Tagesrückblick ist bereit', detail: 'Tippen zum Starten (Ihr Tag, Ausblick auf morgen).', button: '▶ Rückblick starten' }
};

function startBriefing({ auto = true, card = null, kind = 'morning' } = {}) {
  const evening = kind === 'evening';
  const run = () => runTurn((onDelta) => assistant.brief({ onDelta, auto, kind: evening ? 'evening' : 'morning' }),
    { status: evening ? 'Ich stelle Ihren Tagesrückblick zusammen …' : 'Ich stelle Ihr Briefing zusammen …' })
    .then(() => syncNative());
  const needsGesture = !globalThis.__JARVIS_NATIVE__ && settings.speak && tts.isSupported()
    && globalThis.navigator?.userActivation && !navigator.userActivation.hasBeenActive;
  if (card || needsGesture) {
    view.addStartCard(card || DEFAULT_CARDS[evening ? 'evening' : 'morning'], run);
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
    if ((!cfg.enabled && !settings.evening.enabled) || !persona.onboarded || busy) return;
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
  const kind = r.kind === 'evening' ? 'evening' : 'morning';
  const st = loadBriefingState(store);
  const last = (kind === 'evening' ? st.lastEveningAt : st.lastBriefingAt) || 0;
  if (busy || Date.now() - last < 2 * 60000) return; // läuft schon / gerade erst
  touchActivity();
  if (kind === 'evening') saveBriefingState(store, { lastEveningDay: dayKey(Date.now()) });
  if (r.trusted) startBriefing({ auto: true, kind });
  else if (kind === 'evening') startBriefing({ kind, card: { id: 'evening-card', title: 'Tagesrückblick starten?', detail: 'Möchten Sie jetzt Ihren Tagesrückblick hören?', button: '▶ Rückblick starten' } });
  else startBriefing({ card: { id: 'briefing-card', title: 'Briefing starten?', detail: 'Möchten Sie jetzt Ihr Morgen-Briefing hören?', button: '▶ Briefing starten' } });
}

let listening = false;
async function onMic() {
  if (!stt.isSupported()) return view.toast('Spracherkennung wird hier nicht unterstützt. Bitte Chrome verwenden.');
  if (!window.isSecureContext) return view.toast('Das Mikrofon funktioniert nur über HTTPS.');
  if (listening) { stt.abort(); return; }
  if (busy) return;
  tts.cancel();
  wake.pause();
  listening = true;
  view.setMicActive(true);
  view.setOrbState('listening');
  view.setStatus('Ich höre …');
  try {
    const text = await stt.listenOnce({ onInterim: (t) => view.setStatus(`„${t}“`) });
    listening = false;
    view.setMicActive(false);
    if (text) await handleInput(text);
    else { idle(); view.setStatus('Ich habe nichts verstanden.'); }
  } catch (e) {
    listening = false;
    view.setMicActive(false);
    showError(e.message);
  } finally {
    wake.resume();
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
  if (open) settingsView.fill();
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
      Promise.resolve(syncNative()).then(() => nativeBriefing.setBackground(s.briefing.background && (s.briefing.enabled || s.evening.enabled)));
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
    tts.speak(previewSentence(p.name), p);
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
    if (document.hidden) { wake.pause(); tts.cancel(); touchActivity(); syncNative(); }
    else { wake.resume(); maybeAutoBriefing(); }
  });
  // Herzschlag: solange die App sichtbar ist, gilt der Nutzer als aktiv
  setInterval(() => { if (!document.hidden && !briefingChecking) touchActivity(); }, 60000);

  timers.restore();
  setInterval(() => view.updateTimerChip(timers.list(), formatDuration), 1000);
  view.updateTimerChip(timers.list(), formatDuration);

  if (settings.wakeWord) setWake(true); // Chrome fragt ggf. nach Mikrofon-Erlaubnis
  if (!window.isSecureContext) view.setStatus('⚠️ Ohne HTTPS funktioniert das Mikrofon nicht.');
  else if (!stt.isSupported()) view.setStatus('Spracherkennung nicht verfügbar – bitte Chrome nutzen.');

  onboarding();

  // Morgen-Briefing: beim ersten Öffnen nach dem Aufwachen (bzw. aus der Benachrichtigung)
  (async () => {
    await maybeAutoBriefing(); // holt auch einen Start aus der Benachrichtigung ab
    nativeBriefing?.onLaunch?.(async () => {
      const r = await nativeBriefing.consumeLaunch();
      if (r?.requested) onNativeLaunch(r);
    });
    await syncNative();
    if (nativeBriefing) {
      applyNativeBackgroundOff(await nativeBriefing.getState());
      if ((settings.briefing.enabled || settings.evening.enabled) && settings.briefing.background) nativeBriefing.setBackground(true);
    }
  })();
  globalThis.__JARVIS_BRIEFING__ = { check: maybeAutoBriefing, start: (o) => startBriefing(o) };

  if (!globalThis.__JARVIS_NATIVE__ && 'serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

init();
