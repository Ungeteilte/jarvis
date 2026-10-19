// Aufruf einer OpenAI-kompatiblen Chat-API (xAI, OpenAI, eigene URL).
// fetch wird injiziert → im Browser, in Node-Tests und später nativ nutzbar.

export class AIError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function request(cfg, path, { method = 'GET', body, fetchFn = globalThis.fetch, timeoutMs = 60000 } = {}) {
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
    const detail = data?.error?.message || data?.error || data?.message || res.statusText;
    const hint = res.status === 401 || res.status === 403 ? ' (API-Schlüssel ungültig?)'
      : res.status === 404 ? ' (Modellname oder URL falsch?)'
      : res.status === 429 ? ' (Limit erreicht oder kein Guthaben)' : '';
    throw new AIError(`Fehler ${res.status}${hint}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, 'http');
  }
  return data;
}

/**
 * Fragt die KI. history = [{role:'user'|'assistant', text}], neueste zuletzt.
 * Gibt den Antworttext zurück.
 */
export async function askAI(cfg, systemPrompt, history, opts = {}) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-(opts.maxHistory || 12)).map((m) => ({ role: m.role, content: m.text }))
  ];
  const data = await request(cfg, '/chat/completions', {
    method: 'POST',
    body: { model: cfg.model, messages },
    ...opts
  });
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new AIError('Leere Antwort vom Anbieter erhalten.', 'empty');
  return String(text).trim();
}

/** Listet verfügbare Modelle (GET /models). */
export async function listModels(cfg, opts = {}) {
  const data = await request(cfg, '/models', opts);
  return (data?.data || []).map((m) => m.id).filter(Boolean).sort();
}
