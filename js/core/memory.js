// Gedächtnis: Fakten, die der Nutzer Jarvis erzählt hat („Merk dir, dass …“).
// Browser-frei. Liegt im normalen Speicher (Android: verschlüsselt, Web: localStorage).
// Einträge sind DATEN, keine Anweisungen: In den Prompt kommen sie nur gereinigt und eingezäunt.
import { cleanText } from './briefing/sanitize.js';
import { normalizeText } from './wakeword.js';

export const MEMORY_KEY = 'memory';
export const MAX_ITEMS = 150;
export const MAX_TEXT = 200;
export const PROMPT_BUDGET = 3000;
export const KATEGORIEN = Object.freeze(['person', 'vorliebe', 'stream', 'alltag', 'sonstiges']);
export const KATEGORIE_LABELS = Object.freeze({
  person: 'Person', vorliebe: 'Vorliebe', stream: 'Stream', alltag: 'Alltag', sonstiges: 'Sonstiges'
});
const QUELLEN = new Set(['sprache', 'einstellungen', 'ki-vorschlag', 'notiz', 'import']);
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

/** Text vor dem Speichern glätten (Steuerzeichen raus, Leerraum zusammenfassen). */
export function tidy(text) {
  return String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').trim();
}

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const SENSITIVE_WORDS = /\b(passwort|passwoerter|password|passwd|kennwort|pin|pins|pincode|pin code|puk|tan|tans|geheimzahl|zugangsdaten|logindaten|login daten|iban|bic|kreditkarte|kreditkartennummer|kartennummer|cvv|cvc|sicherheitscode|api key|apikey|api schluessel|zugangstoken|seed phrase|wiederherstellungsschluessel|recovery code)\b/;
const KEY_LIKE = /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xai-[A-Za-z0-9]{20,})/;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/i;

/**
 * Erkennt Dinge, die nicht ins Gedächtnis gehören (Passwörter, PINs, IBAN, Kartennummern, Schlüssel).
 * Gibt einen kurzen Grund zurück oder null.
 */
export function sensitiveReason(text) {
  const raw = String(text ?? '');
  const t = normalizeText(raw).replace(/-/g, ' ');
  if (KEY_LIKE.test(raw)) return 'Schlüssel';
  if (IBAN.test(raw.replace(/-/g, ' ')) && /\d{6,}/.test(raw.replace(/\s/g, ''))) return 'IBAN';
  for (const m of raw.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const digits = m[0].replace(/\D/g, '');
    // Telefonnummern (+49 …, 0151 …) sind keine Karten: Karten beginnen mit 2–6
    if (raw[m.index - 1] === '+' || !/^[2-6]/.test(digits)) continue;
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return 'Kartennummer';
  }
  const w = t.match(SENSITIVE_WORDS);
  if (w) return w[1].startsWith('pin') || w[1] === 'puk' || w[1] === 'geheimzahl' ? 'PIN' : 'Passwort/Zugangsdaten';
  return null;
}

/** Grobe Kategorie anhand von Schlüsselwörtern. */
export function guessKategorie(text) {
  const t = normalizeText(text);
  if (/\b(stream\w*|twitch|vtuber|zuschauer|follower|obs|livestream|chat|subs?|raid)\b/.test(t)) return 'stream';
  if (/\b(heisst|heißt|geburtstag|schwester|bruder|mutter|vater|mama|papa|oma|opa|freund|freundin|frau|mann|chef|chefin|kollege|kollegin|katze|kater|hund|tochter|sohn|partner|partnerin)\b/.test(t)) return 'person';
  if (/\b(mag|liebe|lieblings\w*|hasse|bevorzuge|lieber|esse gern|trinke gern|allergisch|vegetarisch|vegan)\b/.test(t)) return 'vorliebe';
  if (/\b(arbeit\w*|uni|schule|montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonntags?|wohne|aufstehen|schlafe|training|termin\w*|morgens|abends)\b/.test(t)) return 'alltag';
  return 'sonstiges';
}

const newMemId = () => 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function normItem(it) {
  if (!it || typeof it !== 'object') return null;
  const text = tidy(it.text).slice(0, MAX_TEXT);
  if (!text) return null;
  return {
    id: typeof it.id === 'string' && it.id.length <= 40 ? it.id : newMemId(),
    text,
    kategorie: KATEGORIEN.includes(it.kategorie) ? it.kategorie : guessKategorie(text),
    quelle: QUELLEN.has(it.quelle) ? it.quelle : 'einstellungen',
    erstellt: typeof it.erstellt === 'string' ? it.erstellt : new Date(0).toISOString(),
    geaendert: typeof it.geaendert === 'string' ? it.geaendert : (typeof it.erstellt === 'string' ? it.erstellt : new Date(0).toISOString()),
    angeheftet: it.angeheftet === true
  };
}

export function loadMemory(store) {
  const raw = store.get(MEMORY_KEY, null);
  const list = Array.isArray(raw?.items) ? raw.items : [];
  const items = [];
  const seen = new Set();
  for (const it of list) {
    const n = normItem(it);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    items.push(n);
    if (items.length >= MAX_ITEMS) break;
  }
  return { version: 1, items };
}

export function saveMemory(store, mem) {
  store.set(MEMORY_KEY, { version: 1, items: (mem.items || []).slice(0, MAX_ITEMS) });
}

const key = (t) => normalizeText(t).replace(/[^a-z0-9äöüß ]/g, '').replace(/\s+/g, ' ').trim();

/** Prüft einen Text fürs Gedächtnis: { ok, text } oder { ok:false, reason, message }. */
export function checkMemoryText(text) {
  const t = tidy(text);
  if (!t || !cleanText(t, MAX_TEXT)) return { ok: false, reason: 'empty', message: 'Was soll ich mir merken?' };
  if (t.length > MAX_TEXT) {
    return { ok: false, reason: 'too-long', message: `Das ist mir zu lang (höchstens ${MAX_TEXT} Zeichen). Bitte kürzer formulieren.` };
  }
  const s = sensitiveReason(t);
  if (s) {
    return { ok: false, reason: 'sensitive', message: `Das sieht nach ${s === 'PIN' ? 'einer PIN' : s === 'IBAN' ? 'einer IBAN' : s === 'Kartennummer' ? 'einer Kartennummer' : s === 'Schlüssel' ? 'einem Zugangsschlüssel' : 'einem Passwort oder Zugangsdaten'} aus – das merke ich mir lieber nicht.` };
  }
  return { ok: true, text: t };
}

/** Fügt einen Fakt hinzu. → { ok, item, duplicate } oder { ok:false, reason, message } */
export function addMemory(store, text, { kategorie, quelle = 'sprache', now = new Date() } = {}) {
  const chk = checkMemoryText(text);
  if (!chk.ok) return chk;
  const mem = loadMemory(store);
  const k = key(chk.text);
  const dup = mem.items.find((i) => key(i.text) === k);
  const iso = now.toISOString();
  if (dup) {
    dup.geaendert = iso;
    saveMemory(store, mem);
    return { ok: true, item: dup, duplicate: true, message: `Das weiß ich bereits: ${dup.text}.` };
  }
  if (mem.items.length >= MAX_ITEMS) {
    return { ok: false, reason: 'full', message: `Mein Gedächtnis ist voll (${MAX_ITEMS} Einträge). Bitte löschen Sie in den Einstellungen etwas.` };
  }
  const item = {
    id: newMemId(), text: chk.text,
    kategorie: KATEGORIEN.includes(kategorie) ? kategorie : guessKategorie(chk.text),
    quelle: QUELLEN.has(quelle) ? quelle : 'sprache',
    erstellt: iso, geaendert: iso, angeheftet: false
  };
  mem.items.push(item);
  saveMemory(store, mem);
  return { ok: true, item, duplicate: false, message: `Gemerkt: ${item.text}.` };
}

export function updateMemory(store, id, changes = {}, now = new Date()) {
  const mem = loadMemory(store);
  const it = mem.items.find((i) => i.id === id);
  if (!it) return { ok: false, reason: 'missing', message: 'Diesen Eintrag gibt es nicht mehr.' };
  if (changes.text !== undefined) {
    const chk = checkMemoryText(changes.text);
    if (!chk.ok) return chk;
    it.text = chk.text;
  }
  if (KATEGORIEN.includes(changes.kategorie)) it.kategorie = changes.kategorie;
  if (typeof changes.angeheftet === 'boolean') it.angeheftet = changes.angeheftet;
  it.geaendert = now.toISOString();
  saveMemory(store, mem);
  return { ok: true, item: it };
}

export function removeMemory(store, id) {
  const mem = loadMemory(store);
  const before = mem.items.length;
  const removed = mem.items.find((i) => i.id === id) || null;
  mem.items = mem.items.filter((i) => i.id !== id);
  if (mem.items.length !== before) saveMemory(store, mem);
  return removed;
}

export function clearMemory(store) {
  const n = loadMemory(store).items.length;
  saveMemory(store, { items: [] });
  return n;
}

const STOP = new Set(['dass', 'das', 'der', 'die', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder',
  'ich', 'mich', 'mir', 'mein', 'meine', 'meinen', 'meinem', 'meiner', 'du', 'dir', 'dich', 'ist', 'sind', 'bin', 'hab', 'habe',
  'hat', 'mit', 'von', 'vom', 'zum', 'zur', 'auf', 'aus', 'bei', 'fuer', 'für', 'nicht', 'auch', 'noch', 'was', 'wie', 'wer',
  'wann', 'immer', 'sache', 'eintrag', 'bitte', 'weisst', 'ueber', 'über', 'sie', 'ihr', 'ihre', 'mal', 'jetzt', 'heute']);

export function tokens(text) {
  return key(text).split(' ').filter((w) => w.length >= 3 && !STOP.has(w));
}

function overlap(qt, text) {
  if (!qt.length) return 0;
  const words = tokens(text);
  let hit = 0;
  for (const q of qt) if (words.some((w) => w === q || (q.length >= 4 && (w.startsWith(q) || q.startsWith(w)) && Math.min(w.length, q.length) >= 4))) hit++;
  return hit / qt.length;
}

/** Bester Treffer für „Vergiss, dass …“ → { item, score } oder null. */
export function findMemory(items, query) {
  const qk = key(query);
  if (!qk) return null;
  const qt = tokens(query);
  let best = null;
  for (const it of items) {
    const ik = key(it.text);
    let score = overlap(qt, it.text);
    if (ik === qk) score = 2;
    else if (qk.length >= 4 && (ik.includes(qk) || qk.includes(ik))) score = Math.max(score, 1.5);
    if (!best || score > best.score) best = { item: it, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

/**
 * Auswahl fürs Prompt-Budget: angeheftete → passend zur Frage → neueste.
 * → { items:[{k,t}], omitted }
 */
export function selectForPrompt(items, query = '', budget = PROMPT_BUDGET) {
  const qt = tokens(query);
  const byNew = [...items].sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
  const pinned = byNew.filter((i) => i.angeheftet);
  const matched = byNew.filter((i) => !i.angeheftet && qt.length && overlap(qt, i.text) > 0);
  const rest = byNew.filter((i) => !pinned.includes(i) && !matched.includes(i));
  const out = [];
  let used = 0;
  for (const it of [...pinned, ...matched, ...rest]) {
    const t = cleanText(it.text, MAX_TEXT);
    if (!t) continue;
    const cost = t.length + it.kategorie.length + 14;
    if (used + cost > budget) continue;
    used += cost;
    out.push({ k: it.kategorie, t });
  }
  return { items: out, omitted: items.length - out.length };
}

/** Alte „Merk dir“-Notizen ins Gedächtnis übernehmen; übernommene verschwinden aus den Notizen. */
export function migrateNotes(store, now = new Date()) {
  const notes = store.get('notes', []);
  const keep = [];
  let moved = 0;
  for (const n of Array.isArray(notes) ? notes : []) {
    const r = addMemory(store, n?.text, { quelle: 'notiz', now });
    if (r.ok) moved++;
    else keep.push(n);
  }
  store.set('notes', keep);
  return { moved, skipped: keep.length };
}

export function exportMemory(store) {
  return JSON.stringify({ jarvisMemory: 1, items: loadMemory(store).items }, null, 2);
}

/** Import aus JSON (Export-Format oder Liste von Texten). Prüft jeden Eintrag wie beim Merken. */
export function importMemory(store, json, now = new Date()) {
  let data;
  try { data = JSON.parse(String(json || '')); } catch { return { ok: false, message: 'Das ist kein gültiges JSON.' }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!list) return { ok: false, message: 'Keine Einträge gefunden.' };
  let added = 0, skipped = 0;
  for (const it of list.slice(0, MAX_ITEMS * 2)) {
    const text = typeof it === 'string' ? it : it?.text;
    const r = addMemory(store, text, { kategorie: it?.kategorie, quelle: 'import', now });
    if (r.ok && !r.duplicate) {
      added++;
      if (it?.angeheftet === true) updateMemory(store, r.item.id, { angeheftet: true }, now);
    } else skipped++;
  }
  return { ok: true, added, skipped, message: `${added} übernommen, ${skipped} übersprungen.` };
}
