// Lokale Fähigkeiten ohne KI: Uhrzeit, Datum, Timer, Notizen, Hilfe.
// handleSkill(text, ctx) → Antworttext oder null (= an die KI weitergeben).

import { normalizeText } from './wakeword.js';

const NUMBER_WORDS = {
  null: 0, ein: 1, eine: 1, einen: 1, einer: 1, eins: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14,
  fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreissig: 30,
  vierzig: 40, fuenfzig: 50, sechzig: 60, neunzig: 90, hundert: 100
};

/** "fünfundzwanzig" → 25, "7" → 7, "2,5" → 2.5 */
export function parseNumber(word) {
  const w = normalizeText(word).replace(/\s/g, '');
  const raw = String(word).replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(raw)) return parseFloat(raw);
  if (w in NUMBER_WORDS) return NUMBER_WORDS[w];
  const m = w.match(/^(\w+?)und(\w+)$/);
  if (m && m[1] in NUMBER_WORDS && m[2] in NUMBER_WORDS) return NUMBER_WORDS[m[1]] + NUMBER_WORDS[m[2]];
  return null;
}

const UNITS = [
  [/^(sekunde|sekunden|sek|s)$/, 1000],
  [/^(minute|minuten|min)$/, 60000],
  [/^(stunde|stunden|std|h)$/, 3600000]
];

/** Liest eine Dauer aus dem Text, z. B. "1 Stunde und 30 Minuten" → ms. */
export function parseDuration(text) {
  const t = String(text).toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  let total = 0;
  let found = false;
  if (/halbe stunde/.test(t)) { total += 1800000; found = true; }
  if (/viertelstunde|viertel stunde/.test(t)) { total += 900000; found = true; }
  const words = t.replace(/[^\p{L}\d.\s]/gu, ' ').split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    const unit = UNITS.find(([re]) => re.test(normalizeText(words[i])));
    if (!unit) continue;
    let n = parseNumber(words[i - 1]);
    if (n === null && words[i - 1] === 'halbe') continue;
    if (n === null) continue;
    total += n * unit[1];
    found = true;
  }
  return found && total > 0 ? Math.round(total) : null;
}

/** 330000 → "5 Minuten und 30 Sekunden" */
export function formatDuration(ms) {
  let s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'Stunde' : 'Stunden'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'Minute' : 'Minuten'}`);
  if (s || parts.length === 0) parts.push(`${s} ${s === 1 ? 'Sekunde' : 'Sekunden'}`);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' und ' + parts.at(-1) : parts[0];
}

const NOTES_KEY = 'notes';
export const loadNotes = (store) => store.get(NOTES_KEY, []);

const HOUR_WORDS = { ein: 1, eins: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12 };
const hourTok = (w) => (/^\d{1,2}$/.test(w) ? Number(w) : HOUR_WORDS[w] ?? null);

/**
 * Uhrzeit aus gesprochenem Text: „7 Uhr“, „7:30“, „7.30 Uhr“, „7 Uhr 15“, „halb sieben“,
 * „viertel nach 7“, „viertel vor acht“. → { hour, minute } oder null.
 */
export function parseClockTime(text) {
  const t = normalizeText(String(text || '').replace(/(\d)\s*[:.]\s*(\d{2})(?!\d)/g, '$1 uhr $2'));
  const ok = (h, m) => (h >= 0 && h <= 23 && m >= 0 && m <= 59 ? { hour: h, minute: m } : null);
  let m = t.match(/\bhalb (\w+)/);
  if (m && hourTok(m[1]) !== null) return ok((hourTok(m[1]) + 23) % 24, 30);
  m = t.match(/\bviertel nach (\w+)/);
  if (m && hourTok(m[1]) !== null) return ok(hourTok(m[1]), 15);
  m = t.match(/\b(?:viertel vor|dreiviertel) (\w+)/);
  if (m && hourTok(m[1]) !== null) return ok((hourTok(m[1]) + 23) % 24, 45);
  m = t.match(/\b(\w+) uhr(?: (\d{1,2}))?\b/);
  if (m && hourTok(m[1]) !== null) return ok(hourTok(m[1]), m[2] ? Number(m[2]) : 0);
  return null;
}

/**
 * ctx = { store, timers, now: Date, name }
 */
export function handleSkill(text, ctx) {
  const raw = String(text).trim();
  const t = normalizeText(raw);
  const now = ctx.now || new Date();
  const name = ctx.name || 'Jarvis';

  // --- Notizen ---
  const remember = raw.match(/^(?:bitte\s+)?(?:merke?|merk)\s+dir(?:\s+bitte)?[,:]?\s+(?:dass\s+)?(.+)$/i)
    || raw.match(/^(?:notiere|notier)(?:\s+bitte)?[,:]?\s+(.+)$/i);
  if (remember) {
    const note = remember[1].replace(/[.!]+$/, '').trim();
    const notes = loadNotes(ctx.store);
    notes.push({ text: note, at: now.toISOString() });
    ctx.store.set(NOTES_KEY, notes);
    return `Sehr wohl, ich habe mir notiert: ${note}.`;
  }
  if (/(was|welche).*(hab|habe|hast).*(ich|du).*(gemerkt|notiert)|meine notizen|zeig.*notizen|was weisst du (ueber mich|noch)/.test(t)) {
    const notes = loadNotes(ctx.store);
    if (!notes.length) return 'Ich habe mir bisher nichts gemerkt.';
    return `Sie haben mir ${notes.length === 1 ? 'eine Sache' : notes.length + ' Dinge'} anvertraut: ` +
      notes.map((n) => n.text).join('; ') + '.';
  }
  if (/(loesch|vergiss).*(notizen|alles was|alles)/.test(t)) {
    ctx.store.set(NOTES_KEY, []);
    return 'Erledigt. Mein Gedächtnis ist wieder blütenweiß.';
  }

  // --- Timer ---
  if (/timer|wecker|countdown/.test(t)) {
    // „Wecker auf 7 Uhr“ ist ein Wecker in der Uhr-App (Werkzeug set_alarm), kein Timer.
    if (/wecker/.test(t) && !/timer|countdown/.test(t) && parseClockTime(raw)) return null;
    if (/(stopp|stop|abbrech|loesch|beend|aus\b|cancel)/.test(t)) {
      const n = ctx.timers.cancelAll();
      return n ? `${n === 1 ? 'Der Timer wurde' : n + ' Timer wurden'} gestoppt.` : 'Es läuft derzeit kein Timer.';
    }
    if (/(wie lange|wieviel|wie viel|noch|status|restzeit)/.test(t) && !/\d|minute|sekunde|stunde/.test(t.replace(/wie viel zeit/, ''))) {
      const list = ctx.timers.list();
      if (!list.length) return 'Es läuft derzeit kein Timer.';
      return list.map((x) => `Noch ${formatDuration(x.remainingMs)}`).join('. ') + '.';
    }
    const ms = parseDuration(raw);
    if (ms) {
      if (ms > 24 * 3600000) return 'Verzeihung, mehr als 24 Stunden kann ich leider nicht stoppen.';
      ctx.timers.start(ms, formatDuration(ms));
      return `Timer auf ${formatDuration(ms)} gestellt. Ich melde mich.`;
    }
    return 'Wie lange soll der Timer laufen? Sagen Sie zum Beispiel: Stell einen Timer auf 5 Minuten.';
  }

  // --- Uhrzeit ---
  if (/(wie spaet|wieviel uhr|wie viel uhr|uhrzeit|zeit ist es)/.test(t)) {
    const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: ctx.timeZone });
    return `Es ist ${time} Uhr.`;
  }

  // --- Datum ---
  if (/(welches datum|datum|welcher tag|welchen tag|der wievielte|den wievielten|was fuer ein tag)/.test(t)) {
    const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ctx.timeZone });
    return `Heute ist ${date}.`;
  }

  // --- Hilfe / Name ---
  if (/^(hilfe|was kannst du|was kannst du alles|was vermagst du)/.test(t)) {
    const extras = ctx.registry?.helpLines?.() || [
      'Anrufen, SMS, WhatsApp, E-Mail, Navigation, YouTube, Spotify, Websites öffnen',
      'Text teilen, vibrieren, Akkustand, Standort, Zwischenablage, Taschenlampe (falls erlaubt)'
    ];
    return `Ich bin ${name}. Ich kann Uhrzeit und Datum nennen, Timer stellen und mir Dinge merken. ` +
      `Außerdem: ${extras.join('; ')}. ` +
      'Aktionen wie Anrufen oder WhatsApp fragen vorher mit Ja/Nein nach. ' +
      'Mit API-Schlüssel verstehe ich auch freiere Formulierungen.';
  }
  if (/^(wie heisst du|wer bist du|wie ist dein name)/.test(t)) {
    return `Mein Name ist ${name}. Stets zu Diensten.`;
  }
  return null;
}
