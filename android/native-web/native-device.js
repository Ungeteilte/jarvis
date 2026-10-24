/** Device-Adapter: JarvisNative-Plugin + Capacitor Geolocation/Share/Haptics. */
const Cap = () => globalThis.Capacitor;
const J = () => Cap()?.Plugins?.JarvisNative;
const Geo = () => Cap()?.Plugins?.Geolocation;
const Share = () => Cap()?.Plugins?.Share;
const Haptics = () => Cap()?.Plugins?.Haptics;
const LN = () => Cap()?.Plugins?.LocalNotifications;
let reminderChannel = false;
/** Plugin-Methode sicher aufrufen (fehlt sie oder schlägt sie fehl → fallback). */
const jcall = (fn, args, fallback = null) => {
  try {
    const p = J();
    if (!p || typeof p[fn] !== 'function') return Promise.resolve(fallback);
    return Promise.resolve(p[fn](args)).catch((e) => (fallback === null ? null : { ...fallback, error: e?.message }));
  } catch { return Promise.resolve(fallback); }
};

export function createNativeDevice() {
  let appCache = null; // Launcher-Liste (v0.9 W1), gilt für diese Sitzung
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

    /** Grober Standort fürs Wetter. interactive=false → nie einen Erlaubnis-Dialog öffnen. */
    async getCoarseLocation({ interactive = true } = {}) {
      try {
        let perm = null;
        try { perm = await Geo()?.checkPermissions?.(); } catch { perm = null; }
        const granted = (p) => p && (p.location === 'granted' || p.coarseLocation === 'granted');
        if (!granted(perm)) {
          if (!interactive) return { ok: false, denied: perm?.location === 'denied', needsPrompt: true, message: 'Standort-Erlaubnis fehlt.' };
          perm = await Geo()?.requestPermissions?.({ permissions: ['location', 'coarseLocation'] });
          if (!granted(perm)) return { ok: false, denied: true, message: 'Standort-Erlaubnis verweigert.' };
        }
        const pos = await Geo().getCurrentPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 30 * 60000 });
        return { ok: true, latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch (e) {
        return { ok: false, message: e?.message || 'Standort derzeit nicht verfügbar.' };
      }
    },

    /** Termine aus dem Gerätekalender (READ_CALENDAR). dayOffset 0 = heute, 1 = morgen. */
    async getCalendarEvents({ dayOffset = 0, days = 1, interactive = true } = {}) {
      try {
        const r = await J().getCalendarEvents({ dayOffset, days, interactive });
        return r?.ok ? { ok: true, events: r.events || [] } : { ok: false, permission: r?.permission, message: r?.message };
      } catch (e) {
        return { ok: false, message: e?.message || 'Kalender nicht lesbar.' };
      }
    },

    /** Brücke zum nativen Morgen-Briefing (Hintergrund-Dienst, Benachrichtigungen, Akku). */
    briefing: {
      sync: (payload) => jcall('syncBriefing', { json: JSON.stringify(payload) }),
      getState: () => jcall('getBriefingState'),
      setBackground: (enabled) => jcall('setBriefingBackground', { enabled: Boolean(enabled) }, { ok: false }),
      status: () => jcall('getBriefingStatus'),
      requestNotifications: () => jcall('requestNotificationPermission'),
      requestCalendar: () => jcall('getCalendarEvents', { dayOffset: 0, interactive: true }),
      requestLocation: () => Promise.resolve(Geo()?.requestPermissions?.({ permissions: ['location', 'coarseLocation'] })).catch(() => null),
      requestIgnoreBattery: () => jcall('requestIgnoreBatteryOptimizations'),
      openAppSettings: () => jcall('openSettings', { panel: 'app' }),
      consumeLaunch: () => jcall('consumeBriefingLaunch'),
      onLaunch: (cb) => { try { J()?.addListener?.('briefingLaunch', cb); } catch { /* egal */ } }
    },

    // v0.9 Stufe 0: „Jarvis fragen“ (Kachel, Verknüpfung, jarvis://zuhoeren) – kein Hintergrund-Zuhören
    listenLaunch: {
      consume: () => jcall('consumeListenLaunch'),
      onLaunch: (cb) => { try { J()?.addListener?.('listenLaunch', cb); } catch { /* egal */ } },
      pinShortcut: () => jcall('pinListenShortcut'),
      addTile: () => jcall('requestAddListenTile')
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
    // ---------- v0.9 W5: Medien, Lautstärke %, Gerätestatus, Kalender-Entwurf ----------
    async mediaKey(action) {
      const r = await jcall('mediaKey', { action }, { ok: false, message: 'Musik steuern ist nicht verfügbar.' });
      return r || { ok: false, message: 'Musik steuern ist nicht verfügbar.' };
    },
    async setVolumePercent(percent) {
      const r = await jcall('setVolumePercent', { percent }, { ok: false, message: 'Lautstärke ist nicht verfügbar.' });
      return r || { ok: false, message: 'Lautstärke ist nicht verfügbar.' };
    },
    async getDeviceStatus() {
      const r = await jcall('getDeviceStatus', {}, { ok: false, message: 'Gerätestatus ist nicht verfügbar.' });
      return r || { ok: false, message: 'Gerätestatus ist nicht verfügbar.' };
    },
    async calendarDraft({ title, begin, end, location }) {
      const r = await jcall('calendarDraft', { title, begin, end, location }, { ok: false, message: 'Die Kalender-App ließ sich nicht öffnen.' });
      return r || { ok: false, message: 'Die Kalender-App ließ sich nicht öffnen.' };
    },

    // ---------- v0.9 W4: Erinnerungen über @capacitor/local-notifications (Kanal reminder_v1) ----------
    // Das Plugin plant nach einem Neustart selbst neu (LocalNotificationRestoreReceiver) und weicht ohne
    // „Wecker & Erinnerungen“-Freigabe auf ungenaue Alarme aus – das sagen wir ehrlich (exact:false).
    reminders: {
      async schedule({ id, text, at }) {
        const ln = LN();
        if (!ln) return { ok: false, message: 'Erinnerungen sind auf diesem Gerät nicht verfügbar.' };
        try {
          let perm = await ln.checkPermissions();
          if (perm?.display !== 'granted') perm = await ln.requestPermissions();
          if (perm?.display !== 'granted') {
            return { ok: false, denied: true, message: 'Benachrichtigungen sind für Jarvis ausgeschaltet – so kann ich Sie nicht erinnern. Bitte in den Android-Einstellungen erlauben.' };
          }
          if (!reminderChannel) {
            await ln.createChannel({ id: 'reminder_v1', name: 'Erinnerungen', description: 'Erinnerungen, die Sie bei Jarvis gestellt haben', importance: 4, visibility: 1, vibration: true });
            reminderChannel = true;
          }
          await ln.schedule({ notifications: [{ id, title: 'Erinnerung', body: text, channelId: 'reminder_v1', schedule: { at: new Date(at), allowWhileIdle: true }, extra: { jarvisReminder: id } }] });
          const ex = await this.exactStatus();
          return { ok: true, exact: ex.exact !== 'denied' };
        } catch (e) {
          return { ok: false, message: 'Die Erinnerung konnte nicht geplant werden.' };
        }
      },
      async cancel(id) {
        try { await LN()?.cancel({ notifications: [{ id }] }); return { ok: true }; } catch { return { ok: false }; }
      },
      /** 'granted' | 'denied' | 'unknown' (vor Android 12 immer erlaubt). */
      async exactStatus() {
        try {
          const r = await LN()?.checkExactNotificationSetting?.();
          return { exact: r?.exact_alarm === 'denied' ? 'denied' : r?.exact_alarm === 'granted' ? 'granted' : 'unknown' };
        } catch { return { exact: 'unknown' }; }
      },
      /** Öffnet „Wecker & Erinnerungen“ für Jarvis (Android 12+). */
      async openExactSettings() {
        try { const r = await LN()?.changeExactNotificationSetting?.(); return { ok: true, exact: r?.exact_alarm || 'unknown' }; } catch (e) { return { ok: false, message: e.message }; }
      }
    },

    // ---------- v0.9 W2: Dateien über das Storage Access Framework (System-Dialog) ----------
    async saveTextFile({ name, mime, text }) {
      const r = await jcall('saveDocument', { name, mime, text }, { ok: false, message: 'Speichern nicht verfügbar.' });
      return r || { ok: false, message: 'Speichern nicht verfügbar.' };
    },
    async pickTextFile() {
      const r = await jcall('openTextDocument', {}, { ok: false, message: 'Datei-Auswahl nicht verfügbar.' });
      return r || { ok: false, message: 'Datei-Auswahl nicht verfügbar.' };
    },
    async shareTextFile({ name, mime, text }) {
      const r = await jcall('shareTextFile', { name, mime, text }, { ok: false, message: 'Teilen nicht verfügbar.' });
      return r || { ok: false, message: 'Teilen nicht verfügbar.' };
    },
    /** v0.9 W1: startbare Apps (Launcher-Einträge) – pro Sitzung zwischengespeichert. */
    async listApps() {
      if (appCache) return { ok: true, apps: appCache };
      try {
        const r = await J().listLaunchableApps();
        if (!r?.ok) return { ok: false, message: r?.message || 'App-Liste nicht lesbar.' };
        appCache = Array.isArray(r.apps) ? r.apps : [];
        return { ok: true, apps: appCache };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    /** Startet genau dieses Paket (nativ nur, wenn es in der Launcher-Liste steht). */
    async launchApp(pkg, label) {
      try {
        const r = await J().launchPackage({ package: pkg });
        if (r?.ok) return { ok: true, message: `Ich öffne ${label || 'die App'}.` };
        appCache = null; // evtl. deinstalliert → beim nächsten Mal neu laden
        return { ok: false, message: r?.message || 'Diese App kann ich nicht starten.' };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    /** Vorlesen des Hintergrund-Dienstes (Briefing/Rückblick) beginnt/endet → cb(true|false). */
    onBackgroundSpeech(cb) {
      try { J()?.addListener?.('backgroundSpeech', (e) => cb(Boolean(e?.speaking))); } catch { /* egal */ }
    },
    async setSystemAlarm({ hour, minute, message }) {
      try {
        const r = await J().setAlarm({ hour, minute, message: message || 'Jarvis Wecker' });
        // opened=true: Uhr-App hat das Stellen im Hintergrund abgelehnt und wurde mit vorausgefüllter Zeit
        // geöffnet – der Wecker gilt erst, wenn der Nutzer dort „Speichern“ tippt.
        if (r && r.opened) return { ok: true, opened: true, message: 'Uhr-App mit vorausgefüllter Zeit geöffnet.' };
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
