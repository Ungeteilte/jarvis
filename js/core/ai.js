// Aufruf einer OpenAI-kompatiblen Chat-API (xAI, OpenAI, Gemini, eigene URL).
// fetch wird injiziert → im Browser, in Node-Tests und später nativ nutzbar.
// Bei 503/429/Überlastung: einmal warten und erneut versuchen, dann Fallback-Modelle.

export class AIError extends Error {
  constructor(message, code, { status, detail, model } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.model = model;
  }
}

/** Fallback-Kette pro Anbieter (nach dem primären Modell, ohne Duplikate). */
export const MODEL_FALLBACKS = Object.freeze({
  gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'],
  openai: ['gpt-6-luna', 'gpt-6.1-sol'],
  xai: ['grok-4.7', 'grok-4.6', 'grok-4.5'],
  custom: []
});

const OVERLOAD_RE = /high demand|overloaded|unavailable|resource.?exhausted|try again later|capacity|quota|rate.?limit|too many requests/i;

export function isRetriableStatus(status) {
  return status === 429 || status === 503 || status === 502 || status === 504;
}

export function isOverloadError(status, detail) {
  if (isRetriableStatus(status)) return true;
  return typeof detail === 'string' && OVERLOAD_RE.test(detail);
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
    return 'Der KI-Dienst ist gerade überlastet oder kurz nicht erreichbar. Bitte gleich noch einmal versuchen' +
      (d && OVERLOAD_RE.test(d) ? '' : '') + '.';
  }
  if (status === 404) {
    return 'Modell oder Adresse nicht gefunden. Bitte den Modellnamen in den Einstellungen prüfen.';
  }
  const short = d && d.length < 180 ? d : (d ? d.slice(0, 160) + '…' : '');
  return short ? `Fehler ${status}: ${short}` : `Fehler ${status} vom Anbieter.`;
}

export function fallbackModelsFor(providerId, primary) {
  const chain = MODEL_FALLBACKS[providerId] || MODEL_FALLBACKS.custom;
  const out = [];
  const add = (m) => { if (m && !out.includes(m)) out.push(m); };
  add(primary);
  for (const m of chain) add(m);
  return out;
}

function sleep(ms, sleepFn) {
  return (sleepFn || ((t) => new Promise((r) => setTimeout(r, t))))(ms);
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

/**
 * Wie requestOnce, aber bei Überlastung: 1× Retry nach Backoff, dann Fallback-Modelle.
 * Gibt { data, model, usedFallback } zurück.
 */
export async function requestWithRetry(cfg, path, opts = {}) {
  const {
    retries = 1,
    backoffMs = 800,
    sleepFn,
    body,
    ...rest
  } = opts;
  const models = body?.model
    ? fallbackModelsFor(cfg.providerId || cfg.id, body.model)
    : [body?.model].filter(Boolean);

  // Für GET /models gibt es kein Modell – nur Retry
  if (!body?.model) {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestOnce(cfg, path, { ...rest, body });
        return { data, model: null, usedFallback: false };
      } catch (e) {
        last = e;
        if (e.code !== 'http' || !isOverloadError(e.status, e.detail) || attempt === retries) throw e;
        await sleep(backoffMs * (attempt + 1), sleepFn);
      }
    }
    throw last;
  }

  let lastErr;
  const primary = models[0];
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const attemptBody = { ...body, model };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestOnce(cfg, path, { ...rest, body: attemptBody });
        return { data, model, usedFallback: model !== primary };
      } catch (e) {
        lastErr = e;
        if (e.code !== 'http' || !isOverloadError(e.status, e.detail)) throw e;
        // Retry einmal auf demselben Modell, sonst nächstes Fallback
        if (attempt < retries) {
          await sleep(backoffMs * (attempt + 1), sleepFn);
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
 * opts.tools / opts.tool_choice werden durchgereicht.
 * Ergebnis: { data, model, usedFallback, note? }
 */
export async function askAIRaw(cfg, messages, opts = {}) {
  const body = { model: cfg.model, messages };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice || 'auto';
  }
  const out = await requestWithRetry(
    { ...cfg, providerId: cfg.providerId || cfg.id },
    '/chat/completions',
    {
      method: 'POST',
      body,
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries ?? 1,
      backoffMs: opts.backoffMs ?? 800,
      sleepFn: opts.sleepFn
    }
  );
  return out;
}

/**
 * Fragt die KI. Gibt den Antworttext zurück.
 * Wenn ein Fallback-Modell antwortete, wird ein kurzer deutscher Hinweis angehängt.
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
    text += ` (Antwort über Ersatzmodell ${model}, weil das gewünschte gerade überlastet war.)`;
  }
  return text;
}

/** Listet verfügbare Modelle (GET /models). */
export async function listModels(cfg, opts = {}) {
  const { data } = await requestWithRetry(cfg, '/models', {
    fetchFn: opts.fetchFn,
    timeoutMs: opts.timeoutMs,
    retries: opts.retries ?? 1,
    backoffMs: opts.backoffMs ?? 800,
    sleepFn: opts.sleepFn
  });
  const ids = (data?.data || []).map((m) => String(m.id || '').replace(/^models\//, '')).filter(Boolean);
  return [...new Set(ids)].sort();
}
