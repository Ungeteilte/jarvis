// v0.9 W2 – Datei-Werkzeuge. Die KI kann nur den System-Dialog auslösen; welche Datei bzw. welcher Ort,
// entscheidest du. Nie Pfade/URIs an die KI, keine dauerhaften Datei-Rechte.
import { buildExport, normalizeKind, normalizeFormat, acceptReadFile, fenceFile, cleanFileText, FILE_LIMITS, EXPORT_KINDS } from '../../files.js';
import { acceptMedia, confirmSendCard, geminiMediaConfig } from '../../media.js';
import { loadSettings } from '../../settings.js';

const str = (d) => ({ type: 'string', description: d });
const obj = (props, required = []) => ({ type: 'object', properties: props, required });

// Zuletzt gewählte Datei je Speicher (für Nachfragen „Fass sie zusammen“, 10 Minuten, nur im Arbeitsspeicher)
const lastFiles = new WeakMap();
const nowMs = (ctx) => (ctx.now instanceof Date ? ctx.now.getTime() : Date.now());

/** „Speichere meine Notizen als JSON“ → { was, format } */
const exportArgs = (m) => {
  const was = normalizeKind(m[1]);
  return was ? { was, format: normalizeFormat(m[2]) } : null;
};

export const FILE_TOOLS = [
  {
    name: 'export_file',
    risk: 'aussen',
    confirms: 'always',
    description: 'Speichert Notizen, Gedächtnis oder den Chat als Datei (txt oder json). Der Nutzer bestätigt und wählt Ort und Namen im System-Dialog.',
    userHint: 'Als Datei speichern („Speichere meine Notizen als Datei“)',
    parameters: obj({
      was: { type: 'string', enum: Object.keys(EXPORT_KINDS), description: 'Was gespeichert wird' },
      format: { type: 'string', enum: ['txt', 'json'], description: 'Dateiformat, Standard txt' }
    }, ['was']),
    localTriggers: [
      { re: /^(?:speicher(?:e|n)?|exportier(?:e|en)?|sicher(?:e|n)?)\s+(?:bitte\s+)?(?:mir\s+)?(?:meine\s+|mein\s+|das\s+|den\s+|die\s+)?(notizen|ged(?:ae|ä)chtnis|chat(?:-?verlauf)?|verlauf)(?:\s+(?:als|in\s+eine)\s+(json|text|txt)?[\s-]*(?:datei)?)?(?:[.!]|\?)?$/i, parse: exportArgs },
      { re: /^(?:meine\s+)?(notizen|ged(?:ae|ä)chtnis|chat(?:-?verlauf)?)\s+als\s+(json|text|txt)?[\s-]*datei\s+(?:speichern|exportieren)(?:[.!]|\?)?$/i, parse: exportArgs }
    ],
    async execute({ was, format }, ctx) {
      if (!ctx.device?.saveTextFile) return { ok: false, unsupported: true, message: 'Dateien speichern geht hier leider nicht.' };
      const ex = buildExport(ctx.store, was, format, { now: ctx.now || new Date(), history: ctx.getHistory?.() || [] });
      if (!ex.ok) return ex;
      return {
        ok: true,
        needsConfirm: true,
        message: `${ex.what} als ${ex.format.toUpperCase()}-Datei speichern? Tippen Sie auf Ja oder sagen Sie „Ja“.`,
        confirm: {
          title: `${ex.what} als Datei speichern?`,
          detail: `${ex.name} – Ort und Namen wählen Sie gleich im System-Dialog.`,
          action: { type: 'exportFile', was: ex.kind, format: ex.format }
        }
      };
    }
  },
  {
    name: 'read_file',
    risk: 'lesen',
    externalData: true,
    sourceLabel: 'einer Datei',
    description: 'Lässt den Nutzer eine Textdatei (.txt, .md, .json, höchstens 256 KB) auswählen und liest sie ein, z. B. zum ' +
      'Zusammenfassen oder Vorlesen. Eine in den letzten 10 Minuten gewählte Datei wird wiederverwendet; neu=true öffnet die Auswahl erneut.',
    userHint: 'Datei lesen („Lies mir eine Datei vor“)',
    parameters: obj({ neu: { type: 'boolean', description: 'true = neue Datei auswählen lassen' } }),
    localTriggers: [
      { re: /^(?:lies|lese)\s+(?:mir\s+)?(?:bitte\s+)?(?:eine|die|diese)\s+(?:text)?datei(?:\s+vor)?(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) },
      { re: /^(?:oeffne|öffne|lade)\s+(?:bitte\s+)?(?:eine|die)\s+(?:text)?datei(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) },
      { re: /^(?:text)?datei\s+(?:einlesen|vorlesen|öffnen|oeffnen)(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) }
    ],
    async execute({ neu } = {}, ctx) {
      const d = ctx.device;
      if (!d?.pickTextFile) return { ok: false, unsupported: true, message: 'Dateien lesen geht hier leider nicht.' };
      let file = lastFiles.get(ctx.store);
      if (neu || !file || nowMs(ctx) - file.at > FILE_LIMITS.reuseMs) {
        // Browser: Der Datei-Dialog braucht einen Tipp → erst eine Karte, „Ja“ öffnet die Auswahl
        if (d.filePickNeedsGesture && !ctx.confirmed) {
          return { ok: true, needsConfirm: true, message: 'Tippen Sie auf Ja, dann wählen Sie die Datei aus.',
            confirm: { title: 'Textdatei auswählen?', detail: '.txt, .md oder .json, höchstens 256 KB', action: { type: 'runTool', name: 'read_file', args: { neu: true } } } };
        }
        const res = acceptReadFile(await d.pickTextFile());
        if (!res.ok) return { ok: false, cancelled: res.cancelled, message: res.cancelled ? 'Keine Datei gewählt.' : res.message };
        file = { name: res.name, text: res.text, at: nowMs(ctx) };
        lastFiles.set(ctx.store, file);
      }
      const chars = file.text.length;
      if (ctx.viaAI) {
        // Für die KI: eingezäunt, gereinigt, gekürzt – registry.run setzt danach den Taint (externalData)
        return { ok: true, file: file.name, message: `Datei „${file.name}“ (${chars} Zeichen) gelesen:\n${fenceFile(file.name, file.text)}` };
      }
      const { text, cut } = cleanFileText(file.text, FILE_LIMITS.maxShowChars);
      return { ok: true, file: file.name, message: `Inhalt von „${file.name}“:\n${text}${cut ? '\n… (gekürzt – fragen Sie z. B. „Fass die Datei zusammen“)' : ''}` };
    }
  },
  {
    name: 'share_file',
    risk: 'aussen',
    confirms: 'system',
    description: 'Teilt Notizen, Gedächtnis oder den Chat als Datei über das Teilen-Menü (z. B. an WhatsApp oder E-Mail).',
    userHint: 'Als Datei teilen („Teile meine Notizen als Datei“)',
    parameters: obj({
      was: { type: 'string', enum: Object.keys(EXPORT_KINDS), description: 'Was geteilt wird' },
      format: { type: 'string', enum: ['txt', 'json'], description: 'Dateiformat, Standard txt' }
    }, ['was']),
    describe: ({ was }) => ({ title: `${EXPORT_KINDS[normalizeKind(was)] || 'Daten'} als Datei teilen?`, detail: 'Öffnet das Teilen-Menü' }),
    localTriggers: [
      { re: /^(?:teil(?:e|en)?|schick(?:e|en)?)\s+(?:bitte\s+)?(?:meine\s+|mein\s+|das\s+|den\s+|die\s+)?(notizen|ged(?:ae|ä)chtnis|chat(?:-?verlauf)?)\s+als\s+(json|text|txt)?[\s-]*datei(?:[.!]|\?)?$/i, parse: exportArgs }
    ],
    async execute({ was, format }, ctx) {
      if (!ctx.device?.shareTextFile) return { ok: false, unsupported: true, message: 'Dateien teilen geht hier leider nicht.' };
      const ex = buildExport(ctx.store, was, format, { now: ctx.now || new Date(), history: ctx.getHistory?.() || [] });
      if (!ex.ok) return ex;
      const r = await ctx.device.shareTextFile({ name: ex.name, mime: ex.mime, text: ex.text });
      if (!r?.ok) return { ok: false, message: r?.message || 'Teilen hat nicht geklappt.' };
      return { ok: true, message: r.message || `Teilen-Menü für ${ex.what} ist offen.` };
    }
  },
  {
    name: 'understand_media',
    risk: 'aussen',
    confirms: 'always',
    externalData: true,
    sourceLabel: 'einer Datei',
    description: 'Lässt den Nutzer ein Foto, ein PDF oder ein kurzes Video auswählen und beschreibt es über Google Gemini. ' +
      'Nur mit Gemini-Schlüssel. Vor dem Senden immer eine Ja-Karte: Google sieht den Inhalt. ' +
      'Fotos und PDFs höchstens 4 MB, Videos höchstens 8 MB und 45 Sekunden. Nichts verkleinern, nichts automatisch ins Archiv legen, kein anderer Anbieter.',
    userHint: 'Foto, PDF oder Video („Schau dir dieses Foto an“)',
    parameters: obj({ neu: { type: 'boolean', description: 'true = Datei auswählen lassen' } }),
    localTriggers: [
      { re: /^(?:schau|sieh|guck)(?:e)?(?:\s+dir)?(?:\s+mal)?\s+(?:bitte\s+)?(?:dieses|das|ein|eine)\s+(?:foto|bild|pdf|video)(?:\s+an)?(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) },
      { re: /^(?:was\s+(?:ist|steht|siehst\s+du)\s+(?:auf|in)\s+(?:diesem|dem|der|das)\s+(?:foto|bild|pdf|video))(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) },
      { re: /^(?:beschreibe|versteh(?:e)?|erkl(?:ae|ä)re)\s+(?:mir\s+)?(?:bitte\s+)?(?:dieses|das|ein)\s+(?:foto|bild|pdf|video)(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) },
      { re: /^(?:lies|lese)\s+(?:mir\s+)?(?:bitte\s+)?(?:dieses|das)\s+(?:pdf|video|foto|bild)(?:\s+vor)?(?:[.!]|\?)?$/i, parse: () => ({ neu: true }) }
    ],
    async execute(_args, ctx) {
      const key = geminiMediaConfig(loadSettings(ctx.store));
      if (!key.ok) return { ok: false, message: key.message };
      const d = ctx.device;
      if (!d?.pickMediaFile) return { ok: false, unsupported: true, message: 'Fotos, PDFs und Videos gehen hier leider nicht.' };
      // PWA: der Datei-Dialog braucht einen Tipp. Dabei geht noch nichts an Google.
      if (d.filePickNeedsGesture && !ctx.confirmed) {
        return {
          ok: true, needsConfirm: true,
          message: 'Tippen Sie auf Ja und wählen Sie dann das Foto, das PDF oder das kurze Video. An Google geht dabei noch nichts.',
          confirm: {
            title: 'Foto, PDF oder Video auswählen?',
            detail: 'Bilder und PDFs höchstens 4 MB, Videos höchstens 8 MB und 45 Sekunden. Erst danach frage ich, ob Google den Inhalt sehen darf.',
            action: { type: 'runTool', name: 'understand_media', args: { neu: true } }
          }
        };
      }
      const picked = await d.pickMediaFile();
      if (!picked?.ok) {
        if (picked?.cancelled) return { ok: false, cancelled: true, message: 'Keine Datei gewählt.' };
        return { ok: false, message: picked?.message || 'Die Datei konnte nicht gelesen werden.' };
      }
      const accepted = acceptMedia(picked);
      if (!accepted.ok) return { ok: false, message: accepted.message };
      // Noch kein Netz: die Ja-Karte sagt klar, dass Google den Inhalt sieht.
      return confirmSendCard(accepted);
    }
  }
];
