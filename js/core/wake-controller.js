// Steuert den Wake-Word-Modus. Browser-frei: bekommt einen STT-Adapter
// (startContinuous) und den aktuellen Namen injiziert.
//
// Ablauf: dauerhaft zuhören → "Hey <Name> <Befehl>" → Befehl ausführen.
// Nur "Hey <Name>" → 8 Sekunden lang wird der nächste Satz als Befehl genommen.
import { createWakeMatcher } from './wakeword.js';

export function createWakeController({ stt, getName, onWake, onCommand, onState, onError, commandWindowMs = 8000 }) {
  let session = null;
  let enabled = false;
  let paused = false;
  let awaitingUntil = 0;
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
      // Name wurde gerade gerufen → dieser Satz ist der Befehl
      awaitingUntil = 0;
      const again = currentMatcher()(text);
      onCommand(again.matched && again.command ? again.command : text);
      return;
    }
    const m = currentMatcher()(text);
    if (!m.matched) return;
    if (m.command.length > 1) {
      onCommand(m.command);
    } else {
      awaitingUntil = Date.now() + commandWindowMs;
      onWake?.();
      setTimeout(() => { if (awaitingUntil && Date.now() >= awaitingUntil) { awaitingUntil = 0; onState?.('standby'); } }, commandWindowMs + 50);
    }
  }

  function start() {
    if (session || !enabled || paused) return;
    session = stt.startContinuous({
      onFinal: handleFinal,
      onState: (s) => onState?.(s === 'listening' ? (awaitingUntil ? 'awaiting' : 'standby') : s),
      onError: (e) => { enabled = false; session = null; onError?.(e); }
    });
  }
  function stop() {
    session?.stop();
    session = null;
  }

  return {
    get enabled() { return enabled; },
    get awaiting() { return Date.now() < awaitingUntil; },
    enable() { enabled = true; start(); },
    disable() { enabled = false; awaitingUntil = 0; stop(); },
    /** z. B. während Jarvis spricht oder der Mikrofon-Knopf benutzt wird */
    pause() { paused = true; stop(); },
    resume() { paused = false; start(); },
    /** Für Tests: einen erkannten Satz direkt einspeisen */
    feed: handleFinal
  };
}
