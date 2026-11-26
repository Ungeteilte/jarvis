// v0.11 Archiv: strukturierte Fächer zusätzlich zu Gedächtnis und kurzen Notizen.
// Liegt im selben Speicher (Android: verschlüsselt). Einträge sind DATEN, keine Befehle.
// An die KI gehen nur passende, gereinigte Ausschnitte – nie das ganze Archiv.
import { cleanText } from './briefing/sanitize.js';
import { sensitiveReason, tokens } from './memory.js';
import { normalizeText } from './wakeword.js';

export const ARCHIVE_KEY = 'archive';
export const FAECHER = Object.freeze([
  'termine', 'notizen', 'projekte', 'ideen', 'entscheidungen', 'todos', 'verlaeufe', 'lektionen', 'wissen'
]);
export const FACH_LABELS = Object.freeze({
  termine: 'Termine',
  notizen: 'Notizen',
  projekte: 'Projekte',
  ideen: 'Ideen',
  entscheidungen: 'Entscheidungen',
  todos: 'Todos',
  verlaeufe: 'Verläufe',
  lektionen: 'Lektionen',
  wissen: 'Wissen'
});
/** In der Sprache „Archiv-Notizen“, damit sie nicht mit den kurzen Notizen („Notiere …“) verwechselt werden. */
export const fachLabel = (fach) => (fach === 'notizen' ? 'Archiv-Notizen' : (FACH_LABELS[fach] || fach));

export const STATUS = Object.freeze(['offen', 'erledigt', 'verworfen']);
export const QUELLEN = Object.freeze(['du', 'mail', 'datei', 'kalender']);
export const QUELLE_LABELS = Object.freeze({ du: 'du', mail: 'Mail', datei: 'Datei', kalender: 'Kalender' });

/** Obergrenze pro Fach. Länger als ein Gedächtnis-Fakt, aber nicht unbegrenzt. */
export const MAX_PER_FACH = 60;
/** Ein paar Tausend Zeichen pro Eintrag. */
export const MAX_TEXT = 3000;
/** Festes Prompt-Budget für Archiv-Ausschnitte (unabhängig vom Gedächtnis). */
export const PROMPT_BUDGET = 2500;
const EXCERPT = 400;

const FACH_ALIASES = Object.freeze({
  termin: 'termine', termine: 'termine',
  notiz: 'notizen', notizen: 'notizen', archivnotiz: 'notizen', archivnotizen: 'notizen',
  projekt: 'projekte', projekte: 'projekte',
  idee: 'ideen', ideen: 'ideen',
  entscheidung: 'entscheidungen', entscheidungen: 'entscheidungen',
  todo: 'todos', todos: 'todos', aufgabe: 'todos', aufgaben: 'todos',
  verlauf: 'verlaeufe', verlaeufe: 'verlaeufe',
  lektion: 'lektionen', lektionen: 'lektionen',
  wissen: 'wissen'
});

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g;

const newId = () => 'a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Ein Wort oder eine Kurzform auf ein Fach abbilden, sonst null. */
export function parseFach(word) {
  const n = normalizeText(word).replace(/\s+/g, '');
  return FACH_ALIASES[n] || null;
}

/** Text glätten, Zeilenumbrüche in längeren Einträgen behalten. */
export function tidyArchive(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normFrist(value) {
  if (value == null || value === '') return null;
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function localDay(date, add = 0) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + add);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * „bis 15.3.2027“, „bis 2027-03-15“, „bis morgen“ aus einem Sprachtext ziehen.
 * Der Rest bleibt der Eintragstext.
 */
export function extractFrist(text, now = new Date()) {
  let raw = String(text ?? '');
  let frist = null;
  const iso = raw.match(/\bbis\s+(\d{4}-\d{2}-\d{2})\b/i);
  const de = raw.match(/\bbis\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
  const rel = raw.match(/\bbis\s+(heute|morgen|uebermorgen|übermorgen)\b/i);
  if (iso) {
    frist = normFrist(iso[1]);
    if (frist) raw = raw.replace(iso[0], ' ');
  } else if (de) {
    frist = normFrist(`${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`);
    if (frist) raw = raw.replace(de[0], ' ');
  } else if (rel) {
    const w = normalizeText(rel[1]);
    const add = w === 'heute' ? 0 : w === 'morgen' ? 1 : 2;
    frist = localDay(now, add);
    raw = raw.replace(rel[0], ' ');
  }
  return { text: raw.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(), frist };
}

/** „aus der Mail: …“ am Anfang → Quelle, der Rest ist der Text. */
export function extractQuelle(text) {
  const raw = String(text ?? '').trim();
  const rules = [
    [/^(?:aus der mail|von der mail|per mail)\s*[:,]?\s*/i, 'mail'],
    [/^(?:aus der datei|aus einer datei)\s*[:,]?\s*/i, 'datei'],
    [/^(?:aus dem kalender|vom kalender)\s*[:,]?\s*/i, 'kalender']
  ];
  for (const [re, quelle] of rules) {
    if (re.test(raw)) return { quelle, text: raw.replace(re, '').trim() };
  }
  return { quelle: null, text: raw };
}

const key = (t) => normalizeText(t).replace(/[^a-z0-9äöüß ]/g, '').replace(/\s+/g, ' ').trim();

function sensitiveMessage(reason) {
  const w = reason === 'PIN' ? 'einer PIN'
    : reason === 'IBAN' ? 'einer IBAN'
      : reason === 'Kartennummer' ? 'einer Kartennummer'
        : reason === 'Schlüssel' ? 'einem Zugangsschlüssel'
          : 'einem Passwort oder Zugangsdaten';
  return `Das sieht nach ${w} aus – das lege ich nicht ins Archiv.`;
}

/** Prüft einen Archivtext: { ok, text } oder { ok:false, reason, message }. */
export function checkArchiveText(text) {
  const t = tidyArchive(text);
  if (!t) return { ok: false, reason: 'empty', message: 'Was soll ich ins Archiv legen?' };
  if (t.length > MAX_TEXT) {
    return { ok: false, reason: 'too-long', message: `Das ist zu lang fürs Archiv (höchstens ${MAX_TEXT} Zeichen).` };
  }
  const s = sensitiveReason(t);
  if (s) return { ok: false, reason: 'sensitive', message: sensitiveMessage(s) };
  return { ok: true, text: t };
}

function normItem(it) {
  if (!it || typeof it !== 'object') return null;
  const text = tidyArchive(it.text).slice(0, MAX_TEXT);
  if (!text || sensitiveReason(text)) return null;
  const fach = FAECHER.includes(it.fach) ? it.fach : null;
  if (!fach) return null;
  return {
    id: typeof it.id === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(it.id) ? it.id : newId(),
    fach,
    text,
    status: STATUS.includes(it.status) ? it.status : 'offen',
    quelle: QUELLEN.includes(it.quelle) ? it.quelle : 'du',
    frist: normFrist(it.frist),
    erstellt: typeof it.erstellt === 'string' ? it.erstellt : new Date(0).toISOString(),
    geaendert: typeof it.geaendert === 'string' ? it.geaendert : (typeof it.erstellt === 'string' ? it.erstellt : new Date(0).toISOString())
  };
}

export function loadArchive(store) {
  const raw = store.get(ARCHIVE_KEY, null);
  const list = Array.isArray(raw?.items) ? raw.items : [];
  const items = [];
  const seen = new Set();
  const per = Object.fromEntries(FAECHER.map((f) => [f, 0]));
  for (const it of list) {
    const n = normItem(it);
    if (!n || seen.has(n.id)) continue;
    if (per[n.fach] >= MAX_PER_FACH) continue;
    seen.add(n.id);
    per[n.fach]++;
    items.push(n);
  }
  return { version: 1, items };
}

export function saveArchive(store, arch) {
  store.set(ARCHIVE_KEY, { version: 1, items: (arch.items || []).slice(0, MAX_PER_FACH * FAECHER.length) });
}

function countFach(items, fach) {
  return items.reduce((n, i) => n + (i.fach === fach ? 1 : 0), 0);
}

/**
 * Eintrag anlegen. quelle standardmäßig „du“ (der Besitzer).
 * → { ok, item, duplicate } oder { ok:false, reason, message }
 */
export function addArchive(store, text, { fach = 'todos', quelle = 'du', status = 'offen', frist = null, now = new Date() } = {}) {
  const chk = checkArchiveText(text);
  if (!chk.ok) return chk;
  const f = FAECHER.includes(fach) ? fach : parseFach(fach);
  if (!f) return { ok: false, reason: 'fach', message: 'Dieses Fach gibt es im Archiv nicht.' };
  const arch = loadArchive(store);
  const k = key(chk.text);
  const dup = arch.items.find((i) => i.fach === f && key(i.text) === k);
  const iso = now.toISOString();
  if (dup) {
    dup.geaendert = iso;
    saveArchive(store, arch);
    return { ok: true, item: dup, duplicate: true, message: `Das steht im Archiv (${fachLabel(f)}) schon: ${dup.text}.` };
  }
  if (countFach(arch.items, f) >= MAX_PER_FACH) {
    return { ok: false, reason: 'full', message: `Das Fach ${fachLabel(f)} ist voll (${MAX_PER_FACH} Einträge). Bitte erledigen oder löschen Sie in den Einstellungen etwas.` };
  }
  const item = {
    id: newId(),
    fach: f,
    text: chk.text,
    status: STATUS.includes(status) ? status : 'offen',
    quelle: QUELLEN.includes(quelle) ? quelle : 'du',
    frist: normFrist(frist),
    erstellt: iso,
    geaendert: iso
  };
  arch.items.push(item);
  saveArchive(store, arch);
  const fr = item.frist ? `, Frist ${item.frist.split('-').reverse().join('.')}` : '';
  return {
    ok: true, item, duplicate: false,
    message: `Archiv, Fach ${fachLabel(f)}, ${item.status}${fr}: ${item.text}.`
  };
}

export function updateArchive(store, id, changes = {}, now = new Date()) {
  const arch = loadArchive(store);
  const it = arch.items.find((i) => i.id === id);
  if (!it) return { ok: false, reason: 'missing', message: 'Diesen Archiv-Eintrag gibt es nicht mehr.' };
  const nextFach = changes.fach !== undefined ? (FAECHER.includes(changes.fach) ? changes.fach : parseFach(changes.fach)) : it.fach;
  if (changes.fach !== undefined && !nextFach) return { ok: false, reason: 'fach', message: 'Dieses Fach gibt es im Archiv nicht.' };
  if (nextFach !== it.fach && countFach(arch.items, nextFach) >= MAX_PER_FACH) {
    return { ok: false, reason: 'full', message: `Das Fach ${fachLabel(nextFach)} ist voll (${MAX_PER_FACH} Einträge).` };
  }
  if (changes.text !== undefined) {
    const chk = checkArchiveText(changes.text);
    if (!chk.ok) return chk;
    const k = key(chk.text);
    const dup = arch.items.find((i) => i.id !== it.id && i.fach === nextFach && key(i.text) === k);
    if (dup) return { ok: false, reason: 'duplicate', message: `Das steht im Fach ${fachLabel(nextFach)} schon.` };
    it.text = chk.text;
  }
  if (nextFach) it.fach = nextFach;
  if (STATUS.includes(changes.status)) it.status = changes.status;
  if (QUELLEN.includes(changes.quelle)) it.quelle = changes.quelle;
  if (changes.frist !== undefined) it.frist = normFrist(changes.frist);
  it.geaendert = now.toISOString();
  saveArchive(store, arch);
  return { ok: true, item: it, message: `Archiv geändert: Fach ${fachLabel(it.fach)}, ${it.status}.` };
}

export function removeArchive(store, id) {
  const arch = loadArchive(store);
  const removed = arch.items.find((i) => i.id === id) || null;
  if (!removed) return null;
  arch.items = arch.items.filter((i) => i.id !== id);
  saveArchive(store, arch);
  return removed;
}

function overlap(qt, text) {
  if (!qt.length) return 0;
  const words = tokens(text);
  let hit = 0;
  for (const q of qt) {
    if (words.some((w) => w === q || (q.length >= 4 && (w.startsWith(q) || q.startsWith(w)) && Math.min(w.length, q.length) >= 4))) hit++;
  }
  return hit / qt.length;
}

/**
 * Bester Treffer. → { item, score } | { ambiguous:true, items, score } | null
 * status: null = alle, sonst nur dieser Status (Standard: alle).
 */
export function findArchive(items, query, { fach = null, status = null } = {}) {
  const qk = key(query);
  if (!qk) return null;
  const qt = tokens(query);
  let pool = items;
  if (fach) pool = pool.filter((i) => i.fach === fach);
  if (status) pool = pool.filter((i) => i.status === status);
  const scored = [];
  for (const it of pool) {
    const ik = key(it.text);
    let score = overlap(qt, it.text);
    if (ik === qk) score = 2;
    else if (qk.length >= 4 && (ik.includes(qk) || qk.includes(ik))) score = Math.max(score, 1.5);
    if (score >= 0.5) scored.push({ item: it, score });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || String(b.item.geaendert).localeCompare(String(a.item.geaendert)));
  const top = scored.filter((s) => s.score === scored[0].score);
  if (top.length > 1) return { ambiguous: true, items: top.map((s) => s.item), score: top[0].score };
  return { item: scored[0].item, score: scored[0].score };
}

/** Offene Einträge, optional in einem Fach, neueste Änderung zuerst. */
export function listOpen(items, fach = null) {
  return items
    .filter((i) => i.status === 'offen' && (!fach || i.fach === fach))
    .sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
}

/**
 * Nur passende Ausschnitte fürs feste Budget.
 * Mit Suchwort: nur Treffer. Ohne Suchwort: ein paar neueste offene Einträge, nie alles.
 */
export function selectForPrompt(items, query = '', budget = PROMPT_BUDGET) {
  const qt = tokens(query);
  const byNew = [...items].sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
  const matched = qt.length ? byNew.filter((i) => overlap(qt, i.text) > 0) : [];
  const order = qt.length ? matched : byNew.filter((i) => i.status === 'offen').slice(0, 5);
  const out = [];
  let used = 0;
  for (const it of order) {
    const t = cleanText(it.text, EXCERPT).replace(/<\s*\/?\s*archiv/gi, '‹archiv');
    if (!t) continue;
    const piece = { f: it.fach, s: it.status, t };
    if (it.frist) piece.d = it.frist;
    const cost = JSON.stringify(piece).length + 1;
    if (used + cost > budget) continue;
    used += cost;
    out.push(piece);
  }
  return { items: out, omitted: items.length - out.length, used };
}

/** Eingezäunter Ausschnitt. Leer, wenn nichts Passendes ins Budget passt. */
export function promptArchive(items = [], query = '') {
  const sel = selectForPrompt(items, query, PROMPT_BUDGET);
  if (!sel.items.length) return { text: '', included: 0, omitted: items.length, items: [] };
  let text = `<archiv>\n${JSON.stringify(sel.items)}\n</archiv>`;
  if (sel.omitted > 0) text += `\nWeitere ${sel.omitted} Archiv-Einträge sind gespeichert, aber hier nicht aufgeführt.`;
  return { text, included: sel.items.length, omitted: sel.omitted, items: sel.items };
}

export function exportArchive(store) {
  return JSON.stringify({ jarvisArchive: 1, items: loadArchive(store).items }, null, 2);
}

export function exportArchiveText(store) {
  const items = loadArchive(store).items;
  const lines = ['Jarvis-Archiv', ''];
  for (const fach of FAECHER) {
    const list = items.filter((i) => i.fach === fach);
    if (!list.length) continue;
    lines.push(FACH_LABELS[fach]);
    for (const it of list) {
      const fr = it.frist ? `, Frist ${it.frist}` : '';
      lines.push(`- [${it.status}] ${it.text.replace(/\s*\n\s*/g, ' / ')} (${QUELLE_LABELS[it.quelle] || it.quelle}${fr})`);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

const dayStamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Datei fürs Sichern. JSON ist das Format zum Wiederherstellen. */
export function buildArchiveFile(store, format = 'json', now = new Date()) {
  const items = loadArchive(store).items;
  if (!items.length) return { ok: false, empty: true, message: 'Das Archiv ist leer – es gibt nichts zu sichern.' };
  const fmt = /json/i.test(String(format || '')) ? 'json' : 'txt';
  const text = fmt === 'json' ? exportArchive(store) : exportArchiveText(store);
  const n = items.length;
  return {
    ok: true,
    format: fmt,
    count: n,
    what: n === 1 ? '1 Archiv-Eintrag' : `${n} Archiv-Einträge`,
    name: `jarvis-archiv-${dayStamp(now)}.${fmt}`,
    mime: fmt === 'json' ? 'application/json' : 'text/plain',
    text: fmt === 'txt' ? text : text
  };
}

/**
 * Wiederherstellen aus JSON (Export oder Liste). Jeder Eintrag wird wie beim Anlegen geprüft.
 * Gedächtnis und kurze Notizen werden hier nicht angefasst.
 */
export function importArchive(store, json, now = new Date()) {
  let data;
  try { data = JSON.parse(String(json || '')); } catch { return { ok: false, message: 'Das ist kein gültiges JSON.' }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!list) return { ok: false, message: 'Keine Archiv-Einträge gefunden.' };
  let added = 0;
  let skipped = 0;
  for (const it of list.slice(0, MAX_PER_FACH * FAECHER.length)) {
    const text = typeof it === 'string' ? it : it?.text;
    const fach = typeof it === 'string' ? 'wissen' : it?.fach;
    const r = addArchive(store, text, {
      fach, quelle: it?.quelle, status: it?.status, frist: it?.frist, now
    });
    if (r.ok && !r.duplicate) added++;
    else skipped++;
  }
  return { ok: true, added, skipped, message: `${added} ins Archiv übernommen, ${skipped} übersprungen. Gedächtnis und kurze Notizen bleiben unverändert.` };
}
