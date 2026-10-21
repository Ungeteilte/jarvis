// v0.9 W5 – Medien steuern, Gerätestatus, Kalender-Entwurf, Notizen löschen.
import { parseEvent } from '../../calendar-draft.js';
import { parseWhen, formatWhen } from '../../reminders.js';
import { loadNotes } from '../../skills.js';
import { findNotes, deleteNoteAt, clearNotes } from '../../notes.js';

const str = (d) => ({ type: 'string', description: d });
const obj = (props, required = []) => ({ type: 'object', properties: props, required });
const nowOf = (ctx) => (ctx.now instanceof Date ? ctx.now : new Date());

export const MEDIA_ACTIONS = ['pause', 'weiter', 'naechster', 'zurueck'];
const MEDIA_DONE = { pause: 'Pausiert.', weiter: 'Weiter geht’s.', naechster: 'Nächster Titel.', zurueck: 'Vorheriger Titel.' };

/** Gerätestatus als Satz; fehlende Werte heißen „unbekannt“ (festes Schema, keine fremden Texte). */
export function describeStatus(s = {}) {
  const v = (x) => (x == null || x === '' ? 'unbekannt' : x);
  const akku = typeof s.akku === 'number' ? `${s.akku} %` : 'unbekannt';
  const laedt = s.laedt === 'ja' ? ' (lädt)' : s.laedt === 'nein' ? '' : ', Laden unbekannt';
  return `WLAN: ${v(s.wlan)} · Mobile Daten: ${v(s.mobil)} · Bluetooth: ${v(s.bluetooth)} · Nicht stören: ${v(s.nichtStoeren)} · Akku: ${akku}${laedt}`;
}

export const DEVICE_TOOLS = [
  {
    name: 'media_control',
    risk: 'lokal',
    description: 'Steuert die gerade laufende Musik/Video-Wiedergabe (Spotify, YouTube …): pause, weiter, naechster, zurueck.',
    userHint: 'Musik steuern („Pause“, „weiter“, „nächstes Lied“, „zurück“)',
    parameters: obj({ aktion: { type: 'string', enum: MEDIA_ACTIONS, description: 'Aktion' } }, ['aktion']),
    // Nur ganze, kurze Befehle – „Timer pausieren“, „Wecker aus“ usw. bleiben bei ihren Werkzeugen
    localTriggers: [
      { re: /^(?:musik\s+|wiedergabe\s+|song\s+|lied\s+)?(?:pause|pausieren|pausier(?:e)?|anhalten|halt an)(?:\s+(?:die\s+)?(?:musik|wiedergabe))?(?:\s+bitte)?[.!]?$/i, parse: () => ({ aktion: 'pause' }) },
      { re: /^(?:stopp?e?|stop)\s+(?:die\s+)?(?:musik|wiedergabe)[.!]?$/i, parse: () => ({ aktion: 'pause' }) },
      { re: /^(?:musik\s+)?(?:weiter|weiterspielen|weiter abspielen|fortsetzen|play|abspielen)(?:\s+(?:die\s+)?musik)?(?:\s+bitte)?[.!]?$/i, parse: () => ({ aktion: 'weiter' }) },
      { re: /^(?:n(?:ae|ä)chste[sr]?|n(?:ae|ä)chstes)\s+(?:lied|titel|song|track|video)(?:\s+bitte)?[.!]?$|^(?:skip|überspringen|ueberspringen)[.!]?$/i, parse: () => ({ aktion: 'naechster' }) },
      { re: /^(?:zur(?:ue|ü)ck|vorherige[sr]?\s+(?:lied|titel|song|track)|ein(?:en)?\s+(?:lied|titel|song)\s+zur(?:ue|ü)ck|letzte[sr]?\s+(?:lied|titel|song))(?:\s+bitte)?[.!]?$/i, parse: () => ({ aktion: 'zurueck' }) }
    ],
    async execute({ aktion }, ctx) {
      const a = MEDIA_ACTIONS.includes(aktion) ? aktion : null;
      if (!a) return { ok: false, message: 'Das kann ich bei der Musik nicht – nur Pause, weiter, nächster oder zurück.' };
      if (!ctx.device?.mediaKey) return { ok: false, unsupported: true, message: 'Musik steuern geht nur in der Android-App.' };
      const r = await ctx.device.mediaKey(a);
      if (r?.idle) return { ok: true, message: 'Es läuft gerade nichts.' };
      return r?.ok ? { ok: true, message: MEDIA_DONE[a] } : { ok: false, message: r?.message || 'Das hat nicht geklappt.' };
    }
  },
  {
    name: 'get_device_status',
    risk: 'lesen',
    description: 'Liest den Gerätestatus: WLAN verbunden, mobile Daten, Bluetooth an, Nicht stören, Akku und Laden.',
    userHint: 'Gerätestatus („Bin ich im WLAN?“, „Ist Bluetooth an?“)',
    parameters: obj({}),
    localTriggers: [
      { re: /^(?:bin ich (?:im|mit dem) wlan(?: verbunden)?|ist (?:das )?(?:wlan|bluetooth|nicht st(?:oe|ö)ren) an|(?:zeig(?:e)?\s+(?:mir\s+)?(?:den\s+)?)?ger(?:ae|ä)testatus|handystatus|wie ist der status (?:des|meines) (?:handys|ger(?:ae|ä)ts))[?.!]?$/i }
    ],
    async execute(_a, ctx) {
      if (ctx.device?.getDeviceStatus) {
        const s = await ctx.device.getDeviceStatus();
        if (!s?.ok) return { ok: false, message: s?.message || 'Den Gerätestatus konnte ich nicht lesen.' };
        return { ok: true, data: s.status, message: describeStatus(s.status) };
      }
      // Browser: nur Akku und „online“, der Rest ist unbekannt
      const b = ctx.device?.getBattery ? await ctx.device.getBattery() : null;
      const online = typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : null;
      const status = {
        wlan: online === false ? 'nicht verbunden' : 'unbekannt', mobil: 'unbekannt', bluetooth: 'unbekannt', nichtStoeren: 'unbekannt',
        akku: b?.ok ? Math.round(b.level * 100) : 'unbekannt', laedt: b?.ok ? (b.charging ? 'ja' : 'nein') : 'unbekannt'
      };
      return { ok: true, data: status, message: describeStatus(status) };
    }
  },
  {
    name: 'add_calendar_event',
    risk: 'aussen',
    confirms: 'always',
    description: 'Legt einen Kalendereintrag als ENTWURF an: Die Kalender-App öffnet sich vorausgefüllt, der Nutzer speichert dort selbst. ' +
      'start als deutscher Ausdruck („morgen um 15 Uhr“) oder lokal „YYYY-MM-DDTHH:MM“.',
    userHint: 'Termin eintragen („Trag morgen um 15 Uhr Zahnarzt ein“)',
    parameters: obj({ titel: str('Titel'), start: str('Beginn'), ende: str('Ende (optional)'), ort: str('Ort (optional)') }, ['titel', 'start']),
    localTriggers: [
      { re: /^(?:bitte\s+)?(?:trag(?:e)?|schreib(?:e)?)\s+(?:mir\s+)?.+\s+ein[.!]?$/i, parse: (m) => (/\b(?:uhr|morgen|heute|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|\d{1,2}\.\d{1,2}\.|termin|kalender)\b/i.test(m[0]) ? { satz: m[0] } : null) },
      { re: /^(?:neuer\s+|einen\s+)?termin\s+(?:eintragen|anlegen)?\s*:?\s*.+$/i, parse: (m) => ({ satz: m[0] }) }
    ],
    async execute({ titel, start, ende, ort, satz }, ctx) {
      const now = nowOf(ctx);
      let ev;
      if (satz) ev = parseEvent(satz, now);
      else {
        const b = /^\d{4}-\d{2}-\d{2}T/.test(String(start || '')) ? new Date(start) : parseWhen(start, now)?.date;
        const e = ende ? (/^\d{4}-\d{2}-\d{2}T/.test(String(ende)) ? new Date(ende) : parseWhen(ende, now)?.date) : null;
        const t = String(titel || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 120);
        ev = !t ? { needsTitle: true } : !b ? { needsTime: true, title: t }
          : { title: t, begin: b, end: e && e > b ? e : new Date(b.getTime() + 3600000), location: String(ort || '').trim().slice(0, 80) };
      }
      if (ev.invalid) return { ok: false, message: 'Diese Uhrzeit oder dieses Datum gibt es nicht.' };
      if (ev.needsTitle) return { ok: false, message: 'Wie soll der Termin heißen?' };
      if (ev.needsTime) return { ok: false, message: `Wann ist „${ev.title}“? Sagen Sie z. B. „Trag morgen um 15 Uhr ${ev.title} ein“.` };
      if (ev.begin.getTime() < now.getTime() - 60000) return { ok: false, message: `${formatWhen(ev.begin)} ist schon vorbei.` };
      const mins = Math.round((ev.end - ev.begin) / 60000);
      const dur = mins % 60 === 0 ? `${mins / 60} ${mins === 60 ? 'Stunde' : 'Stunden'}` : `${mins} Minuten`;
      const web = !ctx.device?.calendarDraft;
      return {
        ok: true,
        needsConfirm: true,
        message: `Termin „${ev.title}“ am ${formatWhen(ev.begin)} (${dur}) ${web ? 'als Kalenderdatei speichern' : 'in der Kalender-App vorbereiten'}?`,
        confirm: {
          title: `Termin: ${formatWhen(ev.begin)}`,
          detail: `„${ev.title}“, ${dur}${ev.location ? `, ${ev.location}` : ''} – ${web ? '.ics-Datei zum Öffnen im Kalender' : 'Sie speichern in der Kalender-App'}`,
          action: { type: 'calendarDraft', title: ev.title, begin: ev.begin.toISOString(), end: ev.end.toISOString(), location: ev.location || '' }
        }
      };
    }
  },
  {
    name: 'delete_note',
    risk: 'schreiben',
    description: 'Löscht genau eine Notiz (Nummer oder Stichwort). Mit „Rückgängig“ innerhalb von 2 Minuten wiederherstellbar.',
    userHint: 'Notiz löschen („Lösche die Notiz Brot“)',
    parameters: obj({ welche: str('Nummer oder Stichwort') }, ['welche']),
    describe: ({ welche }) => ({ title: 'Notiz löschen?', detail: String(welche || '') }),
    localTriggers: [
      { re: /^(?:l(?:oe|ö)sch|entfern|streich)\w*\s+(?:bitte\s+)?(?:die\s+)?notiz\s+(?:mit\s+|über\s+|ueber\s+|zu\s+)?(.+?)[.!]?$/i, parse: (m) => ({ welche: m[1] }) }
    ],
    async execute({ welche }, ctx) {
      const q = String(welche || '').trim();
      if (!loadNotes(ctx.store).length) return { ok: true, message: 'Es gibt keine Notizen.' };
      const hits = q ? findNotes(ctx.store, q) : [];
      if (!hits.length) return { ok: false, message: `Ich finde keine Notiz zu „${q.slice(0, 40)}“.` };
      if (hits.length > 1) return { ok: false, message: `Mehrere Notizen passen: ${hits.slice(0, 5).map((h) => h.note.text).join('; ')}. Bitte genauer sagen.` };
      const gone = deleteNoteAt(ctx.store, hits[0].index, nowOf(ctx));
      return { ok: true, message: `Notiz „${gone.text}“ gelöscht. Sagen Sie „Rückgängig“, um sie zurückzuholen.` };
    }
  },
  {
    name: 'clear_notes',
    risk: 'schreiben',
    confirms: 'always',
    description: 'Löscht alle Notizen (immer mit Bestätigung).',
    userHint: 'Alle Notizen löschen („Lösche alle Notizen“)',
    parameters: obj({}),
    localTriggers: [
      { re: /^(?:l(?:oe|ö)sch\w*|entfern\w*|vergiss)\s+(?:bitte\s+)?(?:alle\s+(?:meine\s+)?|meine\s+|die\s+)notizen[.!]?$/i }
    ],
    async execute(_a, ctx) {
      const n = loadNotes(ctx.store).length;
      if (!n) return { ok: true, message: 'Es gibt keine Notizen.' };
      if (!ctx.confirmed) {
        return { ok: true, needsConfirm: true, message: `Alle ${n === 1 ? 'eine Notiz' : n + ' Notizen'} löschen? Tippen Sie auf Ja oder sagen Sie „Ja“.`,
          confirm: { title: `Alle ${n} ${n === 1 ? 'Notiz' : 'Notizen'} löschen?`, detail: 'Mit „Rückgängig“ innerhalb von 2 Minuten zurückholbar.', action: { type: 'runTool', name: 'clear_notes', args: {} } } };
      }
      const k = clearNotes(ctx.store, nowOf(ctx));
      return { ok: true, message: `Erledigt, ${k === 1 ? 'eine Notiz' : k + ' Notizen'} gelöscht. Sagen Sie „Rückgängig“, um sie zurückzuholen.` };
    }
  }
];
