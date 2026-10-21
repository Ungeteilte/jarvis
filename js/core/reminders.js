// v0.9 W4 – Erinnerungen: Zeit-Parser (deutsch), Prüfung, Vorlesen, Speicher. Reine Logik, ohne Browser.
//
// Versteht u. a.: „morgen um 9“, „übermorgen früh“, „am Freitag um 18 Uhr“, „nächsten Montag“,
// „in 2 Stunden“, „in einer halben Stunde“, „heute Abend um halb 8“, „am 24.10. um 7:30“.
// Alle Berechnungen in lokaler Zeit des Geräts (Date-Methoden ohne UTC).
import { parseNumber } from './skills.js';

export const MAX_REMINDERS = 50;
export const MAX_AHEAD_MS = 366 * 24 * 3600 * 1000; // höchstens 1 Jahr voraus
export const MIN_AHEAD_MS = 30 * 1000;               // nicht in der Vergangenheit (30 s Puffer)
export const STORE_KEY = 'reminders';
export const CHANNEL_ID = 'reminder_v1';

const WEEKDAYS = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const WEEKDAY_LABEL = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['januar', 'februar', 'maerz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const HOURW = '(?:\\d{1,2}|eins?|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|zehn|elf|zwoelf)';
const HOURS = { ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12 };
const hourOf = (w) => (/^\d+$/.test(w) ? Number(w) : HOURS[w] ?? null);

// Tageszeiten: Standard-Uhrzeit und ob eine Stunde < 12 als Nachmittag/Abend gilt
const DAYPARTS = [
  [/\b(?:frueh|morgens|in der frueh)\b/, 8, false],
  [/\bvormittags?\b/, 10, false],
  [/\bmittags?\b/, 12, false],
  [/\bnachmittags?\b/, 15, true],
  [/\b(?:abends?|heute abend)\b/, 19, true],
  [/\bnachts?\b/, 22, true]
];

/** Kleinbuchstaben + Umlaute ausschreiben, Satzzeichen außer : und . behalten (für Zeiten/Daten). */
function norm(text) {
  return String(text || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[„“"!?;]/g, ' ').replace(/\s+/g, ' ').trim();
}

const atTime = (d, h, m) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); return x; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), 0, 0);

/**
 * Zeitpunkt aus dem Text lesen.
 * → { date, spans } (spans = gefundene Textstellen zum Entfernen) oder null (keine Zeitangabe).
 */
export function parseWhen(text, now = new Date()) {
  let s = ` ${norm(text)} `;
  const spans = [];
  const take = (re) => {
    const m = s.match(re);
    if (m) { spans.push(m[0].trim()); s = s.replace(m[0], ' '); }
    return m;
  };
  // ISO-Zeitpunkt (z. B. von der KI): 2026-10-22T09:00
  const iso = String(text || '').match(/\b(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2})/i);
  if (iso) {
    return { date: new Date(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], 0, 0), spans: [iso[0]] };
  }

  // 1) relativ: „in 2 Stunden“, „in einer halben Stunde“, „in 3 Tagen“
  let rel = null;
  let m = take(/\bin (?:einer )?(halben stunde|viertelstunde|viertel stunde|anderthalb stunden|eineinhalb stunden)\b/);
  if (m) rel = { ms: { 'halben stunde': 30, viertelstunde: 15, 'viertel stunde': 15, 'anderthalb stunden': 90, 'eineinhalb stunden': 90 }[m[1]] * 60000 };
  if (!rel) {
    m = take(/\bin (\S+) (minuten?|min|stunden?|std|tagen?|wochen?)\b/);
    if (m) {
      const n = parseNumber(m[1]);
      if (n != null && n > 0) {
        if (/^min/.test(m[2])) rel = { ms: n * 60000 };
        else if (/^st/.test(m[2])) rel = { ms: n * 3600000 };
        else rel = { days: /^woch/.test(m[2]) ? n * 7 : n };
      }
    }
  }

  // 2) Datum: „am 24.10.(2026)“, „am 24. oktober“
  let day = null;
  m = take(/\b(?:am )?(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (m) {
    let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.getFullYear();
    let d = new Date(y, Number(m[2]) - 1, Number(m[1]));
    if (!m[3] && atTime(d, 23, 59) < now) d = new Date(y + 1, Number(m[2]) - 1, Number(m[1]));
    if (d.getMonth() !== Number(m[2]) - 1) return { invalid: true, spans }; // 31.02.
    day = d;
  }
  if (!day) {
    m = take(new RegExp(`\\b(?:am )?(\\d{1,2})\\.? (${MONTHS.join('|')})\\b`));
    if (m) {
      const mo = MONTHS.indexOf(m[2]);
      let d = new Date(now.getFullYear(), mo, Number(m[1]));
      if (atTime(d, 23, 59) < now) d = new Date(now.getFullYear() + 1, mo, Number(m[1]));
      day = d;
    }
  }
  // 3) „übermorgen“, „morgen“ (nicht „morgens“), „heute“
  if (!day) {
    if (take(/\buebermorgen\b/)) day = addDays(now, 2);
    else if (take(/\bmorgen\b(?!s)/)) day = addDays(now, 1);
    else if (take(/\bheute\b(?! abend)/)) day = new Date(now);
  }
  // 4) Wochentag: „am Freitag“, „nächsten Montag“, „kommenden Mittwoch“
  if (!day) {
    m = take(new RegExp(`\\b(?:am |naechsten |naechste |kommenden |diesen )?(${WEEKDAYS.join('|')})\\b`));
    if (m) {
      const wd = WEEKDAYS.indexOf(m[1]);
      const delta = (wd - now.getDay() + 7) % 7 || 7;
      day = addDays(now, delta);
    }
  }

  // 5) Tageszeit („früh“, „abends“)
  let part = null;
  for (const [re, h, pm] of DAYPARTS) {
    const pm0 = s.match(re);
    if (pm0) { part = { h, pm }; spans.push(pm0[0]); s = s.replace(pm0[0], ' '); break; }
  }
  if (!part && /\bheute abend\b/.test(norm(text))) part = { h: 19, pm: true };

  // 6) Uhrzeit
  let time = null;
  m = take(new RegExp(`(?:\\b(?:um|gegen|ab) )?\\b(halb|viertel nach|viertel vor|dreiviertel) (${HOURW})(?: uhr)?\\b`));
  if (m) {
    const h = hourOf(m[2]);
    if (h != null) time = m[1] === 'halb' ? { h: (h + 23) % 24, m: 30 } : m[1] === 'viertel nach' ? { h, m: 15 } : { h: (h + 23) % 24, m: 45 };
  }
  if (!time) {
    m = take(/(?:\b(?:um|gegen|ab) )?\b(\d{1,2})[:.](\d{2})(?: ?uhr)?\b/);
    if (m) time = { h: Number(m[1]), m: Number(m[2]) };
  }
  if (!time) {
    m = take(new RegExp(`(?:\\b(?:um|gegen|ab) )?\\b(${HOURW}) ?uhr(?: (\\d{1,2}))?\\b`));
    if (m && hourOf(m[1]) != null) time = { h: hourOf(m[1]), m: m[2] ? Number(m[2]) : 0 };
  }
  if (!time) {
    m = take(new RegExp(`\\b(?:um|gegen) (${HOURW})\\b`));
    if (m && hourOf(m[1]) != null) time = { h: hourOf(m[1]), m: 0 };
  }
  if (time && (time.h > 23 || time.m > 59)) return { invalid: true, spans };
  if (time && part?.pm && time.h >= 1 && time.h <= 11 && !(part.h === 22 && time.h <= 4)) time.h += 12;

  // Zusammensetzen
  if (rel?.ms) return { date: new Date(now.getTime() + rel.ms), spans, relative: true };
  if (rel?.days) day = addDays(now, rel.days);
  if (!day && !time && !part) return null;
  if (day) {
    const t = time || { h: part ? part.h : 9, m: 0 };
    return { date: atTime(day, t.h, t.m), spans, defaultTime: !time && !part };
  }
  // nur Uhrzeit/Tageszeit: heute, sonst (am Vormittag gesagt „um 7“) abends, sonst morgen
  const t = time || { h: part.h, m: 0 };
  let d = atTime(now, t.h, t.m);
  if (d <= now && time && !part && t.h >= 1 && t.h <= 11 && atTime(now, t.h + 12, t.m) > now) d = atTime(now, t.h + 12, t.m);
  else if (d <= now) d = atTime(addDays(now, 1), t.h, t.m);
  return { date: d, spans };
}

/** „Mittwoch, 22.10., 9:00 Uhr“ */
export function formatWhen(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${WEEKDAY_LABEL[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}., ` +
    `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
}

/** Zeitpunkt prüfen: nicht vorbei, höchstens 1 Jahr voraus. → null oder Rückfrage. */
export function checkWhen(date, now = new Date()) {
  const t = date instanceof Date ? date.getTime() : Date.parse(date);
  if (!Number.isFinite(t)) return 'Diesen Zeitpunkt verstehe ich nicht. Wann genau soll ich Sie erinnern?';
  if (t - now.getTime() < MIN_AHEAD_MS) return `${formatWhen(new Date(t))} ist schon vorbei. Wann soll ich Sie erinnern?`;
  if (t - now.getTime() > MAX_AHEAD_MS) return 'Das ist mehr als ein Jahr entfernt – so weit plane ich keine Erinnerungen. Bitte wählen Sie einen früheren Zeitpunkt.';
  return null;
}

/** Erinnerungstext säubern (Füllwörter rund um den Inhalt weg, erster Buchstabe groß). */
export function cleanReminderText(text) {
  let t = String(text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:bitte\s+)?(?:erinnere?|erinner)\s+mich\b\s*(?:bitte\s+)?/i, '')
    .replace(/^(?:kannst du mich|könntest du mich|koenntest du mich)\s+/i, '')
    .replace(/^(?:eine\s+)?erinnerung\s+(?:für|fuer|an)?\s*/i, '');
  for (let i = 0; i < 3; i++) {
    t = t.replace(/^[\s,:;–-]+/, '')
      .replace(/^(?:bitte|daran|dran)\b[\s,]*/i, '')
      .replace(/^an\s+(?:den|die|das|dem)\s+/i, '')
      .replace(/^(?:an|ans|dass|zu)\s+/i, '')
      .replace(/\s+(?:zu\s+)?erinnern\s*$/i, '')
      .replace(/[\s,.;:–-]+$/, '');
  }
  t = t.replace(/\s+/g, ' ').trim().slice(0, 200);
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * Ganzer Satz → { when, text } | { needsTime, text } | { needsText, when } | { invalid }.
 * Entfernt die Zeitangabe aus dem Text („Erinnere mich morgen um 9 an den Müll“ → „Den Müll“).
 */
export function parseReminder(sentence, now = new Date()) {
  const raw = String(sentence || '');
  const w = parseWhen(raw, now);
  if (w?.invalid) return { invalid: true, message: 'Diese Uhrzeit oder dieses Datum gibt es nicht.' };
  let rest = norm(raw);
  for (const sp of w?.spans || []) rest = rest.replace(sp, ' ');
  // Original-Schreibweise (Umlaute, Groß/klein) des Rests zurückholen, wo möglich
  const words = rest.split(' ').filter(Boolean);
  const orig = raw.replace(/[„“"]/g, '').split(/\s+/);
  const origMap = new Map(orig.map((o) => [norm(o).replace(/[,.:]+$/, ''), o.replace(/[,.:]+$/, '')]));
  const text = cleanReminderText(words.map((x) => origMap.get(x.replace(/[,.:]+$/, '')) || x).join(' '));
  if (!w) return { needsTime: true, text };
  if (!text) return { needsText: true, when: w.date };
  return { when: w.date, text, defaultTime: Boolean(w.defaultTime) };
}

// ---------- Speicher ----------
export const loadReminders = (store) => {
  const list = store.get(STORE_KEY, []);
  return Array.isArray(list) ? list.filter((r) => r && r.id && r.at && r.text) : [];
};
export const saveReminders = (store, list) => store.set(STORE_KEY, list);

/** Aktive (zukünftige) Erinnerungen, sortiert. */
export const activeReminders = (store, now = new Date()) =>
  loadReminders(store).filter((r) => Date.parse(r.at) > now.getTime() && !r.done).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/** Neue Notification-ID (positiv, 32 Bit, fortlaufend gespeichert). */
export function nextReminderId(store) {
  const n = Number(store.get('reminderSeq', 7000)) + 1;
  store.set('reminderSeq', n > 2e9 ? 7001 : n);
  return n > 2e9 ? 7001 : n;
}

export function addReminder(store, { text, at, now = new Date() }) {
  const list = loadReminders(store).filter((r) => Date.parse(r.at) > now.getTime() - 7 * 24 * 3600 * 1000 || !r.done);
  if (activeReminders(store, now).length >= MAX_REMINDERS) {
    return { ok: false, message: `Es sind schon ${MAX_REMINDERS} Erinnerungen geplant – mehr gehen nicht. Löschen Sie zuerst eine.` };
  }
  const item = { id: nextReminderId(store), text: cleanReminderText(text) || String(text).slice(0, 200), at: new Date(at).toISOString(), created: now.toISOString() };
  list.push(item);
  saveReminders(store, list);
  return { ok: true, item };
}

export function removeReminder(store, id) {
  const list = loadReminders(store);
  const gone = list.find((r) => r.id === id) || null;
  saveReminders(store, list.filter((r) => r.id !== id));
  return gone;
}

/** Fällige, noch nicht gemeldete Erinnerungen (Web: solange die App offen ist oder beim nächsten Öffnen). */
export function dueReminders(store, now = new Date()) {
  return loadReminders(store).filter((r) => !r.done && Date.parse(r.at) <= now.getTime());
}

export function markDone(store, ids) {
  const set = new Set(ids);
  saveReminders(store, loadReminders(store).map((r) => (set.has(r.id) ? { ...r, done: true } : r)));
}

/** Erinnerung zum Text finden: Nummer (1-basiert in der sortierten Liste) oder Wortübereinstimmung. */
export function findReminder(store, query, now = new Date()) {
  const act = activeReminders(store, now);
  const q = norm(query);
  const num = q.match(/^(?:nummer |die )?(\d+|erste|zweite|dritte|vierte|fuenfte)$/);
  if (num) {
    const i = ({ erste: 1, zweite: 2, dritte: 3, vierte: 4, fuenfte: 5 }[num[1]] || Number(num[1])) - 1;
    return act[i] ? [act[i]] : [];
  }
  const words = q.split(' ').filter((x) => x.length > 2 && !['die', 'der', 'das', 'den', 'erinnerung', 'an'].includes(x));
  if (!words.length) return [];
  return act.filter((r) => words.every((x) => norm(r.text).includes(x)));
}
