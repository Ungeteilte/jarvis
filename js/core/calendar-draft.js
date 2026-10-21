// v0.9 W5 – Kalendereintrag als ENTWURF: Android öffnet die Kalender-App vorausgefüllt (ACTION_INSERT,
// keine Schreibberechtigung, du tippst „Speichern“); die PWA bietet eine .ics-Datei an.
import { parseWhen } from './reminders.js';

export const DEFAULT_DURATION_MS = 60 * 60 * 1000;

const norm = (s) => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/**
 * „Trag morgen um 15 Uhr Zahnarzt ein“ / „Termin am Freitag 18 bis 20 Uhr Grillen im Garten“
 * → { title, begin: Date, end: Date, location? } | { needsTime, title } | { needsTitle }
 */
export function parseEvent(sentence, now = new Date()) {
  let s = String(sentence || '').replace(/[„“"]/g, '').trim();
  s = s.replace(/^(?:bitte\s+)?(?:trag(?:e)?|schreib(?:e)?)\s+(?:mir\s+)?(?:bitte\s+)?/i, '')
    .replace(/\s+(?:in\s+(?:den|meinen)\s+kalender\s+)?ein[.!]?$/i, '')
    .replace(/^(?:einen\s+|neuen\s+)?termin\s+(?:eintragen|anlegen)?\s*:?\s*/i, '')
    .replace(/\s+(?:eintragen|anlegen)[.!]?$/i, '');
  // Ende „bis 17 Uhr“ / „bis 17:30“ zuerst herausnehmen
  let endClock = null;
  // „von 18 bis 20 Uhr“ → Beginn 18 Uhr, Ende 20 Uhr
  const span = s.match(/\bvon\s+(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr\s*)?(?:bis|-)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr)?/i);
  if (span) {
    endClock = { h: Number(span[3]), m: Number(span[4] || 0) };
    s = s.replace(span[0], ` um ${span[1]}:${span[2] || '00'} `);
  }
  const bis = s.match(/\s+bis\s+(\d{1,2})(?:[:.](\d{2}))?(?:\s*uhr)?\b/i);
  if (bis && !endClock) { endClock = { h: Number(bis[1]), m: Number(bis[2] || 0) }; s = s.replace(bis[0], ' '); }
  // Ort „in/im/bei …“ am Ende (nur wenn klar abgetrennt: „ … in der Praxis Müller“)
  let location = '';
  const loc = s.match(/\s+(?:ort|bei|im|in der|in)\s*:?\s+([A-ZÄÖÜ][\wäöüÄÖÜß.\- ]{1,60})$/);
  const w = parseWhen(s, now);
  if (w?.invalid) return { invalid: true };
  let rest = norm(s);
  for (const sp of w?.spans || []) rest = rest.replace(sp, ' ');
  if (loc && rest.includes(norm(loc[0]).trim())) {
    location = loc[1].trim();
    rest = rest.replace(norm(loc[0]).trim(), ' ');
  }
  // Titel in Originalschreibweise wiederherstellen
  const map = new Map(s.split(/\s+/).map((o) => [norm(o).replace(/[,.:]+$/, ''), o.replace(/[,.:]+$/, '')]));
  let title = rest.split(/\s+/).filter(Boolean).map((x) => map.get(x.replace(/[,.:]+$/, '')) || x).join(' ')
    .replace(/^(?:einen\s+|den\s+)?termin\s*(?:für|fuer|zum|zur|mit)?\s*:?\s*/i, '')
    .replace(/^(?:für|fuer|zum|zur)\s+/i, '')
    .replace(/[\s,.;:–-]+$/, '').replace(/^[\s,.;:–-]+/, '').trim().slice(0, 120);
  if (title) title = title[0].toUpperCase() + title.slice(1);
  if (!title) return { needsTitle: true };
  if (!w) return { needsTime: true, title };
  const begin = w.date;
  let end = new Date(begin.getTime() + DEFAULT_DURATION_MS);
  if (endClock && endClock.h <= 23 && endClock.m <= 59) {
    const e = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate(), endClock.h, endClock.m);
    if (e > begin) end = e;
  }
  return { title, begin, end, location };
}

const pad = (n) => String(n).padStart(2, '0');
const icsDate = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const icsText = (s) => String(s || '').replace(/[\u0000-\u001F]/g, ' ').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').slice(0, 200);

/** iCalendar-Datei (RFC 5545) für die PWA. Zeilen mit CRLF. */
export function buildIcs({ title, begin, end, location = '', now = new Date(), uid }) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jarvis//v0.9//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid || `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}@jarvis`}`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(new Date(begin))}`,
    `DTEND:${icsDate(new Date(end))}`,
    `SUMMARY:${icsText(title)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return lines.join('\r\n') + '\r\n';
}
