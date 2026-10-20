// OpenAI-kompatible Tool-Schleife: sendet tools, führt tool_calls aus, sendet Ergebnisse zurück.
import { askAIRaw, askAIStream } from '../ai.js';
import { resultToText } from './registry.js';

const MAX_ROUNDS = 4;

function parseArgs(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return { _raw: String(raw) }; }
}

/**
 * Führt einen Chat mit optionalen Werkzeugen aus.
 * Gibt { text, toolResults, rounds } zurück.
 * confirm-Ergebnisse werden als Text an die KI gemeldet; die UI wertet
 * das letzte needsConfirm-Ergebnis aus der toolResults-Liste aus.
 */
export async function runToolLoop({ cfg, systemPrompt, history, registry, ctx, fetchFn, maxRounds = MAX_ROUNDS, onDelta, stream, signal, ...opts } = {}) {
  // onDelta({type:'text',text}|{type:'reset'}|{type:'tool',name,args}|{type:'tool-result',name,ok})
  const emit = typeof onDelta === 'function' ? onDelta : null;
  const useStream = Boolean(emit) && stream !== false;
  const tools = registry.toOpenAITools();
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-12).map((m) => {
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.text };
      if (m.role === 'assistant' && m.tool_calls) {
        return { role: 'assistant', content: m.text || null, tool_calls: m.tool_calls };
      }
      return { role: m.role, content: m.text };
    })
  ];

  const toolResults = [];
  let lastText = '';

  for (let round = 0; round < maxRounds; round++) {
    const callOpts = { tools, tool_choice: 'auto', fetchFn, sleepFn: opts.sleepFn, retries: opts.retries, backoffSchedule: opts.backoffSchedule, skipModelDiscovery: opts.skipModelDiscovery, signal };
    let roundText = '';
    const raw = useStream
      ? await askAIStream(cfg, messages, {
        ...callOpts,
        onDelta: (d) => {
          if (d.type === 'reset') roundText = '';
          else if (d.type === 'text') roundText += d.text;
          emit(d);
        }
      })
      : await askAIRaw(cfg, messages, callOpts);
    const data = raw.data;
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('Leere Antwort vom Anbieter erhalten.');

    const calls = msg.tool_calls || msg.function_call && [{
      id: 'call_legacy',
      type: 'function',
      function: msg.function_call
    }] || [];

    if (!calls.length) {
      lastText = String(msg.content || '').trim();
      if (raw.usedFallback && raw.model) {
        const note = ` (Antwort über Ersatzmodell ${raw.model}, weil das gewünschte gerade überlastet war.)`;
        lastText += note;
        emit?.({ type: 'text', text: note });
      }
      return { text: lastText, toolResults, rounds: round + 1, model: raw.model, usedFallback: raw.usedFallback };
    }

    messages.push({
      role: 'assistant',
      content: msg.content || null,
      tool_calls: calls
    });
    // Vor-Text dieser Runde (z. B. „Ich rufe an …“) verwerfen – die nächste Runde antwortet neu
    if (emit && roundText) emit({ type: 'reset' });

    for (const tc of calls) {
      const name = tc.function?.name || tc.name;
      const args = parseArgs(tc.function?.arguments ?? tc.arguments);
      emit?.({ type: 'tool', name, args });
      const result = await registry.run(name, args, { ...ctx, registry });
      // Fremde Daten (Nachrichten, Termine, Wetter) im Kontext → Gedächtnis-Vorschläge in dieser Runde gesperrt
      if (ctx?.turn && registry.get(name)?.externalData) ctx.turn.external = true;
      toolResults.push({ name, args, result });
      emit?.({ type: 'tool-result', name, ok: result?.ok !== false, needsConfirm: Boolean(result?.needsConfirm) });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id || `call_${toolResults.length}`,
        content: resultToText(result)
      });
    }

    // Wenn eine Bestätigung nötig ist: nicht noch eine KI-Runde – die UI übernimmt.
    const pending = toolResults.find((t) => t.result?.needsConfirm)?.result;
    if (pending) {
      return {
        text: pending.message,
        toolResults,
        rounds: round + 1,
        confirm: pending.confirm
      };
    }
  }

  return {
    text: lastText || 'Verzeihung, ich komme mit den Werkzeugen nicht weiter. Bitte formulieren Sie es anders.',
    toolResults,
    rounds: maxRounds
  };
}
