// Abendzusammenfassung („Tagesrückblick“) – gleiche Bausteine wie das Morgen-Briefing
// (Zeitregeln, Fakten sammeln, eingezäunte Daten, Vorlage ohne KI). Browser-frei.
// Spiegel der Zeitregel in Java: BriefingRules.decideEvening – gemeinsame Fälle in
// tests/fixtures/evening-rules.json.
import { dayKey, localParts, DAY_START_HOUR, NIGHT_LOCK_HOUR } from './trigger.js';
import { withTimeout } from './net.js';
import { cleanText, fenceData, DATA_RULE } from './sanitize.js';
import { weatherSentence } from './weather.js';
import { RESSORTS } from './news.js';
import { loadNotes } from '../skills.js';
import { normalizeText } from '../wakeword.js';
import { formatClock } from '../tools/defs/briefing-tools.js';

export { EVENING_START_OPTIONS, EVENING_AFTER_BRIEFING_MS, DEFAULT_EVENING, normalizeEveningConfig } from './evening-config.js';
import { EVENING_AFTER_BRIEFING_MS, DEFAULT_EVENING } from './evening-config.js';

/**
 * Soll jetzt automatisch der Tagesrückblick kommen?
 * Fenster: startHour … 23:00 (danach Nachtsperre), einmal pro Tag (lastEveningDay).
 * Nur wenn der Nutzer schon bekannt ist (nicht beim allerersten Start) und nicht direkt
 * nach einem Morgen-Briefing.
 * state: { lastActiveAt, lastEveningDay, lastBriefingAt }
 */
export function shouldEvening({ nowMs, timeZone, state = {}, cfg = DEFAULT_EVENING, onboarded = true }) {
  const day = dayKey(nowMs, timeZone);
  const res = (ok, reason) => ({ ok, reason, day });
  if (!cfg.enabled) return res(false, 'disabled');
  if (!onboarded) return res(false, 'onboarding');
  if (state.lastEveningDay === day) return res(false, 'already');
  const h = localParts(nowMs, timeZone).h;
  if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return res(false, 'night');
  if (h < cfg.startHour) return res(false, 'early');
  const last = Number(state.lastActiveAt) || 0;
  if (!last) return res(false, 'first-start');
  if (nowMs - last < 0) return res(false, 'clock');
  const lb = Number(state.lastBriefingAt) || 0;
  if (lb && nowMs - lb >= 0 && nowMs - lb < EVENING_AFTER_BRIEFING_MS) return res(false, 'recent-briefing');
  return res(true, 'evening');
}

// ---------- Was war heute? (nur lokale Daten, keine Zitate) ----------
const TOPICS = [
  ['Wetter', /wetter|regen|regnet|sonnig|kalt|warm|schirm|temperatur|grad\b/],
  ['Termine', /termin|kalender|meeting|verabredung/],
  ['Nachrichten', /nachricht|news|schlagzeil|tagesschau/],
  ['Timer und Wecker', /timer|wecker|countdown|erinner/],
  ['Notizen', /merke|notiz|gemerkt|notiert/],
  ['Anrufe und Nachrichten an Kontakte', /anruf|ruf .* an|sms|whatsapp|e ?mail|schreib/],
  ['Navigation', /navigier|route|karte|weg nach|wie komme ich/],
  ['Musik und Videos', /musik|spotify|youtube|song|lied|video/],
  ['Handy-Einstellungen', /lautstaerke|lauter|leiser|wlan|bluetooth|taschenlampe|akku/],
  ['Uhrzeit und Datum', /wie spaet|uhrzeit|datum|welcher tag/],
  ['Briefing', /briefing|guten morgen|was steht heute an|tagesrueckblick|wie war mein tag/]
];

/** Feste Themen-Etiketten für einen Nutzertext (nie der Text selbst). */
export function topicOf(text) {
  const t = normalizeText(text);
  for (const [label, re] of TOPICS) if (re.test(t)) return label;
  return 'allgemeine Fragen';
}

const isToday = (iso, day, tz) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && dayKey(ms, tz) === day;
};

/** Zahlen zum heutigen Tag: Gespräche (Anzahl + Themen), neue Notizen, abgelaufene Timer. */
export function todayStats({ history = [], notes = [], firedTimers = [], nowMs, timeZone }) {
  const day = dayKey(nowMs, timeZone);
  const userMsgs = history.filter((m) => m && m.role === 'user' && isToday(m.at, day, timeZone));
  const counts = new Map();
  for (const m of userMsgs) { const k = topicOf(m.text); counts.set(k, (counts.get(k) || 0) + 1); }
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  const todaysNotes = notes.filter((n) => n && isToday(n.at, day, timeZone));
  const timers = firedTimers.filter((t) => t && Number(t.at) && dayKey(Number(t.at), timeZone) === day);
  return {
    day,
    chats: userMsgs.length,
    topics,
    notes: todaysNotes.length,
    noteTexts: todaysNotes.slice(-3).map((n) => cleanText(n.text, 60)).filter(Boolean),
    timers: timers.length,
    timerLabels: timers.slice(-3).map((t) => cleanText(t.label, 40)).filter(Boolean)
  };
}

/** Abgelaufenen Timer im Briefing-Zustand merken (max. 20, für den Rückblick). */
export function recordTimerFired(state = {}, label, nowMs) {
  const list = Array.isArray(state.firedTimers) ? state.firedTimers : [];
  return { ...state, firedTimers: [...list, { label: cleanText(label, 40), at: nowMs }].slice(-20) };
}

const TIMEOUT_RESULT = { ok: false, message: 'Zeitüberschreitung.', data: { reason: 'timeout' } };

/**
 * Fakten für den Rückblick. weatherTomorrow/eventsTomorrow/news = null → nicht verfügbar.
 * history/firedTimers kommen aus dem lokalen Speicher (nie an Dritte, nur Zahlen/Etiketten an die KI).
 */
export async function gatherEveningFacts({ registry, ctx, cfg, briefingCfg = {}, history = [], firedTimers = [], timeoutMs = 5000 }) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const nowMs = now.getTime();
  const tz = ctx.timeZone;
  const want = cfg.content || {};
  const run = (name, args = {}) => (registry.get(name)
    ? withTimeout(registry.run(name, args, ctx), timeoutMs, TIMEOUT_RESULT).catch(() => TIMEOUT_RESULT)
    : Promise.resolve(null));
  const [weather, calendar, news] = await Promise.all([
    want.weather ? run('get_weather', { day: 'morgen' }) : null,
    want.calendar && ctx.device?.getCalendarEvents ? run('get_calendar_events', { day: 'morgen' }) : null,
    want.news ? run('get_news', {}) : null
  ]);
  const stats = todayStats({ history, notes: loadNotes(ctx.store), firedTimers, nowMs, timeZone: tz });
  const facts = {
    kind: 'evening',
    date: now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || undefined }),
    time: formatClock(nowMs, tz),
    today: {
      chats: want.chats ? stats.chats : null,
      topics: want.chats ? stats.topics : [],
      notes: want.notes ? stats.notes : null,
      noteTexts: want.notes ? stats.noteTexts : [],
      timers: want.timers ? stats.timers : null,
      timerLabels: want.timers ? stats.timerLabels : []
    },
    tomorrowWeather: null, weatherNote: null,
    tomorrowEvents: null, calendarNote: null,
    news: null, newsRessorts: (briefingCfg.newsRessorts || []).map((r) => RESSORTS[r]?.label).filter(Boolean)
  };
  if (weather?.ok && weather.data) {
    const w = weather.data;
    facts.tomorrowWeather = { min: w.min, max: w.max, rainChance: w.rainChance, dayText: w.dayText, stale: Boolean(w.stale) };
  } else if (weather) facts.weatherNote = cleanText(weather.message, 140);
  if (calendar?.ok && calendar.data) {
    facts.tomorrowEvents = calendar.data.events.slice(0, 5).map((e) => ({
      time: e.allDay ? null : formatClock(e.begin, tz), title: e.title, allDay: e.allDay
    }));
  } else if (calendar && !calendar.unsupported) facts.calendarNote = cleanText(calendar.message, 140);
  if (news?.ok && news.data) facts.news = news.data.items.slice(0, 3).map((i) => ({ title: i.title, summary: i.summary }));
  return facts;
}

export const EVENING_OFFER = 'Soll ich Ihnen einen Wecker für morgen stellen oder mir noch etwas für morgen merken?';

export function buildEveningMessages({ name = 'Jarvis', facts }) {
  const system = [
    `Du bist ${name}, ein höflicher, geistreicher persönlicher Assistent im Stil eines britischen Butlers. Du sprichst Deutsch und siezt den Nutzer.`,
    'Deine Antwort wird vorgelesen: kein Markdown, keine Aufzählungszeichen, keine Emojis, keine Links, keine Koordinaten.',
    'Aufgabe: ein kurzer, natürlicher Tagesrückblick am Abend in 4 bis 6 Sätzen. Beginne mit einem kurzen Abendgruß.',
    'Fasse den Tag zusammen (Anzahl und Themen der Gespräche, neue Notizen, abgelaufene Timer) – ohne Gespräche zu zitieren – und gib einen Ausblick auf morgen (erste Termine, Wetter morgen).',
    'Nachrichten höchstens zwei kurze Schlagzeilen in eigenen Worten. Nenne nur Fakten aus den Daten und erfinde nichts; fehlt etwas, lass es weg.',
    `Beende den Rückblick mit genau einem Angebot, zum Beispiel: „${EVENING_OFFER}“`,
    DATA_RULE
  ].join('\n');
  const user = `${fenceData(facts)}\nErstelle jetzt den Tagesrückblick.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

const NUM_DE = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const n = (x) => NUM_DE[x] || String(x);
const joinDe = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} und ${l.at(-1)}` : l[0] || '');

/** Rückblick ohne KI (oder wenn die KI ausfällt). */
export function templateEvening(facts, { name = 'Jarvis' } = {}) {
  const parts = ['Guten Abend.'];
  const t = facts.today || {};
  if (t.chats !== null && t.chats !== undefined) {
    if (!t.chats) parts.push('Heute haben wir noch nicht miteinander gesprochen.');
    else {
      parts.push(`Heute haben Sie mich ${t.chats === 1 ? 'einmal' : `${n(t.chats)}mal`} gefragt` +
        (t.topics?.length ? `, vor allem zu ${joinDe(t.topics.slice(0, 3))}.` : '.'));
    }
  }
  const extra = [];
  if (t.notes) extra.push(`${t.notes === 1 ? 'eine neue Notiz' : `${n(t.notes)} neue Notizen`}`);
  if (t.timers) extra.push(`${t.timers === 1 ? 'ein abgelaufener Timer' : `${n(t.timers)} abgelaufene Timer`}`);
  if (extra.length) parts.push(`${extra.length === 1 && /^eine? /.test(extra[0]) ? 'Dazu kommt' : 'Dazu kommen'} ${joinDe(extra)}.`);
  if (Array.isArray(facts.tomorrowEvents)) {
    const ev = facts.tomorrowEvents;
    if (!ev.length) parts.push('Morgen stehen keine Termine im Kalender.');
    else {
      const first = ev.find((e) => e.time) || ev[0];
      parts.push(`Morgen haben Sie ${ev.length === 1 ? 'einen Termin' : `${n(ev.length).replace(/^eine$/, 'einen')} Termine`}` +
        (first.time ? `, ${ev.length === 1 ? '' : 'den ersten '}um ${first.time} Uhr: ${first.title}` : `: ${first.title}`) + '.');
    }
  } else if (facts.calendarNote) parts.push(facts.calendarNote);
  if (facts.tomorrowWeather) parts.push(weatherSentence({ ...facts.tomorrowWeather, day: 'morgen', now: null }, { stale: facts.tomorrowWeather.stale }));
  else if (facts.weatherNote) parts.push(facts.weatherNote);
  if (facts.news?.length) parts.push(`Aus den Nachrichten des Tages: ${facts.news[0].title.replace(/[.!?…]+$/, '')}.`);
  parts.push(EVENING_OFFER);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim() || `${name} wünscht einen schönen Abend.`;
}

/** Fakten des Rückblicks für Nachfragen (System-Prompt). */
export function eveningContext(facts) {
  return `Fakten aus dem heutigen Tagesrückblick, falls der Nutzer nachfragt (z. B. „Ja, stell einen Wecker“ – dann nach der Uhrzeit fragen):\n${fenceData(facts)}\n${DATA_RULE}`;
}

/** Nachfrage ohne KI: „Ja“ auf das Angebot → nach der Uhrzeit fragen; Termine/Wetter morgen. */
export function eveningFollowUp(text, facts) {
  if (!facts) return null;
  const t = normalizeText(text);
  if (/termin|kalender/.test(t) && facts.tomorrowEvents?.length) {
    return 'Ihre Termine morgen: ' + facts.tomorrowEvents.map((e) => (e.time ? `${e.time} Uhr ${e.title}` : `ganztägig ${e.title}`)).join('; ') + '.';
  }
  if (/wetter|regen|temperatur/.test(t) && facts.tomorrowWeather) {
    return weatherSentence({ ...facts.tomorrowWeather, day: 'morgen', now: null }, { stale: facts.tomorrowWeather.stale });
  }
  if (/^(ja|jo|gerne?|bitte|klar|okay|ok|sicher|unbedingt)\b.*\b(merk|notier|erinner)/.test(t)) {
    return 'Sehr gern. Was soll ich mir für morgen merken? Sagen Sie zum Beispiel: Merke dir, dass ich Brot kaufen muss.';
  }
  if (/^(ja|jo|gerne?|bitte|klar|okay|ok|sicher|unbedingt|wecker)\b/.test(t)) {
    return 'Sehr gern. Für wie viel Uhr soll ich den Wecker stellen? Sagen Sie zum Beispiel: Wecker auf 7 Uhr.';
  }
  if (/^(nein|ne|nee|danke nein|nicht noetig|passt|alles gut)\b/.test(t)) return 'Sehr wohl. Ich wünsche Ihnen einen angenehmen Abend.';
  return null;
}

// ---------- Sprachbefehle ----------
const REQUEST = [
  /^(?:(?:meine|die|eine) )?abendzusammenfassung(?: bitte| starten| jetzt)?$/,
  /^(?:starte?|mach|gib mir|zeig mir) (?:die |meine |eine |den |meinen |einen |bitte )*(?:abendzusammenfassung|tagesrueckblick|rueckblick)(?: bitte)?$/,
  /^wie war (?:mein|der) tag(?: heute)?$/,
  /^(?:(?:mein|der|ein) )?tagesrueckblick(?: bitte)?$/,
  /^(?:guten abend)(?: [a-z]+)?$/
];

export function isEveningRequest(text) {
  const t = normalizeText(text);
  return Boolean(t) && REQUEST.some((re) => re.test(t));
}

/** „Abendzusammenfassung aus/an“. → Antwort oder null; saveEvening(changes) speichert. */
export function eveningCommand(text, current, saveEvening) {
  const t = normalizeText(text);
  if (!t) return null;
  const subj = '(?:die |meine )?(?:abendzusammenfassung|tagesrueckblick|abend ?rueckblick)';
  if (new RegExp(`^${subj} (?:bitte )?(?:aus|ausschalten|abschalten|deaktivieren|stoppen)$|^(?:schalte?|mach) ${subj} aus$|^keine? ${subj} mehr$`).test(t)) {
    saveEvening({ ...current, enabled: false });
    return 'Sehr wohl, die Abendzusammenfassung ist ausgeschaltet. Sagen Sie „Abendzusammenfassung an“, wenn Sie sie wieder möchten.';
  }
  if (new RegExp(`^${subj} (?:bitte )?(?:an|ein|einschalten|aktivieren)$|^(?:schalte?|mach) ${subj} (?:an|ein)$`).test(t)) {
    saveEvening({ ...current, enabled: true });
    return `Sehr gern, die Abendzusammenfassung ist eingeschaltet. Ich melde mich abends ab ${current.startHour} Uhr beim ersten Öffnen.`;
  }
  return null;
}
