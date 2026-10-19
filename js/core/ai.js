// Aufruf einer OpenAI-kompatiblen Chat-API (xAI, OpenAI, Gemini, eigene URL).
// fetch wird injiziert → im Browser, in Node-Tests und später nativ nutzbar.
//
// Bei 503/429/Überlastung: bis zu 2 Retries mit Backoff (1s, 3s), danach Fallback-Modelle.
// Bei Gemini zusätzlich: Fallback-Liste dynamisch aus GET /models (bevorzugt 3.x Flash).
// Bei 404 „no longer available“: /models holen und ein verfügbares Modell wählen.

export class AIError extends Error {
  constructor(message, code, { status, detail, model } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.model = model;
  }
}

/** Statische Fallback-Ketten (Gemini: nur noch 3.x – 2.5 ist für neue Nutzer oft gesperrt). */
export const MODEL_FALLBACKS = Object.freeze({
  gemini: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
  custom: []
});

const OVERLOAD_RE = /high demand|overloaded|unavailable|resource.?exhausted|try again later|capacity|quota|rate.?limit|too many requests/i;
const GONE_RE = /no longer available|not (found|available)|is not supported|deprecated|retired/i;

export function isRetriableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

export function isOverloadError(status, detail) {
  if (isRetriableStatus(status)) return true;
  return typeof detail === 'string' && OVERLOAD_RE.test(detail);
}

export function isGoneModelError(status, detail) {
  if (status !== 404) return false;
  return typeof detail === 'string' && GONE_RE.test(detail);
}

/** Freundliche deutsche Meldung für HTTP-Fehler. */
export function friendlyHttpError(status, detail) {
  const d = typeof detail === 'string' ? detail : (detail ? JSON.stringify(detail) : '');
  if (status === 401 || status === 403) {
    return 'Der API-Schlüssel wird nicht akzeptiert. Bitte in den Einstellungen prüfen (und bei Gemini unter aistudio.google.com/apikey erneuern).';
  }
  if (status === 429) {
    return 'Zu viele Anfragen – das kostenlose Kontingent oder das Minutenlimit ist erschöpft. Bitte kurz warten und es erneut versuchen.';
  }
  if (status === 503 || status === 502 || status === 504) {
    return 'Der KI-Dienst ist gerade überlastet oder kurz nicht erreichbar. Bitte gleich noch einmal versuchen.';
  }
  if (status === 404) {
    if (GONE_RE.test(d)) {
      return 'Dieses Modell ist nicht mehr verfügbar. Bitte unter Einstellungen → Laden ein aktuelles Modell wählen (z. B. gemini-3.8-flash).';
    }
    return 'Modell oder Adresse nicht gefunden. Bitte den Modellnamen in den Einstellungen prüfen.';
  }
  const short = d && d.length < 180 ? d : (d ? d.slice(0, 160) + '…' : '');
  return short ? `Fehler ${status}: ${short}` : `Fehler ${status} vom Anbieter.`;
}

export function fallbackModelsFor(providerId, primary, dynamicList = []) {
  const chain = [
    ...(dynamicList || []),
    ...(MODEL_FALLBACKS[providerId] || MODEL_FALLBACKS.custom)
  ];
  const out = [];
  const add = (m) => { if (m && !out.includes(m)) out.push(m); };
  add(primary);
  for (const m of chain) add(m);
  return out;
}

/**
 * Sortiert verfügbare Gemini-Modell-IDs für Fallbacks:
 * Flash/Flash-Lite der 3.x-Familie zuerst, dann andere gemini-*, Rest.
 */
export function preferGeminiFallbacks(ids, primary) {
  const clean = [...new Set((ids || []).map((id) => String(id || '').replace(/^models\//, '')).filter(Boolean))];
  const score = (id) => {
    const x = id.toLowerCase();
    if (x === String(primary || '').toLowerCase()) return 0;
    const is3 = /gemini-3(\.\d+)?/.test(x);
    const flashLite = /flash-lite/.test(x);
    const flash = /flash/.test(x) && !flashLite;
    if (is3 && flash) return 1;
    if (is3 && flashLite) return 2;
    if (is3) return 3;
    if (flash) return 4;
    if (flashLite) return 5;
    if (x.startsWith('gemini-')) return 6;
    return 9;
  };
  return clean.sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

function sleep(ms, sleepFn) {
  return (sleepFn || ((t) => new Promise((r) => setTimeout(r, t))))(ms);
}

/** Standard-Backoff: Versuch 0→1: 1s, Versuch 1→2: 3s */
export function backoffForAttempt(attempt, schedule = [1000, 3000]) {
  return schedule[Math.min(attempt, schedule.length - 1)];
}

async function requestOnce(cfg, path, { method = 'GET', body, fetchFn = globalThis.fetch, timeoutMs = 60000 } = {}) {
  if (!cfg.baseUrl) throw new AIError('Keine Basis-URL eingestellt.', 'config');
  if (!cfg.apiKey) throw new AIError('Kein API-Schlüssel hinterlegt. Bitte in den Einstellungen eintragen.', 'nokey');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(cfg.baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new AIError('Zeitüberschreitung – der Server antwortet nicht.', 'timeout');
    throw new AIError('Netzwerkfehler oder vom Anbieter blockiert (CORS). Internetverbindung und Basis-URL prüfen.', 'network');
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    if (Array.isArray(data)) data = data[0];
    const detail = data?.error?.message || data?.error || data?.message || res.statusText;
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    throw new AIError(friendlyHttpError(res.status, detailStr), 'http', {
      status: res.status, detail: detailStr, model: body?.model
    });
  }
  return data;
}

/** GET /models → bereinigte ID-Liste (ohne models/-Präfix). */
export async function fetchModelIds(cfg, opts = {}) {
  const data = await requestOnce(cfg, '/models', {
    fetchFn: opts.fetchFn,
    timeoutMs: opts.timeoutMs
  });
  return [...new Set((data?.data || []).map((m) => String(m.id || '').replace(/^models\//, '')).filter(Boolean))];
}

/**
 * Wie requestOnce, aber:
 * - bei Überlastung: retries× Backoff (Standard 2 → 1s, 3s), dann nächstes Fallback-Modell
 * - bei Gemini: Fallback-Liste zusätzlich aus /models (3.x Flash bevorzugt)
 * - bei 404 „no longer available“: /models holen und verfügbares Modell nehmen
 */
export async function requestWithRetry(cfg, path, opts = {}) {
  const {
    retries = 2,
    backoffSchedule = [1000, 3000],
    sleepFn,
    body,
    dynamicFallbacks,
    ...rest
  } = opts;
  const providerId = cfg.providerId || cfg.id;

  // GET /models o. Ä. ohne Modell: nur Retry
  if (!body?.model) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestOnce(cfg, path, { ...rest, body });
        return { data, model: null, usedFallback: false };
      } catch (e) {
        last = e;
        if (e.code !== 'http' || !isOverloadError(e.status, e.detail) || attempt === retries) throw e;
        await sleep(backoffForAttempt(attempt, backoffSchedule), sleepFn);
      }
    }
    throw last;
  }

  let dynamic = dynamicFallbacks || [];
  // Gemini: verfügbare Modelle einmalig laden (Fehler hier ignorieren → statische Liste)
  if (providerId === 'gemini' && !opts.skipModelDiscovery) {
    try {
      const ids = await fetchModelIds(cfg, rest);
      dynamic = preferGeminiFallbacks(ids, body.model);
    } catch { /* statische Fallbacks reichen */ }
  }

  const models = fallbackModelsFor(providerId, body.model, dynamic);
  let lastErr;
  const primary = models[0];
  let goneHandled = false;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const attemptBody = { ...body, model };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestOnce(cfg, path, { ...rest, body: attemptBody });
        return { data, model, usedFallback: model !== primary };
      } catch (e) {
        lastErr = e;
        if (e.code !== 'http') throw e;

        // 404: Modell weg → /models neu laden und Kette ersetzen (einmal)
        if (isGoneModelError(e.status, e.detail) && !goneHandled && providerId === 'gemini') {
          goneHandled = true;
          try {
            const ids = await fetchModelIds(cfg, rest);
            const preferred = preferGeminiFallbacks(ids, null);
            if (preferred.length) {
              // aktuelle + weitere Modelle durch die frische Liste ersetzen
              models.length = 0;
              models.push(...fallbackModelsFor(providerId, preferred[0], preferred));
              mi = -1; // Schleife startet bei 0 neu
              break;
            }
          } catch { /* weiter mit nächstem statischen Fallback */ }
          break;
        }

        if (!isOverloadError(e.status, e.detail)) throw e;
        if (attempt < retries) {
          await sleep(backoffForAttempt(attempt, backoffSchedule), sleepFn);
          continue;
        }
        break; // nächstes Modell
      }
    }
  }
  throw lastErr || new AIError('Der KI-Dienst ist überlastet. Bitte später erneut versuchen.', 'http', { status: 503 });
}

/**
 * Roher Chat-Completions-Aufruf. messages = OpenAI-Nachrichten.
 * Ergebnis: { data, model, usedFallback }
 */
export async function askAIRaw(cfg, messages, opts = {}) {
  const body = { model: cfg.model, messages };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice || 'auto';
  }
  return requestWithRetry(
    { ...cfg, providerId: cfg.providerId || cfg.id },
    '/chat/completions',
    {
      method: 'POST',
      body,
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries ?? 2,
      backoffSchedule: opts.backoffSchedule || [1000, 3000],
      sleepFn: opts.sleepFn,
      dynamicFallbacks: opts.dynamicFallbacks,
      skipModelDiscovery: opts.skipModelDiscovery
    }
  );
}

/**
 * Fragt die KI. Bei Fallback-Modell: kurzer deutscher Hinweis am Ende.
 */
export async function askAI(cfg, systemPrompt, history, opts = {}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-(opts.maxHistory || 12)).map((m) => ({ role: m.role, content: m.text }))
  ];
  const { data, model, usedFallback } = await askAIRaw(cfg, messages, opts);
  let text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AIError('Leere Antwort vom Anbieter erhalten.', 'empty');
  text = String(text).trim();
  if (usedFallback && model) {
    text += ` (Antwort über Ersatzmodell ${model}, weil das gewünschte gerade überlastet oder nicht verfügbar war.)`;
  }
  return text;
}

/** Listet verfügbare Modelle (GET /models). */
export async function listModels(cfg, opts = {}) {
  const { data } = await requestWithRetry(cfg, '/models', {
    fetchFn: opts.fetchFn,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries ?? 2,
    backoffSchedule: opts.backoffSchedule || [1000, 3000],
    sleepFn: opts.sleepFn
  });
  return [...new Set((data?.data || []).map((m) => String(m.id || '').replace(/^models\//, '')).filter(Boolean))].sort();
}
