// Einstellungen der Abendzusammenfassung (ohne Abhängigkeiten – auch für settings.js).
const MIN = 60000;
export const EVENING_START_OPTIONS = [17, 18, 19, 20, 21, 22];
/** Kurz nach einem Morgen-Briefing (z. B. Spätgrenze 23 Uhr) nicht gleich noch einen Rückblick. */
export const EVENING_AFTER_BRIEFING_MS = 60 * MIN;

export const DEFAULT_EVENING = Object.freeze({
  enabled: true,
  startHour: 19,
  content: Object.freeze({ chats: true, notes: true, timers: true, calendar: true, weather: true, news: true })
});

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export function normalizeEveningConfig(c = {}) {
  const src = c && typeof c === 'object' ? c : {};
  const content = { ...DEFAULT_EVENING.content };
  for (const k of Object.keys(content)) if (typeof src.content?.[k] === 'boolean') content[k] = src.content[k];
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_EVENING.enabled,
    startHour: clampInt(src.startHour, 17, 22, DEFAULT_EVENING.startHour),
    content
  };
}

