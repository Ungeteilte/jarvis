// Sammelt alle Briefing-Fakten parallel über die Werkzeug-Registry (mit hartem Zeitlimit).
import { withTimeout } from './net.js';
import { cleanText } from './sanitize.js';
import { loadNotes } from '../skills.js';
import { RESSORTS } from './news.js';
import { formatClock } from '../tools/defs/briefing-tools.js';

const TIMEOUT_RESULT = { ok: false, message: 'Zeitüberschreitung.', data: { reason: 'timeout' } };

/**
 * → facts = { date, time, weather|null, weatherNote|null, events|null, calendarNote|null,
 *             news|null, newsRessorts, battery|null, notes[], timers }
 * events/news = null heißt „nicht verfügbar“ (≠ leere Liste).
 */
export async function gatherFacts({ registry, ctx, cfg, timeoutMs = 5000 }) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const tz = ctx.timeZone;
  const run = (name, args = {}) => (registry.get(name)
    ? withTimeout(registry.run(name, args, ctx), timeoutMs, TIMEOUT_RESULT).catch(() => TIMEOUT_RESULT)
    : Promise.resolve(null));
  const want = cfg.content || {};
  const [weather, calendar, news, battery] = await Promise.all([
    want.weather ? run('get_weather', { day: 'heute' }) : null,
    want.calendar && ctx.device?.getCalendarEvents ? run('get_calendar_events', { day: 'heute' }) : null,
    want.news ? run('get_news', {}) : null,
    want.battery && ctx.device?.getBattery ? run('get_battery', {}) : null
  ]);

  const facts = {
    date: now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz || undefined }),
    time: formatClock(now.getTime(), tz),
    weather: null, weatherNote: null,
    events: null, calendarNote: null,
    news: null, newsRessorts: (cfg.newsRessorts || []).map((r) => RESSORTS[r]?.label).filter(Boolean),
    battery: null,
    notes: [],
    timers: 0
  };
  if (weather?.ok && weather.data) {
    const w = weather.data;
    facts.weather = { now: w.now, nowText: w.nowText, min: w.min, max: w.max, rainChance: w.rainChance, dayText: w.dayText, stale: Boolean(w.stale) };
  } else if (weather) facts.weatherNote = cleanText(weather.message, 140);
  if (calendar?.ok && calendar.data) {
    facts.events = calendar.data.events.map((e) => ({
      time: e.allDay ? null : formatClock(e.begin, tz), title: e.title, allDay: e.allDay, location: e.location || ''
    }));
  } else if (calendar && !calendar.unsupported) facts.calendarNote = cleanText(calendar.message, 140);
  if (news?.ok && news.data) facts.news = news.data.items.map((i) => ({ title: i.title, summary: i.summary }));
  if (battery?.ok && battery.data) facts.battery = { percent: Math.round(battery.data.level * 100), charging: Boolean(battery.data.charging) };
  if (want.notes) {
    facts.notes = loadNotes(ctx.store).slice(-3).map((n) => cleanText(n.text, 100)).filter(Boolean);
    facts.timers = ctx.timers?.list?.().length || 0;
  }
  return facts;
}
