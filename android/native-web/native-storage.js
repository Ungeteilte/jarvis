/**
 * Sync-fähiger Storage-Adapter (der Kern erwartet getItem/setItem synchron).
 * Werte werden beim Start aus dem sicheren Speicher geladen und bei setItem
 * asynchron zurückgeschrieben (EncryptedSharedPreferences).
 */
const Cap = () => globalThis.Capacitor;
const J = () => Cap()?.Plugins?.JarvisNative;
const Prefs = () => Cap()?.Plugins?.Preferences;

const PREFIX_HINT = 'jarvis.';

/** Lädt bekannte Schlüssel (und alles aus Preferences.keys falls verfügbar). */
export async function hydrateNativeStorage() {
  const data = new Map();
  const keys = [
    'jarvis.persona', 'jarvis.settings', 'jarvis.history', 'jarvis.notes', 'jarvis.timers', 'jarvis.briefingState'
  ];
  try {
    if (Prefs()?.keys) {
      const { keys: all } = await Prefs().keys();
      for (const k of all || []) if (!keys.includes(k)) keys.push(k);
    }
  } catch { /* egal */ }

  for (const key of keys) {
    try {
      let value = null;
      if (J()?.secureGet) {
        const r = await J().secureGet({ key });
        value = r?.value ?? null;
      } else if (Prefs()) {
        const r = await Prefs().get({ key });
        value = r?.value ?? null;
      }
      if (value != null) data.set(key, value);
    } catch { /* Schlüssel überspringen */ }
  }
  return data;
}

export function createNativeStorageAdapter(initialMap = new Map()) {
  const data = initialMap;
  const persist = (key, value) => {
    const run = async () => {
      try {
        if (value == null) {
          if (J()?.secureRemove) await J().secureRemove({ key });
          else await Prefs()?.remove?.({ key });
        } else if (J()?.secureSet) {
          await J().secureSet({ key, value: String(value) });
        } else {
          await Prefs()?.set?.({ key, value: String(value) });
        }
      } catch (e) {
        console.warn('[Jarvis] Speicher-Schreiben fehlgeschlagen', key, e);
      }
    };
    run();
  };

  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); persist(k, v); },
    removeItem: (k) => { data.delete(k); persist(k, null); }
  };
}
