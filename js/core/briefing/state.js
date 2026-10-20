// Gespeicherter Briefing-Zustand (über den Storage-Adapter des Kerns).
//  lastActiveAt, lastLongRest, lastBriefingDay, lastBriefingAt, coords {lat, lon, at, tz}
const KEY = 'briefingState';

export const loadBriefingState = (store) => {
  const s = store.get(KEY, {});
  return s && typeof s === 'object' ? s : {};
};

export function saveBriefingState(store, patch) {
  const next = { ...loadBriefingState(store), ...patch };
  store.set(KEY, next);
  return next;
}

export const COORDS_FRESH_MS = 6 * 3600000;
export const COORDS_MAX_AGE_MS = 72 * 3600000;

/** Koordinaten auf 2 Nachkommastellen (~1 km) runden – mehr braucht das Wetter nicht. */
export const roundCoord = (v) => Math.round(Number(v) * 100) / 100;

/** Gespeicherten Ort bewerten: 'fresh' | 'stale' | null (zu alt / andere Zeitzone / ungültig). */
export function rateCachedCoords(coords, nowMs, timeZone) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon) || !coords.at) return null;
  const age = nowMs - coords.at;
  if (age < 0 || age > COORDS_MAX_AGE_MS) return null;
  if (coords.tz && timeZone && coords.tz !== timeZone) return null;
  return age <= COORDS_FRESH_MS ? 'fresh' : 'stale';
}
