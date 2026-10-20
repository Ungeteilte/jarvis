// Sprachbefehle fürs Gedächtnis und die Vorlieben (lokal, ohne KI).
// → null (kein Befehl) oder { text, confirm?, settingsChanged?, memoryChanged? }
import { normalizeText } from './wakeword.js';
import { addMemory, loadMemory, removeMemory, findMemory } from './memory.js';
import { loadSettings, saveSettings } from './settings.js';
import { normalizePrefs } from './prefs.js';
import { loadNotes } from './skills.js';

export const UNDO_MS = 2 * 60000;
const MAX_SPOKEN = 5;

const REMEMBER = /^(?:bitte\s+)?(?:merke?|merk)\s+dir(?:\s+bitte)?(?:\s+mal)?[,:]?\s*(?:,\s*)?(?:(?:dass|das)\b|,)?\s*(.*)$/i;
const FORGET_ONE = /^(?:bitte\s+)?vergiss(?:\s+bitte)?[,:]?\s+(?:dass|das mit|die sache mit|den eintrag|den eintrag mit|was ich (?:dir )?(?:über|ueber)\s+)\s*(.+)$/i;
const FORGET_LAST = /^(?:bitte\s+)?(?:vergiss (?:das|es)(?: (?:wieder|bitte))?|das (?:sollst|kannst) du (?:wieder )?vergessen|r(?:ü|ue)ckg(?:ä|ae)ngig)[.!]?$/i;
const FORGET_ALL_N = /^(?:bitte )?(?:vergiss (?:alles|alles was du (?:ueber mich|von mir) weisst|alles ueber mich)|(?:loesch|loesche|leere) (?:dein|das) gedaechtnis(?: komplett)?)$/;
const WHAT_N = /(was weisst du (?:alles |denn |eigentlich )*(?:ueber mich|von mir)|was hast du dir (?:alles )?gemerkt|was habe ich (?:dir|mir) (?:alles )?gemerkt|was hab ich (?:dir|mir) gemerkt|was weisst du noch|zeig (?:mir )?(?:dein|das) gedaechtnis)/;

function prefCommand(t) {
  if (/\b(antworte|fass dich|sprich|rede)\b.*\b(kuerzer|knapper|kurz)\b|\b(kuerzere|knappere) antworten\b/.test(t)) return { antwortlaenge: 'kurz' };
  if (/\b(antworte|sprich|erklaer|rede)\b.*\b(ausfuehrlicher|laenger|ausfuehrlich)\b|\b(ausfuehrlichere|laengere) antworten\b/.test(t)) return { antwortlaenge: 'ausfuehrlich' };
  if (/\bantworte (wieder )?normal\b|\bnormale antwortlaenge\b/.test(t)) return { antwortlaenge: 'normal' };
  if (/\b(duz|duze|duzt) mich\b|\bdu kannst mich duzen\b|\bsag du zu mir\b|\bbitte duzen\b/.test(t)) return { anrede: 'du' };
  if (/\b(siez|sieze|siezt) mich\b|\bbitte siezen\b|\bsag sie zu mir\b/.test(t)) return { anrede: 'Sie' };
  if (/\b(weniger|keine|lass die) (humor|witze|scherze|ironie)\b|\bsei ernster\b/.test(t)) return { humor: 'weniger' };
  if (/\b(mehr|wieder) (humor|witze)\b/.test(t)) return { humor: 'an' };
  return null;
}

const PREF_REPLY = {
  antwortlaenge: { kurz: 'Sehr wohl, ich fasse mich künftig kürzer.', normal: 'Sehr wohl, ich antworte wieder in normaler Länge.', ausfuehrlich: 'Sehr wohl, ich antworte künftig ausführlicher.' },
  anrede: { du: 'Gern – ab jetzt duze ich dich.', Sie: 'Sehr wohl, ich sieze Sie wieder.' },
  humor: { weniger: 'Verstanden, ich halte mich mit Scherzen zurück.', an: 'Mit Vergnügen – der Humor ist zurück.' }
};

const SUBJ1 = /^(ich|wir|er|es|du|man)$/i;
const POSS = /^(mein|meine|meinen|meinem|meiner|unser|unsere|der|die|das)$/i;
/**
 * „dass ich dienstags streame“ → „Ich streame dienstags“ (Verb vom Ende hinter das Subjekt).
 * Nur wenn Subjekt (ich/wir/…, „meine Katze“, Name) und ein klein geschriebenes Verb am Ende erkennbar sind.
 */
export function dassToMain(text) {
  const w = String(text).trim().split(/\s+/);
  if (w.length < 3) return cap(text);
  const last = w[w.length - 1];
  if (!/^[a-zäöüß]+$/.test(last) || /^(nicht|gern|gerne|auch|immer|nie|oft|so|da|hier|dort)$/.test(last)) return cap(text);
  let n = 0;
  if (SUBJ1.test(w[0])) n = 1;
  else if (POSS.test(w[0]) && /^[A-ZÄÖÜ]/.test(w[1] || '')) n = 2;
  else if (/^[A-ZÄÖÜ][a-zäöüß]+$/.test(w[0])) n = 1;
  if (!n || w.length - 1 <= n) return cap(text);
  return cap([...w.slice(0, n), last, ...w.slice(n, -1)].join(' '));
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

export function handleMemoryCommand(input, { store, now = new Date(), lastAdded = null } = {}) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const t = normalizeText(raw).replace(/[.!?]+$/, '').trim();

  const rem = raw.match(REMEMBER);
  if (rem) {
    const hadDass = /\bdass\s*$/i.test(raw.slice(0, raw.length - rem[1].length));
    let text = rem[1].replace(/^[,:\s]+/, '').replace(/[.!]+$/, '').trim();
    if (hadDass) text = dassToMain(text);
    else text = cap(text);
    if (!text || /^(das|es|was)$/i.test(text)) return { text: 'Was soll ich mir merken? Sagen Sie zum Beispiel „Merk dir, dass ich dienstags streame“.' };
    const r = addMemory(store, text, { quelle: 'sprache', now });
    if (!r.ok) return { text: r.message };
    return { text: r.duplicate ? r.message : `Gemerkt: ${r.item.text}. Wenn das falsch war, sagen Sie „Vergiss das“.`, memoryChanged: true, added: r.duplicate ? null : r.item };
  }

  if (FORGET_LAST.test(t) || FORGET_LAST.test(raw)) {
    if (lastAdded && now.getTime() - lastAdded.at <= UNDO_MS) {
      const gone = removeMemory(store, lastAdded.id);
      if (gone) return { text: `Erledigt, vergessen: ${gone.text}.`, memoryChanged: true, undone: true };
    }
    return { text: 'Was genau soll ich vergessen? Sagen Sie zum Beispiel „Vergiss, dass ich montags Uni habe“.' };
  }

  if (FORGET_ALL_N.test(t)) {
    const n = loadMemory(store).items.length;
    if (!n) return { text: 'Mein Gedächtnis ist bereits leer.' };
    const title = n === 1 ? 'Den einen Eintrag im Gedächtnis löschen?' : `Alle ${n} Einträge im Gedächtnis löschen?`;
    return {
      text: `${title} Tippen Sie auf Ja oder sagen Sie „Ja“.`,
      confirm: { title, detail: 'Das lässt sich nicht rückgängig machen. Notizen bleiben erhalten.', action: { type: 'clearMemory' } }
    };
  }

  const one = raw.match(FORGET_ONE);
  if (one) {
    const items = loadMemory(store).items;
    const hit = findMemory(items, one[1]);
    if (!hit) return { text: 'Dazu habe ich nichts im Gedächtnis.' };
    const title = 'Diesen Eintrag vergessen?';
    return {
      text: `Soll ich „${hit.item.text}“ vergessen? Tippen Sie auf Ja oder sagen Sie „Ja“.`,
      confirm: { title, detail: hit.item.text, action: { type: 'forgetMemory', id: hit.item.id } }
    };
  }

  if (WHAT_N.test(t)) {
    const items = loadMemory(store).items;
    const notes = loadNotes(store).length;
    const noteHint = notes ? ` Außerdem gibt es ${notes === 1 ? 'eine Notiz' : notes + ' Notizen'} („Meine Notizen“).` : '';
    if (!items.length) return { text: `Über Sie weiß ich noch nichts. Sagen Sie zum Beispiel „Merk dir, dass …“.${noteHint}` };
    const newest = [...items].sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
    const first = newest.slice(0, MAX_SPOKEN).map((i) => i.text).join('; ');
    const more = items.length > MAX_SPOKEN ? ` … und ${items.length - MAX_SPOKEN} weitere – alle stehen in den Einstellungen unter „Gedächtnis“.` : '';
    return { text: `Ich weiß ${items.length === 1 ? 'eine Sache' : items.length + ' Dinge'} über Sie: ${first}.${more}${noteHint}` };
  }

  const pc = prefCommand(t);
  if (pc) {
    const s = loadSettings(store);
    saveSettings(store, { prefs: normalizePrefs({ ...s.prefs, ...pc }) });
    const [k, v] = Object.entries(pc)[0];
    return { text: PREF_REPLY[k][v], settingsChanged: true };
  }
  return null;
}
