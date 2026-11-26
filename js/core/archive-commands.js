// Sprachbefehle fürs Archiv (lokal, ohne KI). Gedächtnis („Merk dir …“) und kurze Notizen
// („Notiere …“, „Schreib auf …“) bleiben eigene Befehle und werden hier nicht angefasst.
// → null (kein Archiv-Befehl) oder { text, confirm?, archiveChanged? }
import { normalizeText } from './wakeword.js';
import {
  addArchive, loadArchive, updateArchive, findArchive, listOpen, parseFach, extractFrist, extractQuelle,
  fachLabel, FACH_LABELS, buildArchiveFile
} from './archive.js';
import { loadMemory } from './memory.js';
import { loadNotes } from './skills.js';

const MAX_SPOKEN = 6;
const SPOKEN_CHARS = 140;

const clip = (t) => {
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > SPOKEN_CHARS ? s.slice(0, SPOKEN_CHARS - 1).trim() + '…' : s;
};

const spokenItem = (it) => {
  const fr = it.frist ? `, Frist ${it.frist.split('-').reverse().join('.')}` : '';
  return `${fachLabel(it.fach)}, ${it.status}${fr}: ${clip(it.text)}`;
};

function fachWord(raw) {
  const w = normalizeText(raw).replace(/^(?:den|die|das|dem|fach)\s+/, '').trim();
  if (!w) return { ok: true, fach: null };
  const f = parseFach(w);
  if (f) return { ok: true, fach: f };
  const n = w.replace(/\s+/g, '');
  if (/^(eintraege|eintrag|archiv|alles|sachen|liste)$/.test(n)) return { ok: true, fach: null };
  return { ok: false };
}

function openReply(store, fach) {
  const open = listOpen(loadArchive(store).items, fach);
  const where = fach ? `Im Fach ${fachLabel(fach)}` : 'Im Archiv';
  const aside = ' Das sind Archiv-Einträge, keine kurzen Notizen („Notiere …“) und kein Gedächtnis („Merk dir …“).';
  if (!open.length) return { text: `${where} ist nichts offen.${aside}` };
  const first = open.slice(0, MAX_SPOKEN).map(spokenItem).join('; ');
  const more = open.length > MAX_SPOKEN ? ` … und ${open.length - MAX_SPOKEN} weitere, in den Einstellungen unter „Archiv“.` : '';
  const n = open.length === 1 ? 'ist 1 Eintrag' : `sind ${open.length} Einträge`;
  return { text: `${where} ${n} offen: ${first}.${more}${aside}` };
}

function counts(store) {
  const items = loadArchive(store).items;
  if (!items.length) {
    return { text: 'Das Archiv ist noch leer. Sagen Sie zum Beispiel „Leg auf Todos Steuererklärung“. Kurze Notizen und das Gedächtnis sind davon getrennt.' };
  }
  const parts = [];
  for (const [fach, label] of Object.entries(FACH_LABELS)) {
    const list = items.filter((i) => i.fach === fach);
    if (!list.length) continue;
    const offen = list.filter((i) => i.status === 'offen').length;
    parts.push(`${fach === 'notizen' ? 'Archiv-Notizen' : label}: ${offen} offen von ${list.length}`);
  }
  const notes = loadNotes(store).length;
  const mem = loadMemory(store).items.length;
  return {
    text: `Im Archiv: ${parts.join('; ')}. Kurze Notizen: ${notes}. Gedächtnis: ${mem} ${mem === 1 ? 'Eintrag' : 'Einträge'}.`
  };
}

function mark(store, id, status, now) {
  const r = updateArchive(store, id, { status }, now);
  if (!r.ok) return { text: r.message };
  const word = status === 'erledigt' ? 'erledigt' : status === 'verworfen' ? 'verworfen' : 'wieder offen';
  return { text: `Archiv, ${word}: ${clip(r.item.text)} (${fachLabel(r.item.fach)}).`, archiveChanged: true };
}

/**
 * @returns {null | { text: string, confirm?: object, archiveChanged?: boolean }}
 */
export function handleArchiveCommand(input, { store, now = new Date() } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const t = normalizeText(raw).replace(/[.!?]+$/, '').trim();

  const leg = raw.match(/^(?:bitte\s+)?leg(?:e)?\s+(?:bitte\s+)?(?:auf|in|ins|unter)\s+(?:das\s+fach\s+|fach\s+|die\s+|den\s+|das\s+)?(\S+)\s*[:,]?\s*(.*)$/i);
  if (leg) {
    const fach = parseFach(leg[1]);
    if (!fach) return null;
    let rest = leg[2].replace(/^[,:\s]+/, '').trim();
    const src = extractQuelle(rest);
    rest = src.text;
    const fr = extractFrist(rest, now);
    if (!fr.text) return { text: `Was soll ich ins Fach ${fachLabel(fach)} legen?` };
    const r = addArchive(store, fr.text, { fach, quelle: src.quelle || 'du', frist: fr.frist, now });
    if (!r.ok) return { text: r.message };
    const note = fach === 'notizen'
      ? ' Das ist eine Archiv-Notiz, nicht die kurzen Notizen und nicht das Gedächtnis.'
      : ' Gedächtnis und kurze Notizen bleiben unverändert.';
    return { text: r.message + note, archiveChanged: true };
  }

  let openTail = null;
  const open1 = t.match(/^(?:bitte )?(?:was ist noch offen|was habe ich noch offen|welche sind noch offen)(?: (?:bei|im fach|in|fuer) (.+))?$/);
  const open2 = t.match(/^(?:bitte )?(?:zeig(?:e)? (?:mir )?)?(?:die |alle )?(?:noch )?offenen? (.+)$/);
  if (open1) openTail = open1[1] || '';
  else if (open2) openTail = open2[1];
  if (openTail !== null) {
    const fw = fachWord(openTail);
    if (!fw.ok) return null;
    return openReply(store, fw.fach);
  }

  if (/^(?:bitte )?(?:was steht im archiv|zeig (?:mir )?(?:das )?archiv|archiv zeigen)$/.test(t)) return counts(store);

  const search = t.match(/^(?:bitte )?(?:such(?:e)?(?: im)? archiv(?: nach)?|was steht im archiv(?: zu| ueber| bei)?) (.+)$/);
  if (search) {
    const q = search[1].trim();
    const hit = findArchive(loadArchive(store).items, q, {});
    if (!hit) return { text: `Im Archiv habe ich zu „${q}“ nichts. Gedächtnis und kurze Notizen sind eine andere Liste.` };
    const list = hit.ambiguous ? hit.items : [hit.item];
    return { text: `Im Archiv ${list.length === 1 ? 'ein Treffer' : list.length + ' Treffer'}: ${list.slice(0, MAX_SPOKEN).map(spokenItem).join('; ')}.` };
  }

  const done = raw.match(/^(?:bitte\s+)?(?:(?:todo|aufgabe)\s+erledigt|erledige\s+(?:das\s+)?(?:todo|aufgabe|archiv(?:-|\s)?todo))\s*[:,]?\s+(.+)$/i);
  if (done) {
    const q = done[1].replace(/[.!]+$/, '').trim();
    const hit = findArchive(loadArchive(store).items, q, { fach: 'todos', status: 'offen' })
      || findArchive(loadArchive(store).items, q, { status: 'offen' });
    if (!hit) return { text: 'Dazu habe ich nichts Offenes im Archiv.' };
    if (hit.ambiguous) {
      return { text: `Dazu passen mehrere offene Einträge: ${hit.items.slice(0, 3).map((i) => clip(i.text)).join('; ')}. Bitte genauer sagen.` };
    }
    return mark(store, hit.item.id, 'erledigt', now);
  }

  const marked = raw.match(/^(?:bitte\s+)?markiere\s+im\s+archiv\s+(.+?)\s+als\s+(erledigt|verworfen|offen)\s*[.!?]*$/i);
  if (marked) {
    const status = normalizeText(marked[2]);
    const hit = findArchive(loadArchive(store).items, marked[1], {});
    if (!hit) return { text: 'Dazu habe ich nichts im Archiv.' };
    if (hit.ambiguous) {
      return { text: `Dazu passen mehrere Einträge: ${hit.items.slice(0, 3).map((i) => clip(i.text)).join('; ')}. Bitte genauer sagen.` };
    }
    return mark(store, hit.item.id, status, now);
  }

  const backup = t.match(/^(?:bitte )?(?:archiv (?:sichern|exportieren|speichern)|(?:sicher|speicher|exportier)e? (?:bitte )?(?:das )?archiv)(?: als (json|text|txt))?$/);
  if (backup) {
    const format = backup[1] && !/json/.test(backup[1]) ? 'txt' : 'json';
    const file = buildArchiveFile(store, format, now);
    if (!file.ok) return { text: file.message };
    const kind = format === 'json' ? 'JSON-Datei (damit lässt sich das Archiv wiederherstellen)' : 'Textdatei';
    return {
      text: `Das Archiv als ${kind} sichern (${file.what})? Tippen Sie auf Ja oder sagen Sie „Ja“.`,
      confirm: {
        title: 'Archiv sichern?',
        detail: `${file.name} – Ort und Namen wählen Sie gleich im System-Dialog. API-Schlüssel sind nicht dabei.`,
        action: { type: 'exportArchive', format }
      }
    };
  }

  return null;
}
