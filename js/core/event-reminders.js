// v0.9.4: Proaktive Termin-Hinweise (nur Android-App). Hier nur Einstellungen + Sprachbefehle –
// die eigentliche Planung (Kalender-Scan → ein Alarm zum nächsten Hinweis) macht der native Teil
// (com.jarvis.assistant.events). Ohne Abhängigkeiten, damit auch settings.js es nutzen kann.
import { normalizeText } from './wakeword.js';

export const EVENT_LEAD_OPTIONS = [5, 10, 15, 30, 60];

export const DEFAULT_EVENT_REMINDERS = Object.freeze({
  enabled: true,   // wirkt erst mit Kalender-Erlaubnis (Android)
  leadMin: 15,
  speak: false     // Vorlesen nur zusätzlich und nur mit „Im Hintergrund bereithalten“
});

/** Nächstliegende erlaubte Vorlaufzeit (5/10/15/30/60 Min.), sonst 15. */
export function clampLead(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EVENT_REMINDERS.leadMin;
  return EVENT_LEAD_OPTIONS.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), EVENT_LEAD_OPTIONS[0]);
}

export function normalizeEventRemindersConfig(c = {}) {
  const src = c && typeof c === 'object' ? c : {};
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_EVENT_REMINDERS.enabled,
    leadMin: src.leadMin === undefined ? DEFAULT_EVENT_REMINDERS.leadMin : clampLead(src.leadMin),
    speak: typeof src.speak === 'boolean' ? src.speak : DEFAULT_EVENT_REMINDERS.speak
  };
}

const SUBJ = '(?:termin ?hinweise?|termin ?erinnerungen?|termin ?benachrichtigungen?|hinweise? (?:vor|zu) (?:den |meinen )?terminen)';
const OFF = new RegExp(`^(?:bitte )?(?:${SUBJ} (?:aus|ausschalten|deaktivieren|abschalten|stoppen)|(?:schalte|mach) (?:die )?${SUBJ} (?:aus|ab))(?: bitte)?$`);
const ON = new RegExp(`^(?:bitte )?(?:${SUBJ} (?:an|ein|einschalten|aktivieren)|(?:schalte|mach) (?:die )?${SUBJ} (?:an|ein))(?: bitte)?$`);
const LEAD = new RegExp(`^(?:bitte )?${SUBJ} (\\d{1,2}) ?(?:min|minuten) (?:vorher|davor|frueher)(?: bitte)?$`);

/**
 * „Terminhinweise aus/an“, „Terminhinweise 30 Minuten vorher“.
 * Gibt die Antwort zurück (und speichert über save) oder null, wenn kein Befehl.
 */
export function eventRemindersCommand(text, cfg, save) {
  const t = normalizeText(text);
  const cur = normalizeEventRemindersConfig(cfg);
  if (OFF.test(t)) {
    save({ ...cur, enabled: false });
    return 'In Ordnung, ich melde mich nicht mehr von selbst vor Terminen. Mit „Terminhinweise an“ schalten Sie es wieder ein.';
  }
  if (ON.test(t)) {
    save({ ...cur, enabled: true });
    return `Gern – in der Android-App melde ich mich etwa ${cur.leadMin} Minuten vor jedem Termin aus Ihrem Kalender (dafür braucht Jarvis die Kalender-Erlaubnis).`;
  }
  const m = t.match(LEAD);
  if (m) {
    const lead = clampLead(Number(m[1]));
    save({ ...cur, enabled: true, leadMin: lead });
    return `Erledigt – ich melde mich ab jetzt ${lead} Minuten vor Ihren Terminen.`;
  }
  return null;
}
