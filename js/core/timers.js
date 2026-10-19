// Timer-Verwaltung. Speichert Endzeitpunkte, damit Timer ein Neuladen der
// App überstehen. Uhr und Scheduler sind injizierbar (Tests).

const KEY = 'timers';

export function createTimerManager({ store, onDone, now = () => Date.now(), schedule = setTimeout, unschedule = clearTimeout }) {
  const handles = new Map();
  let timers = store.get(KEY, []);

  const persist = () => store.set(KEY, timers);

  function arm(t) {
    const delay = Math.max(0, t.endsAt - now());
    handles.set(t.id, schedule(() => finish(t.id), delay));
  }

  function finish(id) {
    const t = timers.find((x) => x.id === id);
    timers = timers.filter((x) => x.id !== id);
    handles.delete(id);
    persist();
    if (t && onDone) onDone(t);
  }

  return {
    /** Startet einen Timer, gibt das Timer-Objekt zurück. */
    start(durationMs, label = '') {
      const t = { id: `t${now()}${Math.random().toString(36).slice(2, 6)}`, label, durationMs, endsAt: now() + durationMs };
      timers.push(t);
      persist();
      arm(t);
      return t;
    },
    /** Stoppt alle Timer, gibt die Anzahl zurück. */
    cancelAll() {
      const n = timers.length;
      handles.forEach((h) => unschedule(h));
      handles.clear();
      timers = [];
      persist();
      return n;
    },
    list() {
      return timers.map((t) => ({ ...t, remainingMs: Math.max(0, t.endsAt - now()) }));
    },
    /** Nach App-Start aufrufen: plant gespeicherte Timer wieder ein. */
    restore() {
      timers.forEach(arm);
    }
  };
}
