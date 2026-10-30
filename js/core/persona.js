// Persona = Name + Stimme des Assistenten. Reine Logik, kein Browser-Code.

export const DEFAULT_PERSONA = Object.freeze({
  name: 'Jarvis',
  voiceId: '',   // '' = automatisch (beste deutsche Stimme)
  rate: 1.0,
  pitch: 1.0,
  onboarded: false
});

const KEY = 'persona';

/** v0.9.6: Regler „Sprechtempo“ (Sprache & Wake-Word). Ältere gespeicherte Werte werden beim Sprechen begrenzt. */
export const SPEECH_RATE = Object.freeze({ min: 0.8, max: 1.5, step: 0.05, default: 1.0 });
export function effectiveRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return SPEECH_RATE.default;
  return Math.round(Math.min(SPEECH_RATE.max, Math.max(SPEECH_RATE.min, n)) * 100) / 100;
}
const clamp = (n, min, max, fb) => (Number.isFinite(+n) ? Math.min(max, Math.max(min, +n)) : fb);

/** Bereinigt einen Namen: Leerzeichen trimmen, max. 30 Zeichen, Fallback "Jarvis". */
export function sanitizeName(name) {
  const clean = String(name ?? '').replace(/[<>{}\[\]"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
  return clean || DEFAULT_PERSONA.name;
}

export function normalizePersona(p = {}) {
  return {
    name: sanitizeName(p.name),
    voiceId: typeof p.voiceId === 'string' ? p.voiceId : '',
    rate: clamp(p.rate, 0.5, 2, DEFAULT_PERSONA.rate),
    pitch: clamp(p.pitch, 0, 2, DEFAULT_PERSONA.pitch),
    onboarded: Boolean(p.onboarded)
  };
}

export function loadPersona(store) {
  return normalizePersona({ ...DEFAULT_PERSONA, ...store.get(KEY, {}) });
}

/** Speichert Änderungen (teilweise erlaubt) und gibt die neue Persona zurück. */
export function savePersona(store, changes) {
  const next = normalizePersona({ ...loadPersona(store), ...changes });
  store.set(KEY, next);
  return next;
}

/** Stabile Kennung einer Stimme: voiceURI, sonst "Name|Sprache". */
export function voiceIdOf(voice) {
  if (!voice) return '';
  return voice.voiceURI || `${voice.name}|${voice.lang}`;
}

const isGerman = (v) => /^de([-_]|$)/i.test(v.lang || '');

/** Sortiert Stimmen: deutsche zuerst, dann alphabetisch. */
export function sortVoices(voices) {
  return [...voices].sort((a, b) =>
    (isGerman(b) - isGerman(a)) || String(a.name).localeCompare(String(b.name))
  );
}

/**
 * Wählt die Stimme zu voiceId. Fallback-Kette:
 * exakte ID → gleicher Name → deutsche Stimme (Google bevorzugt) → erste Stimme → null.
 */
export function pickVoice(voices, voiceId) {
  if (!voices || voices.length === 0) return null;
  if (voiceId) {
    const exact = voices.find((v) => voiceIdOf(v) === voiceId || v.voiceURI === voiceId);
    if (exact) return exact;
    const byName = voices.find((v) => voiceId.split('|')[0] === v.name);
    if (byName) return byName;
  }
  const german = voices.filter(isGerman);
  return (
    german.find((v) => /de[-_]DE/i.test(v.lang) && /google/i.test(v.name)) ||
    german.find((v) => /de[-_]DE/i.test(v.lang)) ||
    german[0] ||
    voices[0]
  );
}

/** Beispielsatz für "Vorhören". */
export function previewSentence(name) {
  return `Guten Tag. Ich bin ${sanitizeName(name)}, Ihr persönlicher Assistent. Wie kann ich behilflich sein?`;
}
