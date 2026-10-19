// Einstiegspunkt: verbindet Kern (js/core), Browser-Adapter (js/adapters)
// und Oberfläche (js/ui). Für eine native App werden später nur die
// Adapter und die UI ersetzt – der Kern bleibt gleich.
import { createStore } from './core/storage.js';
import { loadSettings, saveSettings, PROVIDERS } from './core/settings.js';
import { loadPersona, savePersona, sortVoices, previewSentence, sanitizeName } from './core/persona.js';
import { createTimerManager } from './core/timers.js';
import { createAssistant } from './core/assistant.js';
import { createWakeController } from './core/wake-controller.js';
import { formatDuration } from './core/skills.js';
import { createWebStorageAdapter } from './adapters/web-storage.js';
import { createWebTTS } from './adapters/web-tts.js';
import { createWebSTT } from './adapters/web-stt.js';
import { beep, vibrate } from './adapters/web-audio.js';
import { createWebDevice } from './adapters/web-device.js';
import * as view from './ui/view.js';
import { createSettingsView } from './ui/settings-view.js';

const { $ } = view;

// ---------- Dienste ----------
const store = createStore(createWebStorageAdapter());
const tts = createWebTTS();
const stt = createWebSTT({ lang: 'de-DE' });
const device = createWebDevice();
let settings = loadSettings(store);
let persona = loadPersona(store);
let busy = false;

const timers = createTimerManager({
  store,
  onDone: (t) => {
    beep({ freq: 988, times: 4 });
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

let turn = 0; // zählt Eingaben, damit eine alte Sprachausgabe keine neue stört
async function handleInput(text) {
  const input = String(text || '').trim();
  if (!input || busy) return;
  const myTurn = ++turn;
  busy = true;
  wake.pause();
  tts.cancel();
  view.addMessage({ role: 'user', text: input });
  view.setOrbState('thinking');
  view.setStatus('Einen Moment …');
  const hideTyping = view.showTyping();
  let reply = null;
  try {
    reply = await assistant.process(input);
  } catch (e) {
    showError(e.message);
  } finally {
    hideTyping();
    busy = false; // neue Eingaben sind ab jetzt wieder möglich (unterbrechen die Sprachausgabe)
  }
  if (reply) {
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
  onSaved: ({ settings: s, persona: p }) => {
    settings = s;
    applyPersona(p);
    view.updateMute(s.speak);
    setWake(s.wakeWord);
    showSettings(false);
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
    if (document.hidden) { wake.pause(); tts.cancel(); }
    else wake.resume();
  });

  timers.restore();
  setInterval(() => view.updateTimerChip(timers.list(), formatDuration), 1000);
  view.updateTimerChip(timers.list(), formatDuration);

  if (settings.wakeWord) setWake(true); // Chrome fragt ggf. nach Mikrofon-Erlaubnis
  if (!window.isSecureContext) view.setStatus('⚠️ Ohne HTTPS funktioniert das Mikrofon nicht.');
  else if (!stt.isSupported()) view.setStatus('Spracherkennung nicht verfügbar – bitte Chrome nutzen.');

  onboarding();

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker:', e));
  }
}

init();
