// Speicher-Schicht des Kerns. Der Kern kennt KEIN localStorage – er bekommt
// einen "Adapter" mit getItem/setItem/removeItem (Web: localStorage,
// später Android: SharedPreferences o. ä.).

/** Einfacher In-Memory-Adapter (für Tests oder als Notlösung). */
export function createMemoryAdapter(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k)
  };
}

/** Speichert JSON-Werte mit Präfix über einen beliebigen Adapter. */
export function createStore(adapter, prefix = 'jarvis.') {
  return {
    get(key, fallback) {
      try {
        const raw = adapter.getItem(prefix + key);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      adapter.setItem(prefix + key, JSON.stringify(value));
    },
    remove(key) {
      adapter.removeItem(prefix + key);
    }
  };
}
