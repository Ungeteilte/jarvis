/**
 * Native Spracherkennung (Android SpeechRecognizer über JarvisNative.stt*).
 *
 * Eine einzige Erkennung gehört der App (JarvisNative): jeder Start beendet die vorige
 * sauber auf dem Haupt-Thread, alte Rückmeldungen werden über die Sitzungsnummer verworfen.
 * Das Wake-Word läuft über die Zustandsmaschine js/core/listen-loop.js (Pausen nach Stille,
 * exponentielles Warten nach Fehlern, Abbruch mit Hinweis nach wiederholten Fehlern).
 * Die Erlaubnis fürs Mikrofon fragt weiterhin das SpeechRecognition-Plugin ab.
 */
import { createListenLoop, ENDPOINT_POLICY } from '../js/core/listen-loop.js';

const SR = () => globalThis.Capacitor?.Plugins?.SpeechRecognition;
const J = () => globalThis.Capacitor?.Plugins?.JarvisNative;
const STT_ERRORS = {
  'not-allowed': 'Mikrofon-Zugriff verweigert. Bitte in den App-Einstellungen erlauben.',
  denied: 'Mikrofon-Zugriff verweigert. Bitte in den App-Einstellungen erlauben.',
  unavailable: 'Spracherkennung ist auf diesem Gerät nicht verfügbar.',
  language: 'Die Spracherkennung unterstützt Deutsch auf diesem Gerät gerade nicht (Sprachpaket fehlt?).'
};

/** Eine native Erkennung mit Ereignis-Weiterleitung nach Sitzungsnummer. */
export function createNativeEngine({ lang = 'de-DE', getMuteBeep = () => false, prefix = 'w' } = {}) {
  let seq = 0;
  let current = null;           // { id, h }
  let listenerP = null;

  const ensureListener = () => {
    if (!listenerP) {
      listenerP = Promise.resolve(J()?.addListener?.('sttEvent', (ev) => {
        const c = current;
        if (!c || !ev || ev.session !== c.id) return; // veraltete Sitzung
        const h = c.h;
        switch (ev.type) {
          case 'ready': h.onReady?.(); break;
          case 'partial': h.onPartial?.(ev.text || ''); break;
          case 'final': current = null; h.onFinal?.(ev.text || ''); break;
          case 'error':
            current = null;
            if (ev.kind === 'silence') h.onEnd?.({ reason: 'silence', code: ev.code });
            else h.onEnd?.({ reason: 'error', kind: ev.kind || 'retry', code: ev.code, message: ev.kind === 'fatal' ? fatalMessage(ev) : undefined });
            break;
          default: break;
        }
      })).catch(() => null);
    }
    return listenerP;
  };

  return {
    async start(h, { muteBeep } = {}) {
      const plugin = J();
      if (!plugin?.sttStart) { const e = new Error(STT_ERRORS.unavailable); e.kind = 'fatal'; throw e; }
      await ensureListener();
      const id = `${prefix}${Date.now().toString(36)}-${++seq}`;
      current = { id, h };
      try {
        // v0.9.6: kürzere Satzende-Erkennung (Hinweise an den Android-Erkenner, siehe ENDPOINT_POLICY)
        await plugin.sttStart({
          session: id, language: lang, partial: true,
          muteBeep: Boolean(muteBeep === undefined ? getMuteBeep() : muteBeep),
          completeSilenceMs: ENDPOINT_POLICY.completeSilenceMs,
          possiblyCompleteSilenceMs: ENDPOINT_POLICY.possiblyCompleteSilenceMs
        });
      } catch (e) {
        if (current?.id === id) current = null;
        const msg = String(e?.message || e);
        const err = new Error(STT_ERRORS[msg] || msg);
        err.kind = msg === 'not-allowed' || msg === 'unavailable' ? 'fatal' : 'retry';
        throw err;
      }
    },
    cancel() {
      current = null;
      try { J()?.sttCancel?.().catch?.(() => {}); } catch { /* egal */ }
    }
  };
}

function fatalMessage(ev) {
  if (ev.code === 9) return STT_ERRORS['not-allowed'];
  if (ev.code === 12 || ev.code === 13) return STT_ERRORS.language;
  return STT_ERRORS.unavailable;
}

export function createNativeSTT({ lang = 'de-DE', getMuteBeep = () => true } = {}) {
  const wakeEngine = createNativeEngine({ lang, getMuteBeep, prefix: 'w' });
  const onceEngine = createNativeEngine({ lang, prefix: 'o' }); // Mikrofon-Knopf: Startton bleibt hörbar
  let onceAbort = null;

  async function ensurePermission() {
    try {
      const r = await SR()?.requestPermissions?.();
      if (r && r.speechRecognition === 'denied') throw new Error('not-allowed');
    } catch (e) {
      if (e?.message === 'not-allowed') throw new Error(STT_ERRORS['not-allowed']);
    }
  }

  return {
    isSupported: () => Boolean(J()?.sttStart),

    async listenOnce({ onInterim, muteBeep } = {}) {
      if (!J()?.sttStart) throw new Error(STT_ERRORS.unavailable);
      await ensurePermission();
      return new Promise((resolve, reject) => {
        let last = '';
        let done = false;
        const finish = (fn) => { if (done) return; done = true; clearTimeout(t); onceAbort = null; fn(); };
        const t = setTimeout(() => { onceEngine.cancel(); finish(() => resolve(last.trim())); }, 12000);
        onceAbort = () => { onceEngine.cancel(); finish(() => resolve(last.trim())); };
        onceEngine.start({
          onPartial: (x) => { if (x) { last = x; onInterim?.(x); } },
          onFinal: (x) => finish(() => resolve(String(x || last).trim())),
          onEnd: (info) => finish(() => (info.reason === 'silence' || !info.kind || info.kind !== 'fatal'
            ? resolve(last.trim())
            : reject(new Error(info.message || STT_ERRORS.unavailable))))
        }, { muteBeep: Boolean(muteBeep) }).catch((e) => finish(() => reject(e)));
      });
    },

    startContinuous({ onFinal, onInterim, onState, onError }) {
      if (!J()?.sttStart) { onError?.(new Error(STT_ERRORS.unavailable)); return { stop() {} }; }
      let stopped = false;
      const loop = createListenLoop({
        engine: wakeEngine,
        onFinal, onInterim,
        onState: (s) => { if (s === 'listening') onState?.('listening'); else if (s === 'waiting') onState?.('restarting'); },
        onFatal: (e) => { if (!stopped) onError?.(e); }
      });
      ensurePermission().then(() => { if (!stopped) loop.start(); }, (e) => { if (!stopped) onError?.(e); });
      return {
        get state() { return loop.state; },
        stop() {
          if (stopped) return;
          stopped = true;
          loop.stop();
          onState?.('stopped');
        }
      };
    },

    abort() {
      if (onceAbort) onceAbort();
      else onceEngine.cancel();
    }
  };
}
