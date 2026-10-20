// Start-Reihenfolge (browserfrei): auf den nativen Bootstrap warten, bevor Adapter gelesen werden.

export const BOOT_TIMEOUT_MS = 3000;

/**
 * Wartet auf g.__JARVIS_BOOT__ (vom nativen Bootstrap gesetzt), höchstens timeoutMs.
 * → 'ready' | 'timeout' | 'error' | 'none' (kein Bootstrap, z. B. PWA im Browser).
 */
export async function waitForBoot(g = globalThis, { timeoutMs = BOOT_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const boot = g?.__JARVIS_BOOT__;
  if (!boot || typeof boot.then !== 'function') return 'none';
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimer(() => resolve('timeout'), timeoutMs); });
  try {
    return await Promise.race([Promise.resolve(boot).then(() => 'ready', () => 'error'), timeout]);
  } finally {
    clearTimer(timer);
  }
}

/** Für das einmalige Log: welche Adapter laufen? */
export function adapterKind(adapters) {
  return adapters && typeof adapters.tts === 'function' ? 'native' : 'web';
}
