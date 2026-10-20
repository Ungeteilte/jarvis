// Wetter über Open-Meteo (kein Schlüssel, CORS offen). Nur gerundete Koordinaten verlassen das Gerät.
import { roundCoord } from './state.js';

export const WMO_DE = {
  0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bedeckt',
  45: 'neblig', 48: 'neblig mit Reif',
  51: 'leichter Nieselregen', 53: 'Nieselregen', 55: 'starker Nieselregen',
  56: 'gefrierender Nieselregen', 57: 'gefrierender Nieselregen',
  61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen',
  66: 'gefrierender Regen', 67: 'gefrierender Regen',
  71: 'leichter Schneefall', 73: 'Schneefall', 75: 'starker Schneefall', 77: 'Schneegriesel',
  80: 'leichte Regenschauer', 81: 'Regenschauer', 82: 'heftige Regenschauer',
  85: 'Schneeschauer', 86: 'starke Schneeschauer',
  95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'schweres Gewitter mit Hagel'
};

export function buildWeatherUrl(lat, lon) {
  const q = [
    `latitude=${roundCoord(lat).toFixed(2)}`,
    `longitude=${roundCoord(lon).toFixed(2)}`,
    'current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum',
    'timezone=auto',
    'forecast_days=2'
  ].join('&');
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Open-Meteo-JSON → kompakte Fakten. dayIndex 0 = heute, 1 = morgen. Wirft bei Unsinn. */
export function parseWeather(json, dayIndex = 0) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  if (!j || typeof j !== 'object' || !j.daily) throw new Error('Unerwartete Wetterdaten.');
  const i = dayIndex === 1 ? 1 : 0;
  const pick = (arr) => (Array.isArray(arr) ? num(arr[i]) : null);
  const code = pick(j.daily.weather_code);
  const cur = j.current || {};
  const out = {
    day: i === 0 ? 'heute' : 'morgen',
    now: i === 0 ? num(cur.temperature_2m) : null,
    feels: i === 0 ? num(cur.apparent_temperature) : null,
    nowText: i === 0 && num(cur.weather_code) !== null ? (WMO_DE[cur.weather_code] || null) : null,
    wind: i === 0 ? num(cur.wind_speed_10m) : null,
    max: pick(j.daily.temperature_2m_max),
    min: pick(j.daily.temperature_2m_min),
    rainChance: pick(j.daily.precipitation_probability_max),
    rainMm: pick(j.daily.precipitation_sum),
    dayText: code !== null ? (WMO_DE[code] || null) : null,
    timezone: typeof j.timezone === 'string' ? j.timezone.slice(0, 64) : null
  };
  if (out.max === null && out.min === null && out.now === null) throw new Error('Keine Wetterwerte erhalten.');
  return out;
}

const deg = (v) => `${Math.round(v)} Grad`;

/** Ein bis zwei gesprochene Sätze zum Wetter. */
export function weatherSentence(w, { stale = false } = {}) {
  if (!w) return '';
  const where = stale ? 'An Ihrem zuletzt bekannten Ort' : 'Bei Ihnen';
  const parts = [];
  if (w.day === 'heute' && w.now !== null) {
    parts.push(`${where} sind es gerade ${deg(w.now)}${w.nowText ? `, ${w.nowText}` : ''}.`);
  }
  const range = w.min !== null && w.max !== null ? `zwischen ${Math.round(w.min)} und ${deg(w.max)}` : w.max !== null ? `bis ${deg(w.max)}` : '';
  const lead = w.day === 'morgen' ? 'Morgen' : 'Heute';
  let s = `${lead} ${w.dayText ? `${w.dayText}, ` : ''}${range}`.trim();
  if (w.rainChance !== null && w.rainChance >= 30) s += `, Regenrisiko ${Math.round(w.rainChance)} Prozent`;
  if (s !== lead) parts.push(s.replace(/,\s*$/, '') + '.');
  return parts.join(' ');
}
