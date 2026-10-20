// Gesprochene Antwort auf eine offene Ja/Nein-Karte. Nur kurze, eindeutige Antworten zählen.
import { normalizeText } from './wakeword.js';

export const CONFIRM_TTL_MS = 2 * 60000;
const YES = /^(?:ja|jawohl|jap|ja bitte|bitte ja|ja gerne?|ja mach(?: das)?|ja (?:bitte )?oeffnen|ja oeffne (?:sie|es|das|die seite)|oeffnen|ja genau|ja klar|ja bestaetigen|bestaetigen|bestaetigt|ja loeschen|ja vergessen|ja merken|ja merk dir das)$/;
const NO = /^(?:nein|nee|ne|nein danke|abbrechen|abbruch|stopp?|lieber nicht|nicht oeffnen|nein abbrechen|nein nicht)$/;

/** 'yes' | 'no' | null */
export function voiceAnswer(text) {
  const t = normalizeText(text);
  if (!t || t.length > 30) return null;
  if (YES.test(t)) return 'yes';
  if (NO.test(t)) return 'no';
  return null;
}
