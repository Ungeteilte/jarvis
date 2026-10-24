// Wann startet das Morgen-Briefing von selbst? Reine Logik (browser-frei, testbar).
// Spiegel in Java: android/.../briefing/BriefingRules.java – gleiche Fälle in
// tests/fixtures/briefing-rules.json (beide Seiten prüfen dieselbe Datei).
//
// Regeln (ohne feste Uhrzeit):
//  - Der „Briefing-Tag“ beginnt um 03:00 Uhr Ortszeit (vorher zählt noch der Vortag).
//  - Zwischen 23:00 und 03:00 nie automatisch; nach der einstellbaren Spätgrenze (Standard 14 Uhr) auch nicht.
//  - Regel A: seit der letzten Aktivität mindestens `gapHours` Pause (03–05 Uhr: 1,5-fach).
//  - Regel B: ab 06:00 Uhr, wenn nach nächtlicher Nutzung (23–05 Uhr) ≥ 3 h Ruhe war
//    oder heute (seit 03:00) schon eine Ruhephase ≥ 3 h zu Ende ging.
//  - Erster Start (keine Aktivität bekannt) → nie automatisch.

const H = 3600000;
export const DAY_START_HOUR = 3;
export const NIGHT_LOCK_HOUR = 23;
export const EARLY_END_HOUR = 5;
export const RULE_B_MIN_HOUR = 6;
export const REST_MS = 3 * H;
export const GAP_OPTIONS = [3, 4, 5, 6, 7, 8];
export const LATEST_OPTIONS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

const fmtCache = new Map();
function formatter(timeZone) {
  const k = timeZone || '';
  if (!fmtCache.has(k)) {
    fmtCache.set(k, new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
  }
  return fmtCache.get(k);
}

/** Ortszeit-Bestandteile eines Zeitpunkts (ms) in einer Zeitzone (undefined = Gerät). */
export function localParts(ms, timeZone) {
  const p = {};
  for (const x of formatter(timeZone).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, min: +p.minute };
}

const pad = (n) => String(n).padStart(2, '0');

/** „2026-10-20“ – vor 03:00 Uhr noch der Vortag. */
export function dayKey(ms, timeZone) {
  const p = localParts(ms, timeZone);
  let { y, m, d } = p;
  if (p.h < DAY_START_HOUR) {
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

export const DEFAULT_BRIEFING = Object.freeze({
  enabled: true,
  gapHours: 4,
  latestHour: 14,
  content: Object.freeze({ weather: true, calendar: true, news: true, battery: true, notes: true, impulse: true }), // impulse: Morgen-Impuls (v0.9.5)
  newsRessorts: Object.freeze([]), // leer = alle Meldungen
  background: false,   // nur Android: „Im Hintergrund bereithalten“
  speakAloud: false,   // nur Android: im Hintergrund laut vorlesen
  speakTitles: false   // Termintitel vorlesen/anzeigen (sonst nur Anzahl + Uhrzeit)
});

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

/** Bereinigt eine (evtl. alte/kaputte) Konfiguration. knownRessorts = erlaubte Ressort-IDs. */
export function normalizeBriefingConfig(c = {}, knownRessorts = null) {
  const src = c && typeof c === 'object' ? c : {};
  const content = { ...DEFAULT_BRIEFING.content };
  for (const k of Object.keys(content)) if (typeof src.content?.[k] === 'boolean') content[k] = src.content[k];
  let ressorts = Array.isArray(src.newsRessorts) ? src.newsRessorts.map(String) : [];
  if (knownRessorts) ressorts = ressorts.filter((r) => knownRessorts.includes(r));
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_BRIEFING.enabled,
    gapHours: clampInt(src.gapHours, 3, 8, DEFAULT_BRIEFING.gapHours),
    latestHour: clampInt(src.latestHour, 8, 23, DEFAULT_BRIEFING.latestHour),
    content,
    newsRessorts: [...new Set(ressorts)],
    background: Boolean(src.background),
    speakAloud: Boolean(src.speakAloud),
    speakTitles: Boolean(src.speakTitles)
  };
}

/** Aktivität merken (Öffnen, Eingabe, Herzschlag). Lange Pausen werden als Ruhephase notiert. */
export function recordActivity(state = {}, nowMs) {
  const next = { ...state, lastActiveAt: nowMs };
  const last = Number(state.lastActiveAt) || 0;
  if (last && nowMs - last >= REST_MS) next.lastLongRest = { endAt: nowMs, ms: nowMs - last };
  return next;
}

/**
 * Entscheidet, ob jetzt automatisch gebrieft wird.
 * state: { lastActiveAt, lastLongRest:{endAt,ms}, lastBriefingDay }
 * → { ok: boolean, reason: string, day: string }
 */
export function shouldBrief({ nowMs, timeZone, state = {}, cfg = DEFAULT_BRIEFING, onboarded = true }) {
  const day = dayKey(nowMs, timeZone);
  const res = (ok, reason) => ({ ok, reason, day });
  if (!cfg.enabled) return res(false, 'disabled');
  if (!onboarded) return res(false, 'onboarding');
  if (state.lastBriefingDay === day) return res(false, 'already');
  const h = localParts(nowMs, timeZone).h;
  if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return res(false, 'night');
  if (h >= cfg.latestHour) return res(false, 'late');
  const last = Number(state.lastActiveAt) || 0;
  if (!last) return res(false, 'first-start');
  const gap = nowMs - last;
  if (gap < 0) return res(false, 'clock');
  const need = cfg.gapHours * H;
  if (h < EARLY_END_HOUR) return gap >= need * 1.5 ? res(true, 'gap-early') : res(false, 'early');
  if (gap >= need) return res(true, 'gap');
  // Regel B (ab 06:00): nachts kurz am Handy gewesen und danach ≥ 3 h Ruhe,
  // oder eine Ruhephase ≥ 3 h ist heute (seit 03:00) schon zu Ende gegangen.
  if (h >= RULE_B_MIN_HOUR) {
    const lh = localParts(last, timeZone).h;
    const nightUse = lh >= NIGHT_LOCK_HOUR || lh < EARLY_END_HOUR;
    const rest = state.lastLongRest;
    if ((nightUse && gap >= REST_MS) ||
        (rest && rest.ms >= REST_MS && rest.endAt <= nowMs && dayKey(rest.endAt, timeZone) === day)) {
      return res(true, 'rest');
    }
  }
  return res(false, 'short-gap');
}

/** Führt den JS-Zustand mit dem nativen (Bildschirm-/Entsperr-Ereignisse) zusammen. */
export function mergeNativeState(state = {}, native = null) {
  if (!native) return state;
  const out = { ...state };
  const nAct = Number(native.lastActivityAt) || 0;
  if (nAct > (Number(out.lastActiveAt) || 0)) out.lastActiveAt = nAct;
  const nr = native.lastLongRestEndAt ? { endAt: Number(native.lastLongRestEndAt), ms: Number(native.lastLongRestMs) || 0 } : null;
  if (nr && (!out.lastLongRest || nr.endAt > out.lastLongRest.endAt)) out.lastLongRest = nr;
  return out;
}
