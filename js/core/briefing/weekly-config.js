// Einstellungen der Wochenzusammenfassung (ohne Abhängigkeiten – auch für settings.js).
// Sonntags ersetzt sie die Abendzusammenfassung (kein doppelter Rückblick an einem Abend).
export const WEEKLY_HOUR_OPTIONS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

export const DEFAULT_WEEKLY = Object.freeze({
  enabled: true,
  hour: 18
});

export function normalizeWeeklyConfig(c = {}) {
  const src = c && typeof c === 'object' ? c : {};
  const n = Math.round(Number(src.hour));
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_WEEKLY.enabled,
    hour: Number.isFinite(n) ? Math.min(21, Math.max(9, n)) : DEFAULT_WEEKLY.hour
  };
}
