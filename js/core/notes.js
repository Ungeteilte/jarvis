// v0.9 W5 – Notizen einzeln löschen oder leeren, mit „Rückgängig“ (2 Minuten).
import { loadNotes } from './skills.js';
import { normalizeText } from './wakeword.js';

export const NOTES_KEY = 'notes';
export const UNDO_KEY = 'noteUndo';
export const UNDO_MS = 2 * 60 * 1000;

/** Notizen zu einer Anfrage: Nummer („2“, „die zweite“) oder alle Wörter kommen im Text vor. */
export function findNotes(store, query) {
  const notes = loadNotes(store);
  const q = normalizeText(query);
  const ord = { erste: 1, zweite: 2, dritte: 3, vierte: 4, fuenfte: 5, letzte: notes.length };
  const num = q.match(/^(?:nummer |die |notiz )?(\d+|erste|zweite|dritte|vierte|fuenfte|letzte)$/);
  if (num) {
    const i = (ord[num[1]] || Number(num[1])) - 1;
    return notes[i] ? [{ note: notes[i], index: i }] : [];
  }
  const words = q.split(' ').filter((w) => w.length > 1 && !['die', 'der', 'das', 'den', 'notiz', 'mit', 'ueber', 'von'].includes(w));
  if (!words.length) return [];
  return notes.map((note, index) => ({ note, index })).filter(({ note }) => {
    const t = normalizeText(note.text);
    return words.every((w) => t.includes(w));
  });
}

export function deleteNoteAt(store, index, now = new Date()) {
  const notes = loadNotes(store);
  const [gone] = notes.splice(index, 1);
  if (!gone) return null;
  store.set(NOTES_KEY, notes);
  store.set(UNDO_KEY, { kind: 'one', notes: [gone], index, at: now.getTime() });
  return gone;
}

export function clearNotes(store, now = new Date()) {
  const notes = loadNotes(store);
  store.set(NOTES_KEY, []);
  if (notes.length) store.set(UNDO_KEY, { kind: 'all', notes, index: 0, at: now.getTime() });
  return notes.length;
}

/** „Rückgängig“ innerhalb von 2 Minuten. → Anzahl wiederhergestellter Notizen oder 0. */
export function undoNotes(store, now = new Date()) {
  const u = store.get(UNDO_KEY, null);
  if (!u || !Array.isArray(u.notes) || now.getTime() - u.at > UNDO_MS) return 0;
  const notes = loadNotes(store);
  notes.splice(Math.min(u.index, notes.length), 0, ...u.notes);
  store.set(NOTES_KEY, notes);
  store.remove(UNDO_KEY);
  return u.notes.length;
}
