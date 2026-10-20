// Dauerhaftes Zuhören (Wake-Word) als kleine Zustandsmaschine – browser-frei und testbar.
//
// Warum: Android-Spracherkennung hört pro Start nur ein „Segment“ (bis Stille/Fehler) und
// spielt bei jedem Start oft einen System-Ton. Ein naiver Neustart-Kreislauf startet bei
// Stille/Fehlern ununterbrochen neu, überlappt sich bei langsamer Bridge und piept dauernd.
//
// Regeln:
//  - Genau EIN Segment gleichzeitig (Generationszähler: alte Rückmeldungen werden ignoriert).
//  - Nach erkanntem Satz: kurzer Neustart. Nach Stille: wachsende Pause (bis silenceMaxMs).
//  - Nach Fehlern: exponentielles Warten (errorBaseMs · 2^n, max. errorMaxMs); nach maxErrors
//    Fehlern in Folge Schluss mit Hinweis (onFatal). Dauerhafte Fehler (Erlaubnis, Sprache) sofort.
//  - Wächter: hängt ein Segment länger als watchdogMs, wird es abgebrochen und neu gestartet.
//
// engine = {
//   start({ onReady, onPartial, onFinal, onEnd }) → Promise   (lehnt ab bei Startfehler: err.kind/err.code)
//      onEnd({ reason: 'final'|'silence'|'error', kind?: 'retry'|'busy'|'fatal', code?, message? })
//   cancel()
// }

export const DEFAULT_LISTEN_POLICY = Object.freeze({
  restartAfterFinalMs: 300,
  silenceDelaysMs: [400, 400, 800, 1500, 3000],
  errorBaseMs: 1000,
  errorMaxMs: 30000,
  maxErrors: 6,
  watchdogMs: 20000
});

/** Wartezeit vor dem nächsten Start (rein, für Tests). */
export function nextDelay({ reason, kind, silences = 0, errors = 0 }, policy = DEFAULT_LISTEN_POLICY) {
  if (reason === 'final') return policy.restartAfterFinalMs;
  if (reason === 'silence') {
    const d = policy.silenceDelaysMs;
    return d[Math.min(Math.max(silences, 1), d.length) - 1];
  }
  if (kind === 'fatal') return -1;
  return Math.min(policy.errorMaxMs, policy.errorBaseMs * 2 ** Math.max(0, errors - 1));
}

export function createListenLoop({
  engine, onFinal, onInterim, onState, onFatal,
  policy = DEFAULT_LISTEN_POLICY,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t)
}) {
  let state = 'idle';          // idle | starting | listening | waiting | failed
  let gen = 0;                 // jede Sitzung/jedes Segment bekommt eine neue Nummer
  let timer = null;
  let watchdog = null;
  let silences = 0;
  let errors = 0;
  let segments = 0;
  let segmentHadSpeech = false;

  const setState = (s) => { state = s; try { onState?.(s); } catch { /* UI */ } };
  const clearTimers = () => { if (timer) clearTimer(timer); if (watchdog) clearTimer(watchdog); timer = null; watchdog = null; };

  function schedule(ms) {
    clearTimers();
    setState('waiting');
    const my = gen;
    timer = setTimer(() => { timer = null; if (my === gen && state === 'waiting') segment(); }, ms);
  }

  function fail(info) {
    clearTimers();
    gen++;
    try { engine.cancel(); } catch { /* egal */ }
    setState('failed');
    const msg = info.kind === 'fatal'
      ? (info.message || 'Spracherkennung nicht möglich.')
      : 'Das Wake-Word ist pausiert: Die Spracherkennung meldet wiederholt Fehler. Tippen Sie auf „Wake-Word“, um es erneut zu versuchen.';
    const err = new Error(msg);
    err.kind = info.kind; err.code = info.code;
    try { onFatal?.(err); } catch { /* UI */ }
  }

  function ended(my, info) {
    if (my !== gen || (state !== 'listening' && state !== 'starting')) return; // veraltet
    clearTimers();
    gen++; // spätere Meldungen dieses Segments ignorieren
    const reason = info.reason;
    if (reason === 'final') { silences = 0; errors = 0; }
    else if (reason === 'silence') { if (segmentHadSpeech) silences = 0; silences++; errors = 0; }
    else {
      errors++;
      if (info.kind === 'fatal' || errors >= policy.maxErrors) { fail(info); return; }
    }
    const ms = nextDelay({ reason, kind: info.kind, silences, errors }, policy);
    if (ms < 0) { fail(info); return; }
    schedule(ms);
  }

  function segment() {
    clearTimers();
    const my = ++gen;
    segments++;
    segmentHadSpeech = false;
    setState('starting');
    watchdog = setTimer(() => {
      watchdog = null;
      if (my !== gen) return;
      try { engine.cancel(); } catch { /* egal */ }
      ended(my, { reason: 'silence', watchdog: true });
    }, policy.watchdogMs);
    let p;
    try {
      p = engine.start({
        onReady: () => { if (my === gen && state === 'starting') setState('listening'); },
        onPartial: (t) => { if (my !== gen || !t) return; segmentHadSpeech = true; if (state === 'starting') setState('listening'); try { onInterim?.(t); } catch { /* UI */ } },
        onFinal: (t) => {
          if (my !== gen) return;
          const text = String(t || '').trim();
          if (text) { segmentHadSpeech = true; try { onFinal?.(text); } catch { /* Befehl */ } }
          ended(my, { reason: text ? 'final' : 'silence' });
        },
        onEnd: (info = {}) => ended(my, { reason: 'error', ...info })
      });
    } catch (e) {
      p = Promise.reject(e);
    }
    Promise.resolve(p).then(
      () => { if (my === gen && state === 'starting') setState('listening'); },
      (e) => ended(my, { reason: 'error', kind: e?.kind || 'retry', code: e?.code, message: e?.message })
    );
  }

  return {
    get state() { return state; },
    get stats() { return { segments, silences, errors }; },
    start() {
      if (state === 'starting' || state === 'listening' || state === 'waiting') return; // kein Doppelstart
      silences = 0; errors = 0;
      segment();
    },
    stop() {
      const was = state;
      clearTimers();
      gen++;
      if (was === 'starting' || was === 'listening') { try { engine.cancel(); } catch { /* egal */ } }
      setState('idle');
    }
  };
}
