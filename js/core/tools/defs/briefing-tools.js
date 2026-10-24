// Neue Werkzeuge fürs Morgen-Briefing (auch einzeln nutzbar):
//   get_weather (Open-Meteo, aktueller Standort), get_news (tagesschau-RSS), get_calendar_events (nur Android).
import { fetchLimited, MAX_WEATHER_BYTES, MAX_FEED_BYTES } from '../../briefing/net.js';
import { buildWeatherUrl, parseWeather, weatherSentence } from '../../briefing/weather.js';
import { feedUrlsFor, parseRss, mergeFeeds, newsLimitFor, RESSORTS, RESSORT_IDS } from '../../briefing/news.js';
import { resolveCoords } from '../../briefing/location.js';
import { cleanText } from '../../briefing/sanitize.js';
import { loadSettings } from '../../settings.js';
import { normalizeBriefingConfig } from '../../briefing/trigger.js';

const obj = (props, required = []) => ({ type: 'object', properties: props, required });

const NUM_DE = ['keine', 'einen', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
const countDe = (n) => NUM_DE[n] || String(n);

export function formatClock(ms, timeZone) {
  return new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: timeZone || undefined })
    .replace(/^0(\d)/, '$1');
}

/** Termine der kommenden 7 Tage → Satz (Wochentag, Uhrzeit, Titel; höchstens 5 genannt). */
export function weekEventsSentence(events, { timeZone } = {}) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return 'In den nächsten sieben Tagen stehen keine Termine im Kalender.';
  const wd = (ms) => new Date(ms).toLocaleDateString('de-DE', { weekday: 'long', timeZone: timeZone || undefined });
  const items = list.slice(0, 5).map((e) => (e.allDay ? `${wd(e.begin)} ganztägig ${e.title}` : `${wd(e.begin)} ${formatClock(e.begin, timeZone)} Uhr ${e.title}`));
  return `In den nächsten sieben Tagen haben Sie ${list.length === 1 ? 'einen Termin' : `${countDe(list.length)} Termine`}: ${items.join('; ')}` +
    (list.length > 5 ? ' und weitere.' : '.');
}

/** Termine → Satz. titles=false nennt nur Anzahl und erste Uhrzeit. */
export function eventsSentence(events, { titles = true, day = 'heute', timeZone } = {}) {
  const list = Array.isArray(events) ? events : [];
  const Day = day === 'morgen' ? 'Morgen' : 'Heute';
  if (!list.length) return `${Day} stehen keine Termine im Kalender.`;
  const timed = list.filter((e) => !e.allDay);
  const allDay = list.filter((e) => e.allDay);
  const n = list.length;
  let s = `${Day} haben Sie ${n === 1 ? 'einen Termin' : `${countDe(n)} Termine`}`;
  if (timed.length) {
    const first = timed[0];
    const t = formatClock(first.begin, timeZone);
    s += n === 1 ? `, um ${t} Uhr` : `, der erste um ${t} Uhr`;
    if (titles && first.title) s += `: ${first.title}`;
    if (titles && timed.length > 1) {
      s += '. Danach ' + timed.slice(1, 4).map((e) => `${formatClock(e.begin, timeZone)} Uhr ${e.title}`).join(', ');
    }
  }
  if (allDay.length) {
    s += titles
      ? `. Ganztägig: ${allDay.slice(0, 3).map((e) => e.title).join(', ')}`
      : `. ${allDay.length === 1 ? 'Einer davon ist' : `${countDe(allDay.length)} davon sind`} ganztägig`;
  }
  return s.replace(/\s+/g, ' ').replace(/\.\./g, '.') + '.';
}

export const BRIEFING_TOOLS = [
  {
    name: 'get_weather',
    risk: 'lesen',
    sourceLabel: 'Wetter',
    externalData: true, // fremde Texte im Ergebnis → danach kein propose_memory in dieser Runde
    description: 'Wetter für heute oder morgen am aktuellen Standort des Nutzers (Open-Meteo).',
    userHint: 'Wetter („Wie wird das Wetter?“)',
    readOnly: true,
    parameters: obj({ day: { type: 'string', enum: ['heute', 'morgen'], description: 'heute (Standard) oder morgen' } }),
    localTriggers: [
      { re: /^(?:und\s+)?(?:wie\s+(?:wird|ist)\s+(?:das\s+|denn\s+das\s+)?wetter|wetter(?:bericht)?|brauche?\s+ich\s+(?:einen\s+)?(?:regen)?schirm|regnet\s+es)\b(?:\s+(heute|morgen))?.{0,20}$/i,
        parse: (m, raw) => ({ day: /morgen/i.test(raw) ? 'morgen' : 'heute' }) }
    ],
    async execute({ day = 'heute' } = {}, ctx) {
      const loc = await resolveCoords(ctx);
      if (!loc.coords) {
        const msg = loc.reason === 'denied'
          ? 'Für das Wetter bräuchte ich Ihren Standort – die Erlaubnis dafür fehlt.'
          : 'Für das Wetter bräuchte ich Ihren Standort, der ist gerade nicht verfügbar.';
        return { ok: false, message: msg, data: { reason: loc.reason || 'no-location' } };
      }
      try {
        const text = await fetchLimited(buildWeatherUrl(loc.coords.lat, loc.coords.lon), {
          fetchFn: ctx.fetchFn, timeoutMs: 4000, maxBytes: MAX_WEATHER_BYTES, signal: ctx.signal
        });
        const w = parseWeather(text, day === 'morgen' ? 1 : 0);
        return { ok: true, message: weatherSentence(w, { stale: loc.stale }), data: { ...w, stale: loc.stale } };
      } catch (e) {
        return { ok: false, message: 'Die Wetterdaten sind gerade nicht erreichbar.', data: { reason: e.code || 'error' } };
      }
    }
  },
  {
    name: 'get_news',
    risk: 'lesen',
    sourceLabel: 'Nachrichten',
    externalData: true, // fremde Texte im Ergebnis → danach kein propose_memory in dieser Runde
    description: 'Aktuelle Schlagzeilen von tagesschau.de (optional ein Ressort: ' + RESSORT_IDS.join(', ') + ').',
    userHint: 'Nachrichten („Was gibt es Neues?“)',
    readOnly: true,
    parameters: obj({ ressort: { type: 'string', enum: RESSORT_IDS, description: 'optional, sonst die eingestellten Ressorts' } }),
    localTriggers: [
      { re: /^(?:was\s+gibt(?:'?s|\s+es)\s+neues|(?:die\s+|aktuelle\s+|neueste\s+)?(?:nachrichten|schlagzeilen|news)(?:\s+bitte|\s+heute)?|lies\s+(?:mir\s+)?(?:bitte\s+)?die\s+nachrichten(?:\s+vor)?)[?.!]*$/i,
        parse: () => ({}) }
    ],
    async execute({ ressort } = {}, ctx) {
      const cfg = normalizeBriefingConfig(loadSettings(ctx.store).briefing, RESSORT_IDS);
      const ressorts = ressort && RESSORTS[ressort] ? [ressort] : cfg.newsRessorts;
      const urls = feedUrlsFor(ressorts);
      const lists = await Promise.all(urls.map((u) => fetchLimited(u, {
        fetchFn: ctx.fetchFn, timeoutMs: 4000, maxBytes: MAX_FEED_BYTES, signal: ctx.signal
      }).then((x) => parseRss(x)).catch(() => null)));
      const ok = lists.filter(Boolean);
      if (!ok.length) return { ok: false, message: 'Die Nachrichten sind gerade nicht erreichbar.', data: { reason: 'network' } };
      const items = mergeFeeds(ok, newsLimitFor(ressorts));
      if (!items.length) return { ok: false, message: 'Gerade liegen keine Schlagzeilen vor.', data: { reason: 'empty' } };
      const label = ressorts.length ? ` (${ressorts.map((r) => RESSORTS[r].label).join(', ')})` : '';
      return {
        ok: true,
        message: `Die Schlagzeilen von tagesschau.de${label}: ` + items.map((i) => i.title.replace(/[.!?…]+$/, '')).join('. ') + '.',
        data: { items, ressorts }
      };
    }
  },
  {
    name: 'get_calendar_events',
    risk: 'lesen',
    sourceLabel: 'Terminen',
    externalData: true, // fremde Texte im Ergebnis → danach kein propose_memory in dieser Runde
    description: 'Liest die Termine von heute, morgen oder der kommenden Woche (die nächsten 7 Tage ab morgen) aus dem Kalender des Handys (nur Android-App).',
    userHint: 'Termine („Welche Termine habe ich heute?“, nur App)',
    readOnly: true,
    parameters: obj({ day: { type: 'string', enum: ['heute', 'morgen', 'woche'], description: 'heute (Standard), morgen oder woche (nächste 7 Tage)' } }),
    localTriggers: [
      { re: /^(?:welche\s+termine|was\s+steht\s+(?:heute\s+|morgen\s+)?im\s+kalender|meine\s+termine|habe?\s+ich\s+(?:heute\s+|morgen\s+)?(?:noch\s+)?(?:einen\s+|irgendwelche\s+)?termine?)\b.{0,30}$/i,
        parse: (m, raw) => ({ day: /woche/i.test(raw) ? 'woche' : /morgen/i.test(raw) ? 'morgen' : 'heute' }) }
    ],
    async execute({ day = 'heute' } = {}, ctx) {
      if (!ctx.device?.getCalendarEvents) {
        return { ok: false, unsupported: true, message: 'Termine aus dem Kalender gibt es nur in der Android-App.' };
      }
      let r;
      const week = day === 'woche';
      try { r = await ctx.device.getCalendarEvents({ dayOffset: week || day === 'morgen' ? 1 : 0, days: week ? 7 : 1, interactive: ctx.interactive !== false }); } catch (e) { r = { ok: false, message: e.message }; }
      if (!r?.ok) {
        return { ok: false, message: r?.permission === 'denied' || r?.permission === 'prompt'
          ? 'Für Ihre Termine bräuchte ich Zugriff auf den Kalender.' : 'Der Kalender ist gerade nicht lesbar.', data: { reason: r?.permission || 'error' } };
      }
      const events = (r.events || []).slice(0, week ? 20 : 12).map((e) => ({
        title: cleanText(e.title, 120) || 'Termin',
        location: cleanText(e.location, 60),
        begin: Number(e.begin) || 0,
        end: Number(e.end) || 0,
        allDay: Boolean(e.allDay)
      }));
      const message = week ? weekEventsSentence(events, { timeZone: ctx.timeZone }) : eventsSentence(events, { titles: true, day, timeZone: ctx.timeZone });
      return { ok: true, message, data: { events, day } };
    }
  }
];
