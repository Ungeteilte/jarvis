// v0.9 W1 – Welche installierte App ist gemeint? (reine Textlogik, ohne Browser-Funktionen)
//
// Eingabe: gesprochener Name + Liste {label, package} der startbaren Apps (Launcher-Einträge).
// Reihenfolge: exakter Name → festes deutsches Synonym → Wortanfang → ganzes Wort → Tippfehler-Abstand.
// Ergebnis-Arten:
//   exact     – eindeutig (Name oder Synonym passt genau) → darf sofort starten
//   fuzzy     – ein bester unscharfer Treffer → Karte „Meinten Sie …?“
//   ambiguous – mehrere gleich gute Treffer → Auswahlkarte (höchstens 3)
//   none      – nichts passt → Antwort mit bis zu 3 ähnlichen Namen
//   invalid   – leer oder kürzer als 2 Zeichen → kein Start
import { normalizeText, levenshtein } from './wakeword.js';

export const MIN_NAME_LEN = 2;
export const MAX_CHOICES = 3;

// Feste Synonyme (nur per Release änderbar): gesprochener Name → Paketnamen (Samsung zuerst, dann Google).
// Mehrere installierte Pakete für ein Synonym → Auswahlkarte statt Raten.
const SYNONYMS = {
  'einstellungen': ['com.android.settings'],
  'kamera': ['com.sec.android.app.camera', 'com.google.android.GoogleCamera'],
  'galerie': ['com.sec.android.gallery3d'],
  'fotos': ['com.google.android.apps.photos', 'com.sec.android.gallery3d'],
  'rechner': ['com.sec.android.app.popupcalculator', 'com.google.android.calculator'],
  'taschenrechner': ['com.sec.android.app.popupcalculator', 'com.google.android.calculator'],
  'uhr': ['com.sec.android.app.clockpackage', 'com.google.android.deskclock'],
  'wecker': ['com.sec.android.app.clockpackage', 'com.google.android.deskclock'],
  'samsung notes': ['com.samsung.android.app.notes'],
  'notes': ['com.samsung.android.app.notes', 'com.google.android.keep'],
  'notizen': ['com.samsung.android.app.notes', 'com.google.android.keep'],
  'eigene dateien': ['com.sec.android.app.myfiles'],
  'meine dateien': ['com.sec.android.app.myfiles'],
  'dateien': ['com.sec.android.app.myfiles', 'com.google.android.apps.nbu.files'],
  'telefon': ['com.samsung.android.dialer', 'com.google.android.dialer'],
  'nachrichten': ['com.samsung.android.messaging', 'com.google.android.apps.messaging'],
  'sms': ['com.samsung.android.messaging', 'com.google.android.apps.messaging'],
  'kontakte': ['com.samsung.android.app.contacts', 'com.google.android.contacts'],
  'kalender': ['com.samsung.android.calendar', 'com.google.android.calendar'],
  'play store': ['com.android.vending'],
  'internet': ['com.sec.android.app.sbrowser'],
  'browser': ['com.sec.android.app.sbrowser', 'com.android.chrome']
};

// Füllwörter rund um den Namen („die App Kamera bitte“)
const LEAD = new Set(['bitte', 'mal', 'doch', 'die', 'den', 'das', 'meine', 'meinen', 'mein', 'app', 'anwendung']);
const TRAIL = new Set(['bitte', 'mal', 'app', 'anwendung']);

/** Gesprochenen App-Namen vereinheitlichen (Umlaute, Füllwörter vorn/hinten). */
export function normalizeAppName(name) {
  const w = normalizeText(name).split(' ').filter(Boolean);
  while (w.length && LEAD.has(w[0])) w.shift();
  while (w.length && TRAIL.has(w[w.length - 1])) w.pop();
  return w.join(' ');
}

const allowed = (len) => (len < 4 ? 0 : len <= 6 ? 1 : 2);

/** Punktzahl eines Labels für die Anfrage (0 = passt nicht). */
function score(q, label) {
  const l = normalizeText(label);
  if (!l) return 0;
  if (l === q) return 100;
  const words = l.split(' ');
  const qWords = q.split(' ');
  if (l.startsWith(q)) return 80;                                  // Wortanfang des Namens
  if (words.some((w, i) => words.slice(i).join(' ').startsWith(q))) return 70; // Wortanfang eines späteren Worts
  if (qWords.every((w) => words.includes(w))) return 60;           // ganze Wörter (andere Reihenfolge)
  const lim = allowed(q.length);
  if (lim) {
    const d = Math.min(levenshtein(q, l), ...words.map((w) => levenshtein(q, w)));
    if (d <= lim) return 40 - d;
  }
  return 0;
}

const uniqApps = (apps) => {
  const seen = new Set();
  return (Array.isArray(apps) ? apps : []).filter((a) => {
    if (!a || typeof a.package !== 'string' || !a.package || seen.has(a.package)) return false;
    seen.add(a.package);
    a.label = String(a.label || a.package);
    return true;
  });
};

/** Hauptfunktion: siehe Kopfkommentar. */
export function matchApps(name, apps) {
  const q = normalizeAppName(name);
  if (q.replace(/\s/g, '').length < MIN_NAME_LEN) return { kind: 'invalid', query: q, candidates: [] };
  const list = uniqApps(apps);
  const scored = list.map((a) => ({ app: a, s: score(q, a.label) })).filter((x) => x.s > 0);
  // 1) exakter Name
  const exact = scored.filter((x) => x.s === 100).map((x) => x.app);
  if (exact.length === 1) return { kind: 'exact', query: q, app: exact[0], candidates: exact };
  if (exact.length > 1) return { kind: 'ambiguous', query: q, candidates: exact.slice(0, MAX_CHOICES) };
  // 2) festes Synonym
  const syn = SYNONYMS[q];
  if (syn) {
    const hits = syn.map((p) => list.find((a) => a.package === p)).filter(Boolean);
    if (hits.length === 1) return { kind: 'exact', query: q, app: hits[0], candidates: hits, synonym: true };
    if (hits.length > 1) return { kind: 'ambiguous', query: q, candidates: hits.slice(0, MAX_CHOICES), synonym: true };
  }
  // 3) unscharf: bester Treffer allein → fuzzy, Gleichstand → ambiguous
  scored.sort((a, b) => b.s - a.s || a.app.label.length - b.app.label.length);
  if (scored.length) {
    const top = scored.filter((x) => x.s === scored[0].s).map((x) => x.app);
    if (top.length === 1) return { kind: 'fuzzy', query: q, app: top[0], candidates: top };
    return { kind: 'ambiguous', query: q, candidates: top.slice(0, MAX_CHOICES) };
  }
  // 4) nichts: die 3 ähnlichsten Namen als Hilfe
  const similar = list
    .map((a) => {
      const l = normalizeText(a.label);
      return { a, d: Math.min(levenshtein(q, l), ...l.split(' ').map((w) => levenshtein(q, w))) };
    })
    .sort((x, y) => x.d - y.d || x.a.label.localeCompare(y.a.label))
    .slice(0, MAX_CHOICES)
    .map((x) => x.a.label);
  return { kind: 'none', query: q, candidates: [], similar };
}

const ORDINALS = [
  /^(?:die\s+|der\s+|das\s+|nummer\s+)?(?:erste|ersten|erster|eins|1|1\.)$/,
  /^(?:die\s+|der\s+|das\s+|nummer\s+)?(?:zweite|zweiten|zweiter|zwei|2|2\.)$/,
  /^(?:die\s+|der\s+|das\s+|nummer\s+)?(?:dritte|dritten|dritter|drei|3|3\.)$/
];

/**
 * Gesprochene Auswahl auf einer Auswahlkarte: „die erste“, „zwei“, „die letzte“ oder der Name.
 * choices: [{label, …}] → Index oder -1.
 */
export function pickChoice(text, choices) {
  if (String(text || '').length > 40) return -1; // lange Sätze sind keine Auswahl
  const t = normalizeAppName(String(text || '').replace(/^(?:ja|nimm|oeffne|öffne|starte)\s+/i, ''));
  const n = Array.isArray(choices) ? choices.length : 0;
  if (!t || !n) return -1;
  for (let i = 0; i < ORDINALS.length; i++) if (ORDINALS[i].test(t)) return i < n ? i : -1;
  if (/^(?:die\s+|der\s+|das\s+)?letzte[nr]?$/.test(t)) return n - 1;
  const m = matchApps(t, choices.map((c, i) => ({ label: c.label, package: String(i) })));
  if (m.kind === 'exact' || m.kind === 'fuzzy') return Number(m.app.package);
  return -1;
}
