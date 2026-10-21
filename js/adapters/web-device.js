// Plattform-Adapter für den Browser (Android Chrome). Später durch
// native Android-Implementierungen ersetzen – gleiche Methodennamen.
// Jede Methode liefert { ok, message?, ... } bzw. { ok:false, unsupported:true }.

let torchStream = null;
let torchTrack = null;

export function createWebDevice({ openExternal = (url) => { window.location.href = url; } } = {}) {
  return {
    canOpenUrl: () => typeof window !== 'undefined',

    openUrl(url) {
      try {
        // Über <a>.click(): verlässt die Seite nicht hart (wichtig für PWA/Tests),
        // löst auf Android aber trotzdem die Telefon-/SMS-/Browser-App aus.
        const a = document.createElement('a');
        a.href = url;
        a.rel = 'noopener';
        if (/^https?:/i.test(url)) a.target = '_blank';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return { ok: true };
      } catch (e) {
        try { openExternal(url); return { ok: true }; }
        catch (err) { return { ok: false, message: err.message }; }
      }
    },

    canShare() {
      return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    },

    async share({ title = '', text = '', url = '' } = {}) {
      try {
        await navigator.share({ title, text, url: url || undefined });
        return { ok: true };
      } catch (e) {
        if (e.name === 'AbortError') return { ok: false, message: 'Teilen abgebrochen.' };
        return { ok: false, message: e.message };
      }
    },

    async vibrate(pattern = [200]) {
      try {
        if (!navigator.vibrate) return { ok: false, message: 'Vibration wird nicht unterstützt.' };
        navigator.vibrate(pattern);
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    async getBattery() {
      try {
        if (!navigator.getBattery) return { ok: false, unsupported: true, message: 'Akku-API nicht verfügbar.' };
        const b = await navigator.getBattery();
        return { ok: true, level: b.level, charging: b.charging };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    /**
     * Grober Standort fürs Wetter (kein GPS-Zwang, 30 min Cache des Browsers).
     * interactive=false → nur wenn die Erlaubnis schon erteilt ist (kein Dialog beim Auto-Briefing).
     */
    async getCoarseLocation({ interactive = true } = {}) {
      try {
        if (!navigator.geolocation) return { ok: false, unsupported: true, message: 'Standort nicht verfügbar.' };
        let state = 'prompt';
        try { state = (await navigator.permissions?.query?.({ name: 'geolocation' }))?.state || 'prompt'; } catch { /* egal */ }
        if (state === 'denied') return { ok: false, denied: true, message: 'Standort-Erlaubnis verweigert.' };
        if (state !== 'granted' && !interactive) return { ok: false, denied: false, needsPrompt: true, message: 'Standort-Erlaubnis noch nicht erteilt.' };
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60000
          });
        });
        return { ok: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch (e) {
        return { ok: false, denied: e?.code === 1, message: e?.code === 1 ? 'Standort-Erlaubnis verweigert.' : 'Standort derzeit nicht verfügbar.' };
      }
    },

    async getLocation() {
      try {
        if (!navigator.geolocation) return { ok: false, unsupported: true, message: 'Standort nicht verfügbar.' };
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 15000, maximumAge: 60000
          });
        });
        return {
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
      } catch (e) {
        const map = {
          1: 'Standort-Erlaubnis verweigert. Bitte in Chrome unter Website-Einstellungen erlauben.',
          2: 'Standort derzeit nicht verfügbar.',
          3: 'Standort-Abfrage hat zu lange gedauert.'
        };
        return { ok: false, message: map[e.code] || e.message || 'Standortfehler.' };
      }
    },

    async copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return { ok: true };
        }
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok ? { ok: true } : { ok: false, message: 'Kopieren nicht möglich.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    // ---------- v0.9 W2: Dateien ----------
    /** Speichern als Download (Blob). Der Browser fragt je nach Einstellung nach dem Ort. */
    async saveTextFile({ name, mime, text }) {
      try {
        const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return { ok: true, name, message: `„${name}“ wird heruntergeladen.` };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    /** Datei-Auswahl im Browser braucht einen Tipp → das Werkzeug zeigt vorher eine Karte. */
    filePickNeedsGesture: true,

    /** <input type=file>: liest nur Textdateien bis 256 KB (größere werden gar nicht erst gelesen). */
    pickTextFile() {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.md,.markdown,.json,text/plain,text/markdown,application/json';
        input.style.display = 'none';
        let done = false;
        const finish = (r) => { if (done) return; done = true; input.remove(); resolve(r); };
        input.addEventListener('cancel', () => finish({ ok: false, cancelled: true }));
        input.addEventListener('change', async () => {
          const f = input.files?.[0];
          if (!f) return finish({ ok: false, cancelled: true });
          const meta = { ok: true, name: f.name, mime: f.type, size: f.size };
          if (f.size > 256 * 1024) return finish({ ...meta, text: '' });
          try { finish({ ...meta, text: await f.text() }); } catch (e) { finish({ ok: false, message: e.message }); }
        });
        document.body.appendChild(input);
        input.click();
      });
    },

    /** Teilen als Datei (Web Share Level 2); sonst ehrlich: Download statt Teilen. */
    async shareTextFile({ name, mime, text }) {
      try {
        const file = new File([text], name, { type: mime });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return { ok: true, message: 'Geteilt.' };
        }
      } catch (e) {
        if (e.name === 'AbortError') return { ok: false, message: 'Teilen abgebrochen.' };
      }
      const r = await this.saveTextFile({ name, mime, text });
      return r.ok ? { ok: true, message: `Dieser Browser kann keine Dateien teilen – ich habe „${name}“ stattdessen heruntergeladen.` } : r;
    },

    async setFlashlight(on) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          return { ok: false, unsupported: true };
        }
        if (on) {
          if (!torchTrack) {
            torchStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' }
            });
            torchTrack = torchStream.getVideoTracks()[0];
          }
          const caps = torchTrack.getCapabilities?.() || {};
          if (!caps.torch) {
            await this.setFlashlight(false);
            return { ok: false, unsupported: true, message: 'Dieses Gerät/dieser Browser erlaubt keine Taschenlampe.' };
          }
          await torchTrack.applyConstraints({ advanced: [{ torch: true }] });
          return { ok: true };
        }
        if (torchTrack) {
          try { await torchTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch { /* egal */ }
          torchTrack.stop();
          torchStream?.getTracks()?.forEach((t) => t.stop());
          torchTrack = null;
          torchStream = null;
        }
        return { ok: true };
      } catch (e) {
        torchTrack = null;
        torchStream = null;
        if (/Permission|NotAllowed/i.test(e.name || e.message || '')) {
          return { ok: false, message: 'Kamera-Erlaubnis nötig für die Taschenlampe – und selbst dann unterstützen viele Browser sie nicht.' };
        }
        return { ok: false, unsupported: true, message: e.message };
      }
    }
  };
}
