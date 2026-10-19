// Storage-Adapter für den Browser (localStorage). Fällt auf Arbeitsspeicher
// zurück, falls localStorage gesperrt ist (z. B. privater Modus).
import { createMemoryAdapter } from '../core/storage.js';

export function createWebStorageAdapter() {
  try {
    const k = '__jarvis_test__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch {
    console.warn('localStorage nicht verfügbar – Daten werden nicht dauerhaft gespeichert.');
    return createMemoryAdapter();
  }
}
