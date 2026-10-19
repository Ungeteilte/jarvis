/**
 * Native Spracherkennung (Android SpeechRecognizer) –
 * ohne Chrome-Systempiepen beim Neustart.
 */
const SR = () => globalThis.Capacitor?.Plugins?.SpeechRecognition;
const STT_ERRORS = {
  'not-allowed': 'Mikrofon-Zugriff verweigert. Bitte in den App-Einstellungen erlauben.',
  denied: 'Mikrofon-Zugriff verweigert. Bitte in den App-Einstellungen erlauben.',
  unavailable: 'Spracherkennung ist auf diesem Gerät nicht verfügbar.'
};

export function createNativeSTT({ lang = 'de-DE' } = {}) {
  let active = false;
  let handle = null;

  return {
    isSupported: () => Boolean(SR()),

    async listenOnce({ onInterim } = {}) {
      if (!SR()) throw new Error(STT_ERRORS.unavailable);
      await SR().requestPermissions?.();
      const avail = await SR().available?.();
      if (avail && avail.available === false) throw new Error(STT_ERRORS.unavailable);

      return new Promise(async (resolve, reject) => {
        let finalText = '';
        let last = '';
        const partial = await SR().addListener('partialResults', (data) => {
          const t = (data.matches && data.matches[0]) || '';
          if (t) { last = t; onInterim?.(t); }
        });
        const stateLis = await SR().addListener?.('listeningState', () => {});
        try {
          active = true;
          await SR().start({
            language: lang,
            maxResults: 3,
            prompt: 'Jarvis hört zu',
            partialResults: true,
            popup: false
          });
          // Warte auf Ende: Plugin feuert oft partial; wir poll isListening
          const started = Date.now();
          const tick = async () => {
            try {
              const { listening } = await SR().isListening?.() || { listening: false };
              if (!listening && Date.now() - started > 600) {
                cleanup();
                resolve((finalText || last).trim());
                return;
              }
            } catch { /* weiter */ }
            if (Date.now() - started > 12000) {
              try { await SR().stop(); } catch { /* */ }
              cleanup();
              resolve((finalText || last).trim());
              return;
            }
            setTimeout(tick, 250);
          };
          const cleanup = () => {
            active = false;
            partial?.remove?.();
            stateLis?.remove?.();
          };
          // Manche Builds liefern das Ergebnis über partialResults als final beim Stop
          setTimeout(tick, 400);
        } catch (e) {
          active = false;
          partial?.remove?.();
          reject(new Error(STT_ERRORS[e?.message] || e.message || String(e)));
        }
      });
    },

    startContinuous({ onFinal, onInterim, onState, onError }) {
      if (!SR()) { onError?.(new Error(STT_ERRORS.unavailable)); return { stop() {} }; }
      let stopped = false;
      let partialLis;
      let restartTimer;

      const loop = async () => {
        if (stopped) return;
        try {
          await SR().requestPermissions?.();
          partialLis?.remove?.();
          partialLis = await SR().addListener('partialResults', (data) => {
            const t = (data.matches && data.matches[0]) || '';
            if (t) onInterim?.(t);
          });
          onState?.('listening');
          await SR().start({
            language: lang,
            maxResults: 3,
            partialResults: true,
            popup: false
          });
          // Segment: warte bis Stille / stop, dann Final + Neustart
          const waitEnd = async () => {
            const t0 = Date.now();
            let lastSpeech = Date.now();
            let buf = '';
            const iv = setInterval(async () => {
              if (stopped) { clearInterval(iv); return; }
              try {
                const { listening } = await SR().isListening?.() || { listening: true };
                if (!listening) {
                  clearInterval(iv);
                  const text = buf.trim();
                  if (text) onFinal?.(text);
                  onState?.('restarting');
                  restartTimer = setTimeout(loop, 350);
                }
              } catch {
                clearInterval(iv);
                restartTimer = setTimeout(loop, 800);
              }
              if (Date.now() - t0 > 15000) {
                clearInterval(iv);
                try { await SR().stop(); } catch { /* */ }
              }
            }, 300);
            // partial → buf
            partialLis?.remove?.();
            partialLis = await SR().addListener('partialResults', (data) => {
              const t = (data.matches && data.matches[0]) || '';
              if (t) { buf = t; lastSpeech = Date.now(); onInterim?.(t); }
            });
          };
          await waitEnd();
        } catch (e) {
          if (stopped) return;
          onError?.(new Error(e.message || String(e)));
          restartTimer = setTimeout(loop, 1500);
        }
      };

      SR().requestPermissions?.().then(loop).catch((e) => onError?.(e));

      return {
        stop() {
          stopped = true;
          clearTimeout(restartTimer);
          partialLis?.remove?.();
          SR().stop?.().catch(() => {});
          onState?.('stopped');
        }
      };
    },

    abort() {
      try { SR()?.stop?.(); } catch { /* */ }
    }
  };
}
