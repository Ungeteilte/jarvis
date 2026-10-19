import { createToolRegistry } from './registry.js';
import { TOOL_DEFINITIONS } from './definitions.js';
import { matchLocalTrigger } from './triggers.js';
import { runToolLoop } from './loop.js';
import { resultToText } from './registry.js';

export { createToolRegistry, matchLocalTrigger, runToolLoop, resultToText, TOOL_DEFINITIONS };

export function createDefaultRegistry() {
  return createToolRegistry(TOOL_DEFINITIONS);
}

/** Führt einen lokalen Trigger aus, falls einer passt. Sonst null. */
export async function tryLocalTool(text, registry, ctx) {
  const hit = matchLocalTrigger(text, registry);
  if (!hit) return null;
  const result = await registry.run(hit.name, hit.args, { ...ctx, registry });
  return { name: hit.name, args: hit.args, result, text: resultToText(result) };
}
