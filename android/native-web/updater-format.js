/** Reine Formatierung für die Update-Anzeige (browser-frei, per node:test geprüft). */

export const INTERVAL_OPTIONS = [3, 6, 12, 24];

function two(n) { return String(n).padStart(2, '0'); }

/** „19.10., 21:14“ bzw. „heute, 21:14“. */
export function formatTime(ms, now = Date.now()) {
  if (!ms) return 'noch nie';
  const d = new Date(ms);
  const n = new Date(now);
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return `heute, ${hm}`;
  return `${two(d.getDate())}.${two(d.getMonth() + 1)}., ${hm}`;
}

/** Statuszeile: „Zuletzt geprüft: heute, 21:14 – aktuell (v0.3)“. */
export function formatStatusLine(s = {}, now = Date.now()) {
  const when = `Zuletzt geprüft: ${formatTime(s.lastCheck, now)}`;
  const inst = s.installedVersionName ? `v${s.installedVersionName}` : '';
  switch (s.status) {
    case 'checking': return 'Suche nach Updates …';
    case 'downloading': return `Lade v${s.availableVersionName || '?'} … ${s.progress ? s.progress + ' %' : ''}`.trim();
    case 'ready': return `${when} – v${s.availableVersionName} bereit zur Installation`;
    case 'waiting-wifi': return `${when} – v${s.availableVersionName} verfügbar, Download wartet auf WLAN`;
    case 'installing': return s.message || 'Installation läuft …';
    case 'rate-limited': return `${when} – GitHub-Limit erreicht, später erneut`;
    case 'error': return `${when} – ${s.message || 'Fehler'}`;
    case 'up-to-date': return `${when} – aktuell (${inst})`;
    default: return s.lastCheck ? `${when} – aktuell (${inst})` : `Zuletzt geprüft: noch nie – installiert ${inst}`;
  }
}

/** Soll die Karte „Update verfügbar“ erscheinen? */
export function shouldShowCard(s = {}) {
  return Number(s.availableVersionCode) > Number(s.installedVersionCode || 0);
}

export function normalizeInterval(h) {
  const n = Number(h);
  return INTERVAL_OPTIONS.includes(n) ? n : 6;
}
