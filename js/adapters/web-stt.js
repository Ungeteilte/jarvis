// SpeechToText-Adapter (Web Speech API: SpeechRecognition, de-DE).
// Schnittstelle:
//   isSupported(): boolean
//   listenOnce({onInterim}): Promise<string>    – ein Satz (Mikrofon-Knopf)
//   startContinuous({onFinal, onInterim, onState, onError}) → {stop()}
//       – Dauerhören für das Wake-Word, startet bei Abbruch automatisch neu.

const Recognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : undefined;

function make({ continuous, lang }) {
  const r = new Recognition();
  r.lang = lang;
  r.continuous = continuous;
  r.interimResults = true;
  r.maxAlternatives = 1;
  return r;
}

export const STT_ERRORS = {
  'not-allowed': 'Mikrofon-Zugriff verweigert. Bitte in Chrome erlauben (Schloss-Symbol → Berechtigungen).',
  'service-not-allowed': 'Spracherkennung nicht erlaubt (HTTPS nötig?).',
  'audio-capture': 'Kein Mikrofon gefunden.',
  network: 'Spracherkennung braucht eine Internetverbindung.',
  'language-not-supported': 'Deutsch wird von der Spracherkennung nicht unterstützt.'
};

export function createWebSTT({ lang = 'de-DE' } = {}) {
  let active = null; // aktuelle Erkennung (nur eine gleichzeitig möglich)

  function stopActive() {
    if (active) { try { active.abort(); } catch { /* egal */ } active = null; }
  }

  return {
    isSupported: () => Boolean(Recognition),

    listenOnce({ onInterim } = {}) {
      return new Promise((resolve, reject) => {
        if (!Recognition) return reject(new Error('Spracherkennung wird von diesem Browser nicht unterstützt.'));
        stopActive();
        const r = make({ continuous: false, lang });
        active = r;
        let finalText = '';
        let lastInterim = '';
        r.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) finalText += res[0].transcript;
            else interim += res[0].transcript;
          }
          lastInterim = interim || lastInterim;
          onInterim?.(finalText + interim);
        };
        r.onerror = (e) => {
          if (e.error === 'no-speech' || e.error === 'aborted') return; // → onend liefert ''
          active = null;
          reject(new Error(STT_ERRORS[e.error] || `Spracherkennungsfehler: ${e.error}`));
        };
        r.onend = () => {
          if (active === r) active = null;
          resolve((finalText || lastInterim).trim());
        };
        try { r.start(); } catch (err) { reject(err); }
      });
    },

    /**
     * Dauerhören. Android-Chrome beendet die Erkennung nach einigen Sekunden
     * Stille (und spielt dabei ggf. einen Systemton) – wir starten automatisch
     * neu, mit wachsender Pause bei wiederholten Fehlern.
     */
    startContinuous({ onFinal, onInterim, onState, onError }) {
      if (!Recognition) { onError?.(new Error('Spracherkennung wird nicht unterstützt.')); return { stop() {} }; }
      let stopped = false;
      let failures = 0;
      let restartTimer = null;
      let rec = null;

      const start = () => {
        if (stopped) return;
        stopActive();
        rec = make({ continuous: true, lang });
        active = rec;
        rec.onstart = () => onState?.('listening');
        rec.onresult = (e) => {
          failures = 0;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const text = res[0].transcript.trim();
            if (res.isFinal) onFinal?.(text);
            else onInterim?.(text);
          }
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            stopped = true;
            onError?.(new Error(STT_ERRORS[e.error]));
            return;
          }
          if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
        };
        rec.onend = () => {
          if (active === rec) active = null;
          if (stopped) { onState?.('stopped'); return; }
          onState?.('restarting');
          const delay = Math.min(250 * 2 ** failures, 10000);
          restartTimer = setTimeout(start, delay);
        };
        try { rec.start(); } catch { failures++; restartTimer = setTimeout(start, 1000); }
      };
      start();

      return {
        stop() {
          stopped = true;
          clearTimeout(restartTimer);
          if (rec && active === rec) stopActive();
          onState?.('stopped');
        }
      };
    },

    abort: stopActive
  };
}
