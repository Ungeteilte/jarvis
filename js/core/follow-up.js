// v0.9.6 Nachfrage-Modus: Nach einer gesprochenen Antwort hört Jarvis noch kurz zu, damit der Nutzer
// ohne „Hey <Name>“ weitersprechen kann. Reine Logik (kein Browser-Code), testbar mit Fake-Erkennung.
//
// Regeln:
//  - Start NUR nach dem Ende der eigenen Sprachausgabe (+ kurze Nachhall-Pause), nie währenddessen.
//  - Nur im Vordergrund, nur nach einer per Sprache gestellten Frage (Mikrofon, Wake-Word, Nachfrage).
//  - Endet bei Stille (kein Wort im Fenster), bei Antippen, beim Verlassen der App oder bei neuer Ausgabe.
//  - Kein Dauerhören: höchstens FOLLOW_UP_TIMING.maxSegments kurze Erkennungen pro Fenster.
//  - Gesprochenes geht über den normalen Eingabeweg (offene Ja/Nein-Karten funktionieren weiter).

export const FOLLOW_UP_LIMITS = Object.freeze({ min: 4, max: 15 });
export const FOLLOW_UP_WINDOWS = Object.freeze([4, 6, 8, 10, 12, 15]);
export const DEFAULT_FOLLOW_UP = Object.freeze({ enabled: true, windowSec: 8 });
export const FOLLOW_UP_TIMING = Object.freeze({
  startDelayMs: 450,   // nach Ende der Sprachausgabe (Nachhall der eigenen Stimme abwarten)
  minSegmentMs: 1500,  // neue Erkennung nur, wenn im Fenster noch mindestens so viel Zeit bleibt
  maxSegments: 3,      // Obergrenze pro Fenster (Akku; Erkenner beenden sich bei Stille selbst)
  bareExtendMs: 6000   // nur „Hey <Name>“ gesagt → noch so lange auf den eigentlichen Satz warten
});

export function normalizeFollowUpConfig(c) {
  const sec = Math.round(Number(c?.windowSec));
  return {
    enabled: typeof c?.enabled === 'boolean' ? c.enabled : DEFAULT_FOLLOW_UP.enabled,
    windowSec: Number.isFinite(sec) ? Math.min(FOLLOW_UP_LIMITS.max, Math.max(FOLLOW_UP_LIMITS.min, sec)) : DEFAULT_FOLLOW_UP.windowSec
  };
}

/** Soll nach dieser Antwort zugehört werden? */
export function shouldFollowUp({ cfg, viaVoice, spoken, hidden, reply, sttSupported = true } = {}) {
  const c = normalizeFollowUpConfig(cfg);
  if (!c.enabled || !viaVoice || !spoken || hidden || !sttSupported) return false;
  if (!reply || reply.role !== 'assistant') return false;
  return true;
}

/**
 * createFollowUp({ listen, abort, matchWake, onState, onText, onEnd, now, setTimer, clearTimer })
 *  listen({onInterim}) → Promise<string>  (eine Erkennung; endet selbst bei Stille)
 *  abort()                                 (bricht die laufende Erkennung ab → listen liefert '')
 *  matchWake(text) → {matched, command, bare} (optional: „Hey Jarvis, …“ trotzdem verstehen;
 *                    bare = nur „Hey Jarvis“ gesagt → einmal weiterhören)
 *  onState('waiting'|'hearing'|'ended', info)
 *  onText(text)   – erkannter Satz (Aufrufer leitet an die normale Eingabe weiter)
 */
export function createFollowUp({
  listen, abort, matchWake, onState, onText,
  now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, timing = FOLLOW_UP_TIMING
} = {}) {
  let gen = 0;
  let active = false;
  let deadline = 0;
  let timer = null;
  let segments = 0;
  let extended = false;

  const clear = () => { if (timer) { clearTimer(timer); timer = null; } };

  function end(reason, g) {
    if (g !== gen || !active) return;
    active = false;
    clear();
    onState?.('ended', { reason });
  }

  async function segment(g) {
    if (g !== gen || !active) return;
    segments++;
    let heard = false;
    clear();
    const left = Math.max(0, deadline - now());
    timer = setTimer(() => { timer = null; if (g === gen && active && !heard) { try { abort?.(); } catch { /* egal */ } } }, left);
    let text = '';
    try {
      text = String(await listen({
        onInterim: (t) => {
          if (g !== gen || !t) return;
          if (!heard) { heard = true; clear(); onState?.('hearing', { text: t }); }
          else onState?.('hearing', { text: t });
        }
      }) || '').trim();
    } catch (e) {
      return end('error', g);
    }
    if (g !== gen || !active) return;
    clear();
    if (text) {
      const m = matchWake ? matchWake(text) : null;
      if (m?.bare) {
        // Nur „Hey Jarvis“ gesagt: einmal erneut zuhören (wie beim Wake-Word)
        if (!extended) {
          extended = true;
          deadline = Math.max(deadline, now() + timing.bareExtendMs);
          onState?.('waiting', { remainingMs: deadline - now() });
          return segment(g);
        }
        return end('silence', g);
      }
      const cmd = m?.matched && m.command ? m.command : text;
      active = false;
      onState?.('ended', { reason: 'text' });
      onText?.(cmd);
      return;
    }
    // Nichts verstanden: weiterhören, solange das Fenster noch offen ist
    if (!heard && deadline - now() >= timing.minSegmentMs && segments < timing.maxSegments) {
      onState?.('waiting', { remainingMs: deadline - now() });
      return segment(g);
    }
    end('silence', g);
  }

  return {
    get active() { return active; },
    get segments() { return segments; },
    /** Startet das Nachfrage-Fenster (windowMs) sofort. */
    start(windowMs) {
      const g = ++gen;
      clear();
      active = true;
      segments = 0;
      extended = false;
      deadline = now() + Math.max(1000, Number(windowMs) || DEFAULT_FOLLOW_UP.windowSec * 1000);
      onState?.('waiting', { remainingMs: deadline - now() });
      segment(g);
      return g;
    },
    /** Beendet das Fenster (Antippen, App verlassen, neue Ausgabe …). */
    stop(reason = 'stopped') {
      if (!active) { gen++; return false; }
      const g = gen;
      try { abort?.(); } catch { /* egal */ }
      end(reason, g);
      gen++;
      return true;
    }
  };
}
