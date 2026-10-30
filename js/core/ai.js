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
// ---------- v0.9.6 Antwort-Tempo (Nachdenk-Steuerung) ----------
// Gemini 3 denkt ohne Angabe standardmäßig ausführlich (langsam). Über den OpenAI-kompatiblen
// Endpunkt steuert reasoning_effort das: laut Google-Doku (ai.google.dev/gemini-api/docs/openai)
// entspricht 'minimal' bei Gemini 3 Flash / 3.1 Flash-Lite thinking_level 'minimal';
// 'none' gibt es nur für 2.5-Modelle (bei Gemini 3 nicht abschaltbar).
// Lehnt ein Modell den Wert ab (HTTP 400), wird stufenweise 'low' bzw. gar nichts gesendet und das
// pro Basis-URL+Modell gemerkt. Andere Anbieter (xAI, OpenAI, eigene URL) bekommen nichts Neues.
export const REASONING_FAST = 'minimal';
const REASONING_CHAIN = ['minimal', 'low'];
const REASONING_REJECT_RE = /reasoning|thinking|effort|budget/i;
const reasoningDowngrades = new Map(); // `${baseUrl}|${model}` → 'low' | null (= nicht senden)

export function reasoningEffortFor(cfg) {
  const providerId = cfg?.providerId || cfg?.id;
  if (providerId !== 'gemini') return undefined;
  if (cfg?.tempo === 'thorough') return undefined; // Gründlich: Modell-Standard
  return REASONING_FAST;
}

export function isReasoningRejected(status, detail) {
  return status === 400 && REASONING_REJECT_RE.test(String(detail || ''));
}

function reasoningKey(cfg, model) { return `${cfg?.baseUrl || ''}|${model}`; }

/** Wendet eine gemerkte Herabstufung an (mutiert body). */
function applyReasoningMemory(cfg, body) {
  if (!body.reasoning_effort) return;
  const k = reasoningKey(cfg, body.model);
  if (!reasoningDowngrades.has(k)) return;
  const v = reasoningDowngrades.get(k);
  if (v) body.reasoning_effort = v; else delete body.reasoning_effort;
}

/** Nächste Stufe nach Ablehnung; merkt sie sich. true = erneut versuchen. */
function downgradeReasoning(cfg, body) {
  const cur = body.reasoning_effort;
  if (!cur) return false;
  const i = REASONING_CHAIN.indexOf(cur);
  const next = i >= 0 && i + 1 < REASONING_CHAIN.length ? REASONING_CHAIN[i + 1] : null;
  reasoningDowngrades.set(reasoningKey(cfg, body.model), next);
  if (next) body.reasoning_effort = next; else delete body.reasoning_effort;
  return true;
}

/** Nur für Tests: gemerkte Herabstufungen vergessen. */
export function resetReasoningMemory() { reasoningDowngrades.clear(); }

export async function requestWithRetry(cfg, path, opts = {}) {
  const {
    retries = 2,
    backoffSchedule = [1000, 3000],
    sleepFn,
    body,
    dynamicFallbacks,
    requestFn = requestOnce,
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
    applyReasoningMemory(cfg, attemptBody);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await requestFn(cfg, path, { ...rest, body: attemptBody });
        return { data, model, usedFallback: model !== primary };
      } catch (e) {
        lastErr = e;
        if (e.code !== 'http') throw e;

        // v0.9.6: Nachdenk-Stufe abgelehnt → schwächer bzw. ohne erneut (zählt nicht als Versuch)
        if (isReasoningRejected(e.status, e.detail) && downgradeReasoning(cfg, attemptBody)) {
          attempt--;
          continue;
        }

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
  const effort = reasoningEffortFor(cfg);
  if (effort) body.reasoning_effort = effort;
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


// ===================== Streaming (SSE) =====================

/** Gibt true zurück, wenn die Laufzeit Streaming per fetch-Body unterstützt. */
export function canStream() {
  return typeof globalThis.ReadableStream === 'function' && typeof globalThis.TextDecoder === 'function';
}

/**
 * Liest einen SSE-Body (text/event-stream) und liefert die `data:`-Payloads.
 * Kommentare (`:`) und leere Zeilen werden ignoriert; `[DONE]` beendet.
 */
export async function* readSSE(body, { onChunk } = {}) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onChunk?.();
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
        const data = rawEvent.split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        if (data.trim() === '[DONE]') return;
        yield data;
      }
    }
    // Rest ohne abschließende Leerzeile
    const tail = buf.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
    if (tail && tail !== '[DONE]') yield tail;
  } finally {
    try { reader.releaseLock(); } catch { /* egal */ }
  }
}

/** Setzt OpenAI-kompatible Stream-Deltas (content + tool_calls) zusammen. */
export function createDeltaAssembler() {
  let content = '';
  const calls = []; // nach index
  let finish = null;
  return {
    push(chunk) {
      const choice = chunk?.choices?.[0];
      if (!choice) return { text: '' };
      const d = choice.delta || choice.message || {};
      if (choice.finish_reason) finish = choice.finish_reason;
      let text = '';
      if (typeof d.content === 'string' && d.content) { content += d.content; text = d.content; }
      for (const tc of d.tool_calls || []) {
        const i = Number.isInteger(tc.index) ? tc.index : calls.length;
        const cur = calls[i] || (calls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.type) cur.type = tc.type;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments != null) {
          cur.function.arguments += typeof tc.function.arguments === 'string'
            ? tc.function.arguments : JSON.stringify(tc.function.arguments);
        }
      }
      return { text, toolCall: (d.tool_calls || []).length > 0 };
    },
    get content() { return content; },
    result() {
      const tool_calls = calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${i + 1}` }));
      const message = { role: 'assistant', content: content || (tool_calls.length ? null : '') };
      if (tool_calls.length) message.tool_calls = tool_calls;
      return { choices: [{ index: 0, message, finish_reason: finish || (tool_calls.length ? 'tool_calls' : 'stop') }] };
    }
  };
}

/**
 * Ein Streaming-Request. Liefert am Ende dieselbe Form wie ohne Streaming
 * ({ choices:[{ message }] }), meldet unterwegs onDelta({ type:'text', text }).
 * Fehlercodes: 'http' (wie requestOnce), 'nostream' (kein lesbarer Body),
 * 'stream-broken' (Abbruch nach ersten Daten), 'aborted', 'timeout', 'network'.
 */
export async function requestStreamOnce(cfg, path, {
  body, fetchFn = globalThis.fetch, timeoutMs = 60000, idleTimeoutMs = 30000, onDelta, signal
} = {}) {
  if (!cfg.baseUrl) throw new AIError('Keine Basis-URL eingestellt.', 'config');
  if (!cfg.apiKey) throw new AIError('Kein API-Schlüssel hinterlegt. Bitte in den Einstellungen eintragen.', 'nokey');
  if (signal?.aborted) throw new AIError('Abgebrochen.', 'aborted');
  const ctrl = new AbortController();
  let timedOut = false;
  let timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, idleTimeoutMs); };
  const onAbort = () => ctrl.abort();
  signal?.addEventListener?.('abort', onAbort);
  let emitted = false;
  const fail = (e) => {
    if (e instanceof AIError) return e;
    if (signal?.aborted) return new AIError('Abgebrochen.', 'aborted');
    if (timedOut) return new AIError('Zeitüberschreitung – der Server antwortet nicht.', 'timeout');
    if (emitted) return new AIError('Die Live-Antwort wurde unterbrochen.', 'stream-broken');
    return new AIError('Netzwerkfehler oder vom Anbieter blockiert (CORS). Internetverbindung und Basis-URL prüfen.', 'network');
  };
  try {
    let res;
    try {
      res = await fetchFn(cfg.baseUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ ...body, stream: true }),
        signal: ctrl.signal
      });
    } catch (e) { throw fail(e); }

    const ctype = String(res.headers?.get?.('content-type') || '');
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
      if (Array.isArray(data)) data = data[0];
      const detail = data?.error?.message || data?.error || data?.message || res.statusText;
      const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
      throw new AIError(friendlyHttpError(res.status, detailStr), 'http', { status: res.status, detail: detailStr, model: body?.model });
    }
    // Anbieter ignoriert stream:true und schickt normales JSON → direkt nutzen
    if (/json/i.test(ctype) && !/event-stream/i.test(ctype)) {
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) { emitted = true; onDelta?.({ type: 'text', text: String(text) }); }
      return data;
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      throw new AIError('Streaming wird hier nicht unterstützt.', 'nostream');
    }
    const asm = createDeltaAssembler();
    try {
      for await (const payload of readSSE(res.body, { onChunk: resetIdle })) {
        let chunk;
        try { chunk = JSON.parse(payload); } catch { continue; }
        if (chunk?.error) {
          const msg = chunk.error.message || JSON.stringify(chunk.error);
          throw new AIError(friendlyHttpError(chunk.error.code || 500, msg), emitted ? 'stream-broken' : 'http',
            { status: Number(chunk.error.code) || 500, detail: msg, model: body?.model });
        }
        const { text } = asm.push(chunk);
        if (text) { emitted = true; onDelta?.({ type: 'text', text }); }
      }
    } catch (e) { throw fail(e); }
    return asm.result();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/**
 * Streaming-Variante von askAIRaw: gleiche Retry-/Fallback-Logik (503/429/404),
 * meldet Teiltexte über opts.onDelta. Bei Problemen mit dem Streaming selbst
 * (kein ReadableStream, Abbruch mittendrin, 400 wegen stream) automatischer
 * Rückfall auf den normalen Weg; vorher onDelta({ type:'reset' }).
 * Ergebnis: { data, model, usedFallback, streamed }
 */
export async function askAIStream(cfg, messages, opts = {}) {
  const onDelta = opts.onDelta || (() => {});
  if (opts.stream === false || !canStream()) {
    const out = await askAIRaw(cfg, messages, opts);
    return { ...out, streamed: false };
  }
  const body = { model: cfg.model, messages };
  const effort = reasoningEffortFor(cfg);
  if (effort) body.reasoning_effort = effort;
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice || 'auto';
  }
  let emitted = false;
  const relay = (d) => { if (d?.type === 'text') emitted = true; onDelta(d); };
  try {
    const out = await requestWithRetry(
      { ...cfg, providerId: cfg.providerId || cfg.id },
      '/chat/completions',
      {
        method: 'POST',
        body,
        fetchFn: opts.fetchFn,
        timeoutMs: opts.timeoutMs,
        idleTimeoutMs: opts.idleTimeoutMs,
        retries: opts.retries ?? 2,
        backoffSchedule: opts.backoffSchedule || [1000, 3000],
        sleepFn: opts.sleepFn,
        dynamicFallbacks: opts.dynamicFallbacks,
        skipModelDiscovery: opts.skipModelDiscovery,
        signal: opts.signal,
        onDelta: relay,
        requestFn: requestStreamOnce
      }
    );
    return { ...out, streamed: true };
  } catch (e) {
    if (e?.code === 'aborted') throw e;
    const streamProblem = ['nostream', 'stream-broken', 'network'].includes(e?.code)
      || (e?.code === 'http' && e.status === 400 && /stream/i.test(e.detail || ''));
    if (!streamProblem) throw e;
    if (emitted) onDelta({ type: 'reset' });
    const out = await askAIRaw(cfg, messages, { ...opts, skipModelDiscovery: true });
    const text = out.data?.choices?.[0]?.message?.content;
    if (text) onDelta({ type: 'text', text: String(text) });
    return { ...out, streamed: false, streamFallback: e.code };
  }
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
