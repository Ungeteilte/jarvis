// v0.9 W4 – Erinnerungen. Jede neue Erinnerung wird vorgelesen und bestätigt
// („Mittwoch, 22.10., 9:00 Uhr – richtig?“); der Text kommt von dir (nach fremden Daten: Karte mit Herkunft).
// Android: @capacitor/local-notifications, Kanal reminder_v1, plant nach Neustart neu (Plugin-Receiver).
// Browser: nur solange Jarvis offen ist; verpasste Erinnerungen meldet die App beim nächsten Öffnen.
import {
  parseWhen, parseReminder, formatWhen, checkWhen, cleanReminderText, addReminder, removeReminder,
  activeReminders, findReminder, MAX_REMINDERS
} from '../../reminders.js';

const str = (d) => ({ type: 'string', description: d });
const obj = (props, required = []) => ({ type: 'object', properties: props, required });
const nowOf = (ctx) => (ctx.now instanceof Date ? ctx.now : new Date());

export const EXACT_HINT = 'Hinweis: Genaue Erinnerungen sind nicht freigegeben – sie kann ein paar Minuten später kommen. ' +
  'In den Einstellungen unter „Werkzeuge & Berechtigungen“ können Sie „Wecker & Erinnerungen“ erlauben.';
export const WEB_HINT = 'Hinweis: Im Browser erinnere ich nur, solange Jarvis offen ist.';

export const REMINDER_TOOLS = [
  {
    name: 'set_reminder',
    risk: 'schreiben',
    confirms: 'always',
    description: 'Stellt eine Erinnerung (Benachrichtigung) zu einem Zeitpunkt. Der Nutzer bestätigt Text und Zeit. ' +
      'zeit als deutscher Ausdruck („morgen um 9“, „in 2 Stunden“, „Freitag 18 Uhr“) oder lokal „YYYY-MM-DDTHH:MM“.',
    userHint: 'Erinnerung („Erinnere mich morgen um 9 an den Müll“)',
    parameters: obj({ text: str('Woran erinnert werden soll, kurz'), zeit: str('Wann') }, ['text', 'zeit']),
    localTriggers: [
      { re: /^(?:bitte\s+)?(?:erinnere?|erinner)\s+mich\b.*$/i, parse: (m) => ({ satz: m[0] }) },
      { re: /^(?:stell(?:e)?\s+(?:mir\s+)?)?(?:eine\s+)?erinnerung\s+(?:für|fuer|um|am|morgen|heute|in)\b.*$/i, parse: (m) => ({ satz: m[0] }) }
    ],
    async execute({ text, zeit, satz, at }, ctx) {
      const now = nowOf(ctx);
      const web = !ctx.device?.reminders;
      // Nach „Ja“ auf der Karte: genau den vorgelesenen Zeitpunkt planen
      if (ctx.confirmed && at) {
        const when = new Date(at);
        const err = checkWhen(when, now);
        if (err) return { ok: false, needsTime: true, reminderText: text, message: err };
        const r = addReminder(ctx.store, { text, at: when, now });
        if (!r.ok) return r;
        let hint = web ? ` ${WEB_HINT}` : '';
        if (!web) {
          const s = await ctx.device.reminders.schedule({ id: r.item.id, text: r.item.text, at: r.item.at });
          if (!s?.ok) {
            removeReminder(ctx.store, r.item.id);
            return { ok: false, message: s?.message || 'Die Erinnerung konnte nicht geplant werden.' };
          }
          if (s.exact === false) hint = ` ${EXACT_HINT}`;
        }
        return { ok: true, message: `Erinnerung gestellt: „${r.item.text}“ – ${formatWhen(when)}.${hint}` };
      }
      // Erst verstehen, dann vorlesen und fragen
      let when = null;
      let what = cleanReminderText(text || '');
      if (satz) {
        const p = parseReminder(satz, now);
        if (p.invalid) return { ok: false, message: p.message };
        when = p.when || null;
        what = p.text || what;
      } else {
        const w = /^\d{4}-\d{2}-\d{2}T/.test(String(zeit || '')) ? { date: new Date(zeit) } : parseWhen(zeit, now);
        if (w?.invalid) return { ok: false, message: 'Diese Uhrzeit oder dieses Datum gibt es nicht.' };
        when = w?.date || null;
      }
      if (!what) return { ok: false, needsText: true, message: 'Woran soll ich Sie erinnern?' };
      if (!when) return { ok: false, needsTime: true, reminderText: what, message: `Wann soll ich Sie an „${what}“ erinnern?` };
      const err = checkWhen(when, now);
      if (err) return { ok: false, needsTime: true, reminderText: what, message: err };
      if (activeReminders(ctx.store, now).length >= MAX_REMINDERS) {
        return { ok: false, message: `Es sind schon ${MAX_REMINDERS} Erinnerungen geplant – mehr gehen nicht. Löschen Sie zuerst eine.` };
      }
      const spoken = formatWhen(when);
      return {
        ok: true,
        needsConfirm: true,
        message: `Erinnerung „${what}“ am ${spoken} – richtig?`,
        confirm: {
          title: `Erinnerung: ${spoken} – richtig?`,
          detail: `„${what}“`,
          action: { type: 'runTool', name: 'set_reminder', args: { text: what, at: when.toISOString() } }
        }
      };
    }
  },
  {
    name: 'list_reminders',
    risk: 'lesen',
    description: 'Listet die geplanten Erinnerungen auf.',
    userHint: 'Erinnerungen anzeigen („Welche Erinnerungen habe ich?“)',
    parameters: obj({}),
    localTriggers: [
      { re: /^(?:welche|zeig(?:e)?\s+(?:mir\s+)?(?:meine|die)|meine)\s+erinnerungen(?:\s+(?:habe|hab)\s+ich)?[?.!]?$/i }
    ],
    async execute(_args, ctx) {
      const list = activeReminders(ctx.store, nowOf(ctx));
      if (!list.length) return { ok: true, message: 'Es sind keine Erinnerungen geplant.' };
      const lines = list.map((r, i) => `${i + 1}. ${formatWhen(new Date(r.at))}: ${r.text}`);
      return { ok: true, message: `${list.length === 1 ? 'Eine Erinnerung' : `${list.length} Erinnerungen`}:\n${lines.join('\n')}` };
    }
  },
  {
    name: 'cancel_reminder',
    risk: 'schreiben',
    description: 'Löscht eine geplante Erinnerung (Nummer aus der Liste oder Stichwort) oder mit welche="alle" alle (mit Bestätigung).',
    userHint: 'Erinnerung löschen („Lösche die Erinnerung an den Müll“)',
    parameters: obj({ welche: str('Nummer, Stichwort oder „alle“') }, ['welche']),
    describe: ({ welche }) => ({ title: /^alle$/i.test(String(welche || '').trim()) ? 'Alle Erinnerungen löschen?' : 'Erinnerung löschen?', detail: String(welche || '') }),
    localTriggers: [
      { re: /^(?:loesch|lösch|entfern|streich)\w*\s+(?:bitte\s+)?(?:die\s+|meine\s+)?(alle\s+)?erinnerung(?:en)?\s*(.*?)[.!]?$/i,
        parse: (m) => ({ welche: m[1] ? 'alle' : (m[2] || '').replace(/^(?:an|ans|für|fuer|zu|nummer)\s+(?:den|die|das|dem)?\s*/i, '').trim() || '' }) }
    ],
    async execute({ welche }, ctx) {
      const now = nowOf(ctx);
      const q = String(welche || '').trim();
      const act = activeReminders(ctx.store, now);
      if (!act.length) return { ok: true, message: 'Es sind keine Erinnerungen geplant.' };
      let hits;
      if (/^alle$/i.test(q)) {
        if (!ctx.confirmed) {
          return { ok: true, needsConfirm: true, message: `Alle ${act.length} Erinnerungen löschen? Tippen Sie auf Ja oder sagen Sie „Ja“.`,
            confirm: { title: `Alle ${act.length} Erinnerungen löschen?`, detail: act.slice(0, 5).map((r) => r.text).join(', '), action: { type: 'runTool', name: 'cancel_reminder', args: { welche: 'alle' } } } };
        }
        hits = act;
      } else {
        if (!q) return { ok: false, message: 'Welche Erinnerung soll ich löschen? Sagen Sie z. B. „Lösche die Erinnerung an den Müll“.' };
        hits = findReminder(ctx.store, q, now);
        if (!hits.length) return { ok: false, message: `Ich finde keine Erinnerung zu „${q.slice(0, 40)}“.` };
        if (hits.length > 1) {
          return { ok: false, message: `Mehrere passen: ${hits.map((r) => `${formatWhen(new Date(r.at))}: ${r.text}`).join('; ')}. Bitte genauer sagen.` };
        }
      }
      for (const r of hits) {
        try { await ctx.device?.reminders?.cancel(r.id); } catch { /* Benachrichtigung evtl. schon weg */ }
        removeReminder(ctx.store, r.id);
      }
      return { ok: true, message: hits.length === 1 ? `Gelöscht: „${hits[0].text}“ (${formatWhen(new Date(hits[0].at))}).` : `${hits.length} Erinnerungen gelöscht.` };
    }
  }
];
