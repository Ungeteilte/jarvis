// Netz-Zugriffe für das Briefing: nur HTTPS, nur zwei feste Hosts, Größen- und Zeitlimit.

export const MAX_FEED_BYTES = 300 * 1024;
export const MAX_WEATHER_BYTES = 64 * 1024;

const ALLOWED = [
  /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?[A-Za-z0-9_.,=&%-]+$/,
  /^https:\/\/www\.tagesschau\.de\/[a-z0-9/-]+~rss2\.xml$/
];

/** Nur Open-Meteo-Forecast und tagesschau-RSS sind erlaubt. */
export function isAllowedDataUrl(url) {
  const u = String(url || '');
  return ALLOWED.some((re) => re.test(u));
}

/** Lädt Text mit Timeout und Größenlimit. Wirft Error mit .code. */
export async function fetchLimited(url, { fetchFn, timeoutMs = 4000, maxBytes = MAX_FEED_BYTES, signal } = {}) {
  if (!isAllowedDataUrl(url)) throw Object.assign(new Error('Adresse nicht erlaubt.'), { code: 'blocked' });
  const f = fetchFn || globalThis.fetch;
  if (typeof f !== 'function') throw Object.assign(new Error('Kein Netzwerk verfügbar.'), { code: 'nofetch' });
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ac?.abort(), timeoutMs);
  const onAbort = () => ac?.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  try {
    let res;
    try {
      res = await f(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ac?.signal });
    } catch (e) {
      throw Object.assign(new Error(ac?.signal?.aborted ? 'Zeitüberschreitung.' : 'Netzwerkfehler.'), { code: ac?.signal?.aborted ? 'timeout' : 'network' });
    }
    if (res.url && !isAllowedDataUrl(res.url)) throw Object.assign(new Error('Weiterleitung nicht erlaubt.'), { code: 'blocked' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'http', status: res.status });
    const len = Number(res.headers?.get?.('content-length') || 0);
    if (len > maxBytes) throw Object.assign(new Error('Antwort zu groß.'), { code: 'too-big' });
    if (res.body?.getReader && typeof TextDecoder === 'function') {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let total = 0;
      let out = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { try { reader.cancel(); } catch { /* egal */ } throw Object.assign(new Error('Antwort zu groß.'), { code: 'too-big' }); }
        out += dec.decode(value, { stream: true });
      }
      return out + dec.decode();
    }
    const text = await res.text();
    if (text.length > maxBytes) throw Object.assign(new Error('Antwort zu groß.'), { code: 'too-big' });
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** Promise mit hartem Zeitlimit (für parallele Datensammlung). */
export function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((resolve) => { t = setTimeout(() => resolve(fallback), ms); })
  ]);
}
