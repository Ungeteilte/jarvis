// Wochenzusammenfassung („Wochenrückblick“) – sonntags, gleiche Bausteine wie die
// Abendzusammenfassung (Zeitregeln, lokale Fakten, eingezäunte Daten, Vorlage ohne KI).
// Browser-frei. Spiegel der Zeitregel in Java: BriefingRules.decideWeekly – gemeinsame Fälle in
// tests/fixtures/weekly-rules.json.
import { dayKey, localParts, DAY_START_HOUR, NIGHT_LOCK_HOUR } from './trigger.js';
import { withTimeout } from './net.js';
import { cleanText, fenceData, DATA_RULE } from './sanitize.js';
import { EVENING_AFTER_BRIEFING_MS } from './evening-config.js';
import { topicOf } from './evening.js';
import { loadNotes } from '../skills.js';
import { loadMemory } from '../memory.js';
import { loadReminders } from '../reminders.js';
import { normalizeText } from '../wakeword.js';
import { formatClock } from '../tools/defs/briefing-tools.js';

export { WEEKLY_HOUR_OPTIONS, DEFAULT_WEEKLY, normalizeWeeklyConfig } from './weekly-config.js';
import { DEFAULT_WEEKLY } from './weekly-config.js';

const DAY_MS = 24 * 3600000;

/** Wochentag eines Tages-Schlüssels „2026-10-25“ (0 = Sonntag). */
export function weekdayOfKey(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const isSundayKey = (day) => weekdayOfKey(day) === 0;

/** Sonntags ersetzt der Wochenrückblick (wenn an) die Abendzusammenfassung. */
export function weeklyReplacesEvening({ nowMs, timeZone, cfg = DEFAULT_WEEKLY }) {
  return Boolean(cfg.enabled) && isSundayKey(dayKey(nowMs, timeZone));
}

/**
 * Soll jetzt automatisch der Wochenrückblick kommen?
 * Nur sonntags, Fenster hour … 23:00, einmal pro Sonntag (lastWeeklyDay), nicht beim allerersten
 * Start und nicht in der ersten Stunde nach einem Morgen-Briefing.
 * state: { lastActiveAt, lastWeeklyDay, lastBriefingAt }
 */
export function shouldWeekly({ nowMs, timeZone, state = {}, cfg = DEFAULT_WEEKLY, onboarded = true }) {
  const day = dayKey(nowMs, timeZone);
  const res = (ok, reason) => ({ ok, reason, day });
  if (!cfg.enabled) return res(false, 'disabled');
  if (!onboarded) return res(false, 'onboarding');
  if (!isSundayKey(day)) return res(false, 'not-sunday');
  if (state.lastWeeklyDay === day) return res(false, 'already');
  const h = localParts(nowMs, timeZone).h;
  if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return res(false, 'night');
  if (h < cfg.hour) return res(false, 'early');
  const last = Number(state.lastActiveAt) || 0;
  if (!last) return res(false, 'first-start');
  if (nowMs - last < 0) return res(false, 'clock');
  const lb = Number(state.lastBriefingAt) || 0;
  if (lb && nowMs - lb >= 0 && nowMs - lb < EVENING_AFTER_BRIEFING_MS) return res(false, 'recent-briefing');
  return res(true, 'weekly');
}

// ---------- Was war diese Woche? (nur lokale Daten, keine Zitate aus Gesprächen) ----------
const NUM_DE = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const n = (x) => NUM_DE[x] || String(x);
const joinDe = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} und ${l.at(-1)}` : l[0] || '');

/** Tages-Schlüssel der letzten 7 Tage (heute eingeschlossen) – „diese Woche“. */
export function weekRange(nowMs, timeZone) {
  return { from: dayKey(nowMs - 6 * DAY_MS, timeZone), to: dayKey(nowMs, timeZone) };
}

const inRange = (ms, r, tz) => {
  if (!Number.isFinite(ms)) return false;
  const k = dayKey(ms, tz);
  return k >= r.from && k <= r.to;
};

/**
 * Zahlen der Woche: Gespräche (Anzahl, aktive Tage, Themen), neue Notizen, neue Gedächtnis-Einträge,
 * erledigte Erinnerungen, abgelaufene Timer. Texte nur gekürzt und höchstens drei je Art.
 * memoryTexts=false → nur die Anzahl der Gedächtnis-Einträge (wenn „Gedächtnis an KI“ aus ist).
 */
export function weekStats({ history = [], notes = [], memory = [], reminders = [], firedTimers = [], nowMs, timeZone, memoryTexts = true }) {
  const r = weekRange(nowMs, timeZone);
  const userMsgs = history.filter((m) => m && m.role === 'user' && inRange(Date.parse(m.at), r, timeZone));
  const counts = new Map();
  const days = new Set();
  for (const m of userMsgs) {
    const k = topicOf(m.text); counts.set(k, (counts.get(k) || 0) + 1);
    days.add(dayKey(Date.parse(m.at), timeZone));
  }
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  const wNotes = notes.filter((x) => x && inRange(Date.parse(x.at), r, timeZone));
  const wMem = memory.filter((x) => x && inRange(Date.parse(x.erstellt), r, timeZone));
  const done = reminders.filter((x) => x && x.done && Date.parse(x.at) <= nowMs && inRange(Date.parse(x.at), r, timeZone));
  const timers = firedTimers.filter((t) => t && Number(t.at) && inRange(Number(t.at), r, timeZone));
  return {
    from: r.from,
    to: r.to,
    chats: userMsgs.length,
    activeDays: days.size,
    topics,
    notes: wNotes.length,
    noteTexts: wNotes.slice(-3).map((x) => cleanText(x.text, 60)).filter(Boolean),
    memories: wMem.length,
    memoryTexts: memoryTexts ? wMem.slice(-3).map((x) => cleanText(x.text, 60)).filter(Boolean) : [],
    remindersDone: done.length,
    reminderTexts: done.slice(-3).map((x) => cleanText(x.text, 60)).filter(Boolean),
    timers: timers.length
  };
}

const weekday = (ms, tz) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'long', timeZone: tz || undefined });

/** Geplante Erinnerungen der nächsten 7 Tage (max. 5) – „Dienstag 9:00 Müll rausbringen“. */
export function upcomingReminders(reminders = [], nowMs, timeZone) {
  return reminders
    .filter((x) => x && !x.done && Date.parse(x.at) > nowMs && Date.parse(x.at) - nowMs <= 7 * DAY_MS)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 5)
    .map((x) => ({ day: weekday(Date.parse(x.at), timeZone), time: formatClock(Date.parse(x.at), timeZone), text: cleanText(x.text, 60) }));
}

const TIMEOUT_RESULT = { ok: false, message: 'Zeitüberschreitung.', data: { reason: 'timeout' } };

/**
 * Fakten für den Wochenrückblick. Rückblick: lokale Zahlen. Ausblick: Termine der nächsten 7 Tage
 * (nur Android, über get_calendar_events „woche“) und geplante Erinnerungen.
 * Inhalte folgen den Schaltern der Abendzusammenfassung (cfg.content der Abend-Einstellungen).
 */
export async function gatherWeeklyFacts({ registry, ctx, eveningCfg, history = [], firedTimers = [], memoryTexts = true, timeoutMs = 5000 }) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const nowMs = now.getTime();
  const tz = ctx.timeZone;
  const want = eveningCfg?.content || {};
  const calendar = want.calendar && ctx.device?.getCalendarEvents && registry.get('get_calendar_events')
    ? await withTimeout(registry.run('get_calendar_events', { day: 'woche' }, ctx), timeoutMs, TIMEOUT_RESULT).catch(() => TIMEOUT_RESULT)
    : null;
  const s = weekStats({
    history, notes: loadNotes(ctx.store), memory: loadMemory(ctx.store).items, reminders: loadReminders(ctx.store),
    firedTimers, nowMs, timeZone: tz, memoryTexts
  });
  const h = localParts(nowMs, tz).h;
  const facts = {
    kind: 'weekly',
    date: now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || undefined }),
    time: formatClock(nowMs, tz),
    hour: h,
    week: {
      chats: want.chats ? s.chats : null,
      activeDays: want.chats ? s.activeDays : null,
      topics: want.chats ? s.topics : [],
      notes: want.notes ? s.notes : null,
      noteTexts: want.notes ? s.noteTexts : [],
      memories: s.memories,
      memoryTexts: s.memoryTexts,
      remindersDone: s.remindersDone,
      reminderTexts: s.reminderTexts,
      timers: want.timers ? s.timers : null
    },
    nextReminders: upcomingReminders(loadReminders(ctx.store), nowMs, tz),
    nextEvents: null, calendarNote: null
  };
  if (calendar?.ok && calendar.data) {
    facts.nextEvents = calendar.data.events.slice(0, 8).map((e) => ({
      day: weekday(e.begin, tz), time: e.allDay ? null : formatClock(e.begin, tz), title: e.title, allDay: e.allDay
    }));
  } else if (calendar && !calendar.unsupported) facts.calendarNote = cleanText(calendar.message, 140);
  return facts;
}

export const WEEKLY_OFFER = 'Soll ich Ihnen für die neue Woche eine Erinnerung stellen oder mir etwas merken?';

const greeting = (h) => (h < 12 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend');

export function buildWeeklyMessages({ name = 'Jarvis', facts }) {
  const system = [
    `Du bist ${name}, ein höflicher, geistreicher persönlicher Assistent im Stil eines britischen Butlers. Du sprichst Deutsch und siezt den Nutzer.`,
    'Deine Antwort wird vorgelesen: kein Markdown, keine Aufzählungszeichen, keine Emojis, keine Links, keine Koordinaten.',
    `Aufgabe: ein kurzer, natürlicher Wochenrückblick am Sonntag in 5 bis 7 Sätzen. Beginne mit „${greeting(facts?.hour ?? 18)}“ und dem Hinweis, dass dies Ihr Wochenrückblick ist.`,
    'Erst die Höhepunkte der vergangenen Woche (Gespräche nur als Anzahl und Themen – nie zitieren –, neue Notizen, neu Gemerktes, erledigte Erinnerungen), dann ein Ausblick auf die kommende Woche (Termine nach Wochentag, geplante Erinnerungen).',
    'Nenne nur Fakten aus den Daten und erfinde nichts; fehlt etwas, lass es weg. Höchstens vier Termine nennen, den Rest zusammenfassen.',
    `Beende den Rückblick mit genau einem Angebot, zum Beispiel: „${WEEKLY_OFFER}“`,
    DATA_RULE
  ].join('\n');
  const user = `${fenceData(facts)}\nErstelle jetzt den Wochenrückblick.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Wochenrückblick ohne KI (oder wenn die KI ausfällt). */
export function templateWeekly(facts, { name = 'Jarvis' } = {}) {
  const parts = [`${greeting(facts.hour ?? 18)}. Hier ist Ihr Wochenrückblick.`];
  const w = facts.week || {};
  if (w.chats !== null && w.chats !== undefined) {
    if (!w.chats) parts.push('Diese Woche haben wir noch nicht miteinander gesprochen.');
    else {
      const days = w.activeDays > 1 ? ` an ${n(w.activeDays)} Tagen` : '';
      parts.push(`Diese Woche haben Sie mich${days} ${w.chats === 1 ? 'einmal' : `${n(w.chats)}mal`} gefragt` +
        (w.topics?.length ? `, vor allem zu ${joinDe(w.topics.slice(0, 3))}.` : '.'));
    }
  }
  const extra = [];
  if (w.notes) extra.push(w.notes === 1 ? 'eine neue Notiz' : `${n(w.notes)} neue Notizen`);
  if (w.memories) extra.push(w.memories === 1 ? 'ein neuer Eintrag im Gedächtnis' : `${n(w.memories)} neue Einträge im Gedächtnis`);
  if (w.remindersDone) extra.push(w.remindersDone === 1 ? 'eine erledigte Erinnerung' : `${n(w.remindersDone)} erledigte Erinnerungen`);
  if (w.timers) extra.push(w.timers === 1 ? 'ein abgelaufener Timer' : `${n(w.timers)} abgelaufene Timer`);
  if (extra.length) parts.push(`Dazu ${extra.length === 1 && /^(?:eine?|ein) /.test(extra[0]) ? 'kommt' : 'kommen'} ${joinDe(extra)}.`);
  if (Array.isArray(facts.nextEvents)) {
    const ev = facts.nextEvents;
    if (!ev.length) parts.push('In der kommenden Woche stehen keine Termine im Kalender.');
    else {
      const list = ev.slice(0, 3).map((e) => (e.time ? `${e.day} um ${e.time} Uhr ${e.title}` : `${e.day} ganztägig ${e.title}`));
      parts.push(`In der kommenden Woche haben Sie ${ev.length === 1 ? 'einen Termin' : `${n(ev.length).replace(/^eine$/, 'einen')} Termine`}: ${joinDe(list)}` +
        (ev.length > 3 ? ' und weitere.' : '.'));
    }
  } else if (facts.calendarNote) parts.push(facts.calendarNote);
  const rem = facts.nextReminders || [];
  if (rem.length) {
    parts.push(`Geplant ${rem.length === 1 ? 'ist eine Erinnerung' : `sind ${n(rem.length)} Erinnerungen`}, die erste am ${rem[0].day} um ${rem[0].time} Uhr: ${rem[0].text}.`);
  }
  parts.push(WEEKLY_OFFER);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim() || `${name} wünscht eine gute neue Woche.`;
}

/** Fakten des Wochenrückblicks für Nachfragen (System-Prompt). */
export function weeklyContext(facts) {
  return `Fakten aus dem Wochenrückblick, falls der Nutzer nachfragt (z. B. „Ja, erinnere mich am Montag an …“):\n${fenceData(facts)}\n${DATA_RULE}`;
}

/** Nachfrage ohne KI: Termine der Woche, „Ja“ auf das Angebot, „Nein“. */
export function weeklyFollowUp(text, facts) {
  if (!facts) return null;
  const t = normalizeText(text);
  if (/termin|kalender/.test(t) && facts.nextEvents?.length) {
    return 'Ihre Termine in der kommenden Woche: ' +
      facts.nextEvents.map((e) => (e.time ? `${e.day} ${e.time} Uhr ${e.title}` : `${e.day} ganztägig ${e.title}`)).join('; ') + '.';
  }
  if (/erinnerung/.test(t) && !/^(ja|jo|gerne?|bitte|klar|okay|ok)\b/.test(t) && facts.nextReminders?.length) {
    return 'Geplante Erinnerungen: ' + facts.nextReminders.map((r) => `${r.day} ${r.time} Uhr ${r.text}`).join('; ') + '.';
  }
  if (/^(ja|jo|gerne?|bitte|klar|okay|ok|sicher|unbedingt)\b.*\b(merk|notier)/.test(t)) {
    return 'Sehr gern. Was soll ich mir merken? Sagen Sie zum Beispiel: Merke dir, dass ich am Montag Brot kaufen muss.';
  }
  if (/^(ja|jo|gerne?|bitte|klar|okay|ok|sicher|unbedingt|erinner)\b/.test(t)) {
    return 'Sehr gern. Woran soll ich Sie erinnern, und wann? Sagen Sie zum Beispiel: Erinnere mich am Montag um 9 Uhr an den Müll.';
  }
  if (/^(nein|ne|nee|danke nein|nicht noetig|passt|alles gut)\b/.test(t)) return 'Sehr wohl. Ich wünsche Ihnen einen guten Start in die neue Woche.';
  return null;
}

// ---------- Sprachbefehle ----------
const WSUBJ = '(?:wochenrueckblick|wochenzusammenfassung|wochen rueckblick|wochen zusammenfassung)';
const REQUEST = [
  new RegExp(`^(?:(?:mein|meine|der|die|den|meinen|ein|eine|einen) )?${WSUBJ}(?: bitte| starten| jetzt)?$`),
  new RegExp(`^(?:starte?|mach|gib mir|zeig mir) (?:die |meine |eine |den |meinen |einen |bitte )*${WSUBJ}(?: bitte)?$`),
  /^wie war (?:meine|die) woche$/,
  /^was steht (?:die |in der )?(?:naechste|naechsten|kommende|kommenden) woche an$/
];

export function isWeeklyRequest(text) {
  const t = normalizeText(text);
  return Boolean(t) && REQUEST.some((re) => re.test(t));
}

/** „Wochenrückblick aus/an“. → Antwort oder null; saveWeekly(changes) speichert. */
export function weeklyCommand(text, current, saveWeekly) {
  const t = normalizeText(text);
  if (!t) return null;
  const subj = `(?:den |die |meinen |meine )?${WSUBJ}`;
  if (new RegExp(`^${subj} (?:bitte )?(?:aus|ausschalten|abschalten|deaktivieren|stoppen)$|^(?:schalte?|mach) ${subj} aus$|^keinen? ${subj} mehr$`).test(t)) {
    saveWeekly({ ...current, enabled: false });
    return 'Sehr wohl, der Wochenrückblick ist ausgeschaltet. Sonntags gibt es dann wieder die normale Abendzusammenfassung. Sagen Sie „Wochenrückblick an“, wenn Sie ihn wieder möchten.';
  }
  if (new RegExp(`^${subj} (?:bitte )?(?:an|ein|einschalten|aktivieren)$|^(?:schalte?|mach) ${subj} (?:an|ein)$`).test(t)) {
    saveWeekly({ ...current, enabled: true });
    return `Sehr gern, der Wochenrückblick ist eingeschaltet. Ich melde mich sonntags ab ${current.hour} Uhr beim ersten Öffnen.`;
  }
  return null;
}
