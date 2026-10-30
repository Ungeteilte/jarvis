// Steuert den Wake-Word-Modus. Browser-frei: bekommt einen STT-Adapter
// (startContinuous) und den aktuellen Namen injiziert.
//
// Ablauf: dauerhaft zuhören → "Hey <Name> <Befehl>" → Befehl ausführen.
// Nur "Hey <Name>" → 8 Sekunden lang wird der nächste Satz als Befehl genommen.
//
// Pausen haben GRÜNDE (z. B. 'tts', 'turn', 'mic', 'hidden', 'bg-tts'): Zugehört wird erst
// wieder, wenn ALLE Gründe aufgehoben sind – so kann eine verschachtelte Sprachausgabe das
// Mikrofon nicht mitten in einer anderen Ausgabe wieder öffnen (Jarvis hört sich sonst selbst).
// resume(grund, { delayMs }) wartet kurz (Nachhall der eigenen Stimme) und startet höchstens einmal.
//
// v0.9.6 Nachfrage-Modus: armFollowUp(ms) öffnet nach einer gesprochenen Antwort dasselbe
// Befehlsfenster wie „Hey <Name>“ – der nächste Satz gilt ohne Namen als Befehl. Es läuft KEINE
// zusätzliche Erkennung: genutzt wird die ohnehin aktive Wake-Word-Erkennung (nur bei offener App).
import { createWakeMatcher, isBareWake } from './wakeword.js';

export function createWakeController({
  stt, getName, onWake, onCommand, onState, onError, commandWindowMs = 8000,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t)
}) {
  let session = null;
  let enabled = false;
  const reasons = new Set();
  let resumeTimer = null;
  let awaitingUntil = 0;
  let awaitTimer = null;
  let starts = 0;
  let followUp = false; // Fenster stammt aus dem Nachfrage-Modus (nicht aus „Hey <Name>“)
  let matcher = createWakeMatcher(getName());
  let matcherName = getName();

  const currentMatcher = () => {
    const name = getName();
    if (name !== matcherName) { matcher = createWakeMatcher(name); matcherName = name; }
    return matcher;
  };

  function handleFinal(text) {
    if (!text) return;
    if (Date.now() < awaitingUntil) {
      // Name wurde gerade gerufen (oder Nachfrage-Fenster offen) → dieser Satz ist der Befehl
      const again = currentMatcher()(text);
      if (followUp && isBareWake(again)) {
        // Im Nachfrage-Fenster nur „Hey <Name>“ gesagt → wie ein normaler Weckruf weiter warten
        followUp = false;
        armWindow(commandWindowMs);
        onWake?.();
        return;
      }
      awaitingUntil = 0;
      followUp = false;
      if (awaitTimer) { clearTimer(awaitTimer); awaitTimer = null; }
      onCommand(again.matched && again.command ? again.command : text);
      return;
    }
    const m = currentMatcher()(text);
    if (!m.matched) return;
    if (m.command.length > 1) {
      onCommand(m.command);
    } else {
      armWindow(commandWindowMs);
      onWake?.();
    }
  }

  function armWindow(ms) {
    awaitingUntil = Date.now() + ms;
    if (awaitTimer) clearTimer(awaitTimer);
    awaitTimer = setTimer(() => {
      awaitTimer = null;
      if (awaitingUntil && Date.now() >= awaitingUntil) {
        const wasFollowUp = followUp;
        awaitingUntil = 0;
        followUp = false;
        if (wasFollowUp) onState?.('followup-end');
        onState?.('standby');
      }
    }, ms + 50);
  }

  const cancelResume = () => { if (resumeTimer) { clearTimer(resumeTimer); resumeTimer = null; } };

  function start() {
    cancelResume();
    if (session || !enabled || reasons.size) return;
    starts++;
    let mine = null;
    mine = stt.startContinuous({
      onFinal: handleFinal,
      onState: (s) => onState?.(s === 'listening' ? (awaitingUntil > Date.now() ? (followUp ? 'followup' : 'awaiting') : 'standby') : s),
      onError: (e) => {
        // Adapter hat aufgegeben: Sitzung wirklich beenden (keine verwaiste Neustart-Schleife)
        try { mine?.stop(); } catch { /* egal */ }
        if (session === mine) session = null;
        enabled = false;
        onError?.(e);
      }
    });
    if (enabled) session = mine; // onError kann synchron gekommen sein
  }
  function stop() {
    cancelResume();
    const s = session;
    session = null;
    try { s?.stop(); } catch { /* egal */ }
  }

  return {
    get enabled() { return enabled; },
    get awaiting() { return Date.now() < awaitingUntil; },
    get listening() { return Boolean(session); },
    get paused() { return reasons.size > 0; },
    get pauseReasons() { return [...reasons]; },
    get starts() { return starts; },
    enable() { enabled = true; start(); },
    disable() { enabled = false; awaitingUntil = 0; followUp = false; stop(); },
    /** z. B. während Jarvis spricht oder der Mikrofon-Knopf benutzt wird */
    pause(reason = 'manual') { reasons.add(reason); stop(); },
    /** Grund aufheben; erst wenn keiner mehr übrig ist, nach delayMs wieder zuhören. */
    resume(reason = 'manual', { delayMs = 0 } = {}) {
      reasons.delete(reason);
      if (reasons.size || !enabled || session) return;
      cancelResume();
      if (delayMs > 0) resumeTimer = setTimer(() => { resumeTimer = null; start(); }, delayMs);
      else start();
    },
    get followUp() { return followUp && Date.now() < awaitingUntil; },
    /** v0.9.6 Nachfrage-Modus: die nächsten ms gilt ein Satz ohne Namen als Befehl. */
    armFollowUp(ms) {
      if (!enabled) return false;
      followUp = true;
      armWindow(Math.max(1000, Number(ms) || 8000));
      return true;
    },
    /** Nachfrage-Fenster schließen (z. B. App verlassen, Antippen). */
    cancelFollowUp() {
      if (!followUp) return false;
      followUp = false;
      awaitingUntil = 0;
      if (awaitTimer) { clearTimer(awaitTimer); awaitTimer = null; }
      onState?.('followup-end');
      return true;
    },
    /** Für Tests: einen erkannten Satz direkt einspeisen */
    feed: handleFinal
  };
}
