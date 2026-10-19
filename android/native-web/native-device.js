/** Device-Adapter: JarvisNative-Plugin + Capacitor Geolocation/Share/Haptics. */
const Cap = () => globalThis.Capacitor;
const J = () => Cap()?.Plugins?.JarvisNative;
const Geo = () => Cap()?.Plugins?.Geolocation;
const Share = () => Cap()?.Plugins?.Share;
const Haptics = () => Cap()?.Plugins?.Haptics;

export function createNativeDevice() {
  return {
    canOpenUrl: () => true,

    openUrl(url) {
      // tel:/sms:/mailto:/https: über Android Intents
      J()?.openUrl?.({ url }).catch(() => {
        window.open(url, '_blank');
      });
      return { ok: true };
    },

    canShare: () => Boolean(Share()?.share),

    async share({ title = '', text = '', url = '' } = {}) {
      try {
        await Share().share({ title, text, url: url || undefined, dialogTitle: title || 'Teilen' });
        return { ok: true };
      } catch (e) {
        if (/cancel|abort/i.test(e?.message || '')) return { ok: false, message: 'Teilen abgebrochen.' };
        return { ok: false, message: e.message };
      }
    },

    async vibrate(pattern = [200]) {
      try {
        if (J()?.vibrate) {
          await J().vibrate({ pattern });
          return { ok: true };
        }
        await Haptics()?.vibrate?.({ duration: pattern[0] || 200 });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    async getBattery() {
      try {
        const r = await J().getBattery();
        return { ok: true, level: r.level, charging: r.charging };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    async getLocation() {
      try {
        await Geo()?.requestPermissions?.();
        const pos = await Geo().getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
        return {
          ok: true,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
      } catch (e) {
        return { ok: false, message: e.message || 'Standortfehler.' };
      }
    },

    async copyText(text) {
      try {
        await J().copyText({ text });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },

    async setFlashlight(on) {
      try {
        const r = await J().setTorch({ on: Boolean(on) });
        if (r?.unsupported) return { ok: false, unsupported: true, message: r.message };
        return { ok: true };
      } catch (e) {
        return { ok: false, unsupported: true, message: e.message };
      }
    },

    // Extra native APIs used by extended tools
    async openApp(name) {
      try {
        const r = await J().openApp({ name });
        return r?.ok ? { ok: true, message: r.message } : { ok: false, message: r?.message || 'App nicht gefunden.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    async setSystemAlarm({ hour, minute, message }) {
      try {
        await J().setAlarm({ hour, minute, message: message || 'Jarvis Wecker' });
        return { ok: true, message: 'Wecker in der Uhr-App gesetzt.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    async setSystemTimer(seconds, message) {
      try {
        await J().setTimer({ seconds, message: message || 'Jarvis Timer' });
        return { ok: true, message: 'Timer in der Uhr-App gesetzt.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    async adjustVolume(direction) {
      try {
        await J().adjustVolume({ direction }); // up | down | mute
        return { ok: true, message: 'Lautstärke angepasst.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    async openSystemSettings(panel) {
      try {
        await J().openSettings({ panel }); // wifi | bluetooth | app
        return {
          ok: true,
          message: panel === 'wifi' || panel === 'bluetooth'
            ? 'Ich habe die Einstellungen geöffnet. Direkte Umschaltung ist seit Android 10 Apps nicht mehr erlaubt.'
            : 'Einstellungen geöffnet.'
        };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    }
  };
}
