// Alle Handy-Werkzeuge. Jedes ruft nur über ctx.device Plattformfunktionen auf.
import { phoneDigits, stripQuotes, after } from './triggers.js';
import { formatDuration, parseDuration, loadNotes } from '../skills.js';

const str = (d) => ({ type: 'string', description: d });
const obj = (props, required = []) => ({ type: 'object', properties: props, required });

function confirm(title, detail, action) {
  return { ok: true, needsConfirm: true, message: `${title} Tippen Sie auf Ja, um fortzufahren.`, confirm: { title, detail, action } };
}
function unsupported(feature) {
  return {
    ok: false,
    unsupported: true,
    message: `Verzeihung, ${feature} steht in der Web-App leider nicht zur Verfügung. Das kommt mit der späteren Android-App.`
  };
}

export const TOOL_DEFINITIONS = [
  // ---------- Anrufen ----------
  {
    name: 'call_phone',
    description: 'Ruft eine Telefonnummer an (öffnet die Telefon-App).',
    userHint: 'Anrufen („Ruf die 0176… an“)',
    parameters: obj({ number: str('Telefonnummer, z. B. +491701234567 oder 01701234567') }, ['number']),
    localTriggers: [
      { re: /(?:ruf|rufe|anrufen|telefonier(?:e)?)\s+(?:bitte\s+)?(?:die\s+|den\s+|nummer\s+)?([+\d][\d\s/\-()]{5,})/i,
        parse: (m) => ({ number: phoneDigits(m[1]) }) },
      { re: /(?:ruf|rufe|anrufen)\s+(?:bitte\s+)?(.+?)\s+an\b/i,
        parse: (m) => { const n = phoneDigits(m[1]); return n.length >= 6 ? { number: n } : null; } }
    ],
    async execute({ number }, ctx) {
      const n = phoneDigits(number);
      if (n.length < 6) return { ok: false, message: 'Das sieht nicht nach einer gültigen Telefonnummer aus.' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('Telefonate');
      return confirm(`Nummer ${n} anrufen?`, n, { type: 'openUrl', url: `tel:${n}` });
    }
  },

  // ---------- SMS ----------
  {
    name: 'send_sms',
    description: 'Öffnet die SMS-App mit Empfänger und optionalem Text.',
    userHint: 'SMS schreiben („Schreib eine SMS an 0176…: Hallo“)',
    parameters: obj({ number: str('Telefonnummer'), body: str('Nachrichtentext') }, ['number']),
    localTriggers: [
      { re: /(?:schreib(?:e)?|sende?|schicke?)\s+(?:bitte\s+)?(?:eine?\s+)?(?:sms|kurz(?:e)?nachricht)\s+(?:an\s+)?([+\d][\d\s/\-()]{5,})\s*[:\-]?\s*(.*)$/i,
        parse: (m) => ({ number: phoneDigits(m[1]), body: stripQuotes(m[2] || '') }) }
    ],
    async execute({ number, body = '' }, ctx) {
      const n = phoneDigits(number);
      if (n.length < 6) return { ok: false, message: 'Das sieht nicht nach einer gültigen Telefonnummer aus.' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('SMS');
      const url = `sms:${n}${body ? `?body=${encodeURIComponent(body)}` : ''}`;
      return confirm(`SMS an ${n} öffnen?`, body || '(ohne Text)', { type: 'openUrl', url });
    }
  },

  // ---------- WhatsApp ----------
  {
    name: 'send_whatsapp',
    description: 'Öffnet WhatsApp mit einer Nummer (international, ohne +) und optionalem Text.',
    userHint: 'WhatsApp („WhatsApp an 49176…: Hallo“)',
    parameters: obj({ number: str('Internationale Nummer ohne +, z. B. 491701234567'), body: str('Nachricht') }, ['number']),
    localTriggers: [
      { re: /whats\s*app\s+(?:an\s+)?([+\d][\d\s/\-()]{5,})\s*[:\-]?\s*(.*)$/i,
        parse: (m) => ({ number: phoneDigits(m[1]).replace(/^\+/, ''), body: stripQuotes(m[2] || '') }) }
    ],
    async execute({ number, body = '' }, ctx) {
      let n = phoneDigits(number).replace(/^\+/, '');
      if (n.startsWith('0') && n.length >= 10) n = '49' + n.slice(1); // DE-Vorwahl raten
      if (n.length < 8) return { ok: false, message: 'Bitte eine gültige internationale Nummer angeben (z. B. 49170…).' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('WhatsApp');
      const url = `https://wa.me/${n}${body ? `?text=${encodeURIComponent(body)}` : ''}`;
      return confirm(`WhatsApp an +${n} öffnen?`, body || '(ohne Text)', { type: 'openUrl', url });
    }
  },

  // ---------- E-Mail ----------
  {
    name: 'send_email',
    description: 'Öffnet die E-Mail-App mit Empfänger, Betreff und Text.',
    userHint: 'E-Mail („Schreib eine Mail an max@example.com“)',
    parameters: obj({
      to: str('E-Mail-Adresse'),
      subject: str('Betreff'),
      body: str('Nachrichtentext')
    }, ['to']),
    localTriggers: [
      { re: /(?:schreib(?:e)?|sende?)\s+(?:bitte\s+)?(?:eine?\s+)?(?:e-?mail|mail)\s+(?:an\s+)?([^\s]+@[^\s]+)\s*(?:mit\s+betreff\s+(.+?))?(?:\s*[:\-]\s*(.*))?$/i,
        parse: (m) => ({ to: m[1], subject: stripQuotes(m[2] || ''), body: stripQuotes(m[3] || '') }) }
    ],
    async execute({ to, subject = '', body = '' }, ctx) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to || '')) return { ok: false, message: 'Das ist keine gültige E-Mail-Adresse.' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('E-Mail');
      const q = new URLSearchParams();
      if (subject) q.set('subject', subject);
      if (body) q.set('body', body);
      const qs = q.toString();
      return confirm(`E-Mail an ${to} öffnen?`, subject || body || to, { type: 'openUrl', url: `mailto:${to}${qs ? `?${qs}` : ''}` });
    }
  },

  // ---------- Navigation ----------
  {
    name: 'navigate',
    description: 'Öffnet Google Maps zur Navigation oder Suche eines Ortes.',
    userHint: 'Navigation („Navigiere zum Hauptbahnhof“ / „Zeig mir Berlin auf der Karte“)',
    parameters: obj({ query: str('Ort oder Adresse'), mode: str('driving, walking, transit oder search') }, ['query']),
    localTriggers: [
      { re: /(?:navigier(?:e)?|fahr(?:e)?|bring mich)\s+(?:bitte\s+)?(?:nach|zu|zum|zur)\s+(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]).replace(/[.!?]+$/, ''), mode: 'driving' }) },
      { re: /(?:zeig(?:e)?|suche)\s+(?:bitte\s+)?(?:mir\s+)?(.+?)\s+(?:auf\s+der\s+karte|in\s+(?:google\s+)?maps)/i,
        parse: (m) => ({ query: stripQuotes(m[1]), mode: 'search' }) },
      { re: /(?:google\s+)?maps\s*[:\-]?\s*(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]), mode: 'search' }) }
    ],
    async execute({ query, mode = 'driving' }, ctx) {
      const q = String(query || '').trim();
      if (!q) return { ok: false, message: 'Wohin soll ich navigieren?' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('Karten');
      const enc = encodeURIComponent(q);
      const url = mode === 'search'
        ? `https://www.google.com/maps/search/?api=1&query=${enc}`
        : `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=${encodeURIComponent(mode || 'driving')}`;
      return confirm(`Karte für „${q}“ öffnen?`, mode === 'search' ? 'Suche' : 'Navigation', { type: 'openUrl', url });
    }
  },

  // ---------- YouTube ----------
  {
    name: 'open_youtube',
    description: 'Öffnet YouTube mit einer Suche oder einem Kanal.',
    userHint: 'YouTube („Such auf YouTube nach …“)',
    parameters: obj({ query: str('Suchbegriff') }, ['query']),
    localTriggers: [
      { re: /(?:such(?:e)?|spiel(?:e)?|oeffne|öffne)\s+(?:bitte\s+)?(?:auf\s+)?youtube\s+(?:nach\s+|fuer\s+|für\s+)?(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]).replace(/[.!?]+$/, '') }) },
      { re: /youtube\s*[:\-]?\s*(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]).replace(/[.!?]+$/, '') }) }
    ],
    async execute({ query }, ctx) {
      const q = String(query || '').trim();
      if (!q) return { ok: false, message: 'Wonach soll ich auf YouTube suchen?' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('YouTube');
      return confirm(`YouTube: „${q}“?`, 'Suche öffnen', { type: 'openUrl', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` });
    }
  },

  // ---------- Spotify ----------
  {
    name: 'open_spotify',
    description: 'Öffnet Spotify mit einer Suche (Titel, Artist, Playlist).',
    userHint: 'Spotify („Spiel auf Spotify …“ / „Such auf Spotify nach …“)',
    parameters: obj({ query: str('Suchbegriff') }, ['query']),
    localTriggers: [
      { re: /(?:spiel(?:e)?|such(?:e)?|oeffne|öffne)\s+(?:bitte\s+)?(?:auf\s+)?spotify\s+(?:nach\s+|fuer\s+|für\s+)?(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]).replace(/[.!?]+$/, '') }) },
      { re: /spotify\s*[:\-]?\s*(.+)$/i,
        parse: (m) => ({ query: stripQuotes(m[1]).replace(/[.!?]+$/, '') }) }
    ],
    async execute({ query }, ctx) {
      const q = String(query || '').trim();
      if (!q) return { ok: false, message: 'Wonach soll ich auf Spotify suchen?' };
      if (!ctx.device?.canOpenUrl?.()) return unsupported('Spotify');
      return confirm(`Spotify: „${q}“?`, 'Suche öffnen', { type: 'openUrl', url: `https://open.spotify.com/search/${encodeURIComponent(q)}` });
    }
  },

  // ---------- Website ----------
  {
    name: 'open_website',
    description: 'Öffnet eine Website im Browser.',
    userHint: 'Website öffnen („Öffne wikipedia.org“)',
    parameters: obj({ url: str('URL oder Domain, z. B. https://example.com oder example.com') }, ['url']),
    localTriggers: [
      { re: /(?:oeffne|öffne|gehe?\s+(?:bitte\s+)?(?:zu|auf)|besuch(?:e)?)\s+(?:bitte\s+)?(?:die\s+(?:seite|website)\s+)?((?:https?:\/\/)?(?:www\.)?[a-z0-9\-]+(?:\.[a-z0-9\-]+)+(?:\/\S*)?)/i,
        parse: (m) => ({ url: m[1] }) }
    ],
    async execute({ url }, ctx) {
      let u = String(url || '').trim();
      if (!u) return { ok: false, message: 'Welche Website soll ich öffnen?' };
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      try { new URL(u); } catch { return { ok: false, message: 'Das ist keine gültige Adresse.' }; }
      if (!ctx.device?.canOpenUrl?.()) return unsupported('Websites');
      return confirm(`Website öffnen?`, u, { type: 'openUrl', url: u });
    }
  },

  // ---------- Teilen ----------
  {
    name: 'share_text',
    description: 'Öffnet den System-Teilen-Dialog mit einem Text.',
    userHint: 'Text teilen („Teile den Text: …“)',
    parameters: obj({ text: str('Zu teilender Text'), title: str('Optionaler Titel') }, ['text']),
    localTriggers: [
      { re: /(?:teil(?:e)?|share)\s+(?:bitte\s+)?(?:den\s+text\s+)?[:\-]?\s*(.+)$/i,
        parse: (m) => ({ text: stripQuotes(m[1]) }) }
    ],
    async execute({ text, title = '' }, ctx) {
      const t = String(text || '').trim();
      if (!t) return { ok: false, message: 'Was soll ich teilen?' };
      if (!ctx.device?.canShare?.()) {
        // Fallback: in Zwischenablage
        if (ctx.device?.copyText) {
          const r = await ctx.device.copyText(t);
          return r.ok
            ? { ok: true, message: 'Teilen geht hier nicht – ich habe den Text in die Zwischenablage gelegt.' }
            : unsupported('Teilen');
        }
        return unsupported('Teilen');
      }
      const r = await ctx.device.share({ text: t, title });
      return r.ok
        ? { ok: true, message: 'Teilen-Dialog geöffnet.' }
        : { ok: false, message: r.message || 'Teilen wurde abgebrochen.' };
    }
  },

  // ---------- Vibration ----------
  {
    name: 'vibrate',
    description: 'Lässt das Gerät kurz vibrieren.',
    userHint: 'Vibrieren („Vibriere kurz“)',
    parameters: obj({ pattern: str('Optional: "short", "long" oder ms-Zahl') }),
    localTriggers: [
      { re: /^(?:vibrier(?:e)?|vibration|lass\s+(?:das\s+)?(?:handy|geraet|gerät)\s+vibrieren)(?:\s+(kurz|lang|lange))?[.!?]?$/i,
        parse: (m) => ({ pattern: (m[1] || 'short').toLowerCase().startsWith('lang') ? 'long' : 'short' }) }
    ],
    async execute({ pattern = 'short' }, ctx) {
      if (!ctx.device?.vibrate) return unsupported('Vibration');
      const map = { short: [200], long: [600], kurz: [200], lang: [600] };
      const p = map[String(pattern).toLowerCase()] || (/^\d+$/.test(pattern) ? [Math.min(2000, +pattern)] : [200]);
      const r = await ctx.device.vibrate(p);
      return r.ok
        ? { ok: true, message: 'Sehr wohl – einmal vibriert.' }
        : { ok: false, message: r.message || 'Vibration wird von diesem Gerät nicht unterstützt.' };
    }
  },

  // ---------- Akku ----------
  {
    name: 'get_battery',
    description: 'Liest den aktuellen Akkustand aus.',
    userHint: 'Akkustand („Wie voll ist der Akku?“)',
    parameters: obj({}),
    localTriggers: [
      { re: /(?:wie\s+(?:voll|leer)|akkustand|batterie(?:stand)?|wie\s+viel\s+(?:prozent\s+)?(?:hat\s+)?(?:der\s+)?akku|ladezustand)/i,
        parse: () => ({}) }
    ],
    async execute(_args, ctx) {
      if (!ctx.device?.getBattery) return unsupported('die Akku-Anzeige');
      const r = await ctx.device.getBattery();
      if (!r.ok) return { ok: false, message: r.message || 'Akkustand ist hier nicht lesbar.' };
      const pct = Math.round(r.level * 100);
      const charge = r.charging ? ' und wird gerade geladen' : '';
      return { ok: true, message: `Der Akku ist zu ${pct} Prozent geladen${charge}.`, data: r };
    }
  },

  // ---------- Standort ----------
  {
    name: 'get_location',
    description: 'Ermittelt den aktuellen Standort (GPS) und optional eine Karten-URL.',
    userHint: 'Standort („Wo bin ich?“)',
    parameters: obj({}),
    localTriggers: [
      { re: /(?:wo\s+bin\s+ich|mein\s+(?:standort|ort|gps)|aktuelle(?:r|n)?\s+standort|wo\s+sind\s+wir)/i,
        parse: () => ({}) }
    ],
    async execute(_args, ctx) {
      if (!ctx.device?.getLocation) return unsupported('Standort');
      const r = await ctx.device.getLocation();
      if (!r.ok) return { ok: false, message: r.message || 'Standort konnte nicht ermittelt werden.' };
      const { latitude: lat, longitude: lon, accuracy } = r;
      const maps = `https://www.google.com/maps?q=${lat},${lon}`;
      const acc = accuracy ? ` (Genauigkeit ca. ${Math.round(accuracy)} Meter)` : '';
      return {
        ok: true,
        message: `Sie befinden sich ungefähr bei ${lat.toFixed(5)}, ${lon.toFixed(5)}${acc}. Ich kann die Karte öffnen, wenn Sie möchten.`,
        data: { lat, lon, accuracy, mapsUrl: maps },
        needsConfirm: true,
        confirm: { title: 'Standort auf der Karte zeigen?', detail: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, action: { type: 'openUrl', url: maps } }
      };
    }
  },

  // ---------- Zwischenablage ----------
  {
    name: 'copy_to_clipboard',
    description: 'Kopiert einen Text in die Zwischenablage.',
    userHint: 'Zwischenablage („Kopiere …“)',
    parameters: obj({ text: str('Zu kopierender Text') }, ['text']),
    localTriggers: [
      { re: /(?:kopier(?:e)?|clipboard)\s+(?:bitte\s+)?(?:den\s+text\s+)?[:\-]?\s*(.+)$/i,
        parse: (m) => ({ text: stripQuotes(m[1]) }) }
    ],
    async execute({ text }, ctx) {
      const t = String(text || '').trim();
      if (!t) return { ok: false, message: 'Was soll ich kopieren?' };
      if (!ctx.device?.copyText) return unsupported('die Zwischenablage');
      const r = await ctx.device.copyText(t);
      return r.ok
        ? { ok: true, message: 'In die Zwischenablage kopiert.' }
        : { ok: false, message: r.message || 'Kopieren nicht möglich.' };
    }
  },

  // ---------- Taschenlampe ----------
  {
    name: 'set_flashlight',
    description: 'Schaltet die Taschenlampe (Kamera-Blitz) ein oder aus, falls unterstützt.',
    userHint: 'Taschenlampe („Taschenlampe an/aus“) – nur falls der Browser es erlaubt',
    parameters: obj({ on: { type: 'boolean', description: 'true = an, false = aus' } }, ['on']),
    localTriggers: [
      { re: /(?:taschenlampe|blitzlicht|licht)\s+(an|ein|aus|abschalten)/i,
        parse: (m) => ({ on: /an|ein/i.test(m[1]) }) },
      { re: /(?:mach(?:e)?|schalt(?:e)?)\s+(?:bitte\s+)?(?:die\s+)?(?:taschenlampe|blitzlicht|licht)\s+(an|ein|aus)/i,
        parse: (m) => ({ on: /an|ein/i.test(m[1]) }) }
    ],
    async execute({ on }, ctx) {
      if (!ctx.device?.setFlashlight) return unsupported('die Taschenlampe');
      const r = await ctx.device.setFlashlight(Boolean(on));
      if (r.unsupported) return unsupported('die Taschenlampe');
      return r.ok
        ? { ok: true, message: on ? 'Taschenlampe ist an.' : 'Taschenlampe ist aus.' }
        : { ok: false, message: r.message || 'Taschenlampe konnte nicht geschaltet werden.' };
    }
  },

  // ---------- Timer (auch als Tool für die KI) ----------
  {
    name: 'set_timer',
    description: 'Stellt einen Timer. Dauer als Text, z. B. „5 Minuten“ oder „1 Stunde 30 Minuten“.',
    userHint: 'Timer („Stell einen Timer auf 5 Minuten“)',
    parameters: obj({ duration: str('Dauer auf Deutsch, z. B. 5 Minuten') }, ['duration']),
    // Keine localTriggers hier – die Skills bleiben der schnelle Pfad ohne Doppelung
    async execute({ duration }, ctx) {
      const ms = parseDuration(String(duration));
      if (!ms) return { ok: false, message: 'Wie lange soll der Timer laufen? Zum Beispiel: 5 Minuten.' };
      if (ms > 24 * 3600000) return { ok: false, message: 'Mehr als 24 Stunden kann ich leider nicht stoppen.' };
      ctx.timers.start(ms, formatDuration(ms));
      return { ok: true, message: `Timer auf ${formatDuration(ms)} gestellt.` };
    }
  },
  {
    name: 'cancel_timers',
    description: 'Stoppt alle laufenden Timer.',
    userHint: 'Timer stoppen',
    parameters: obj({}),
    async execute(_a, ctx) {
      const n = ctx.timers.cancelAll();
      return { ok: true, message: n ? `${n === 1 ? 'Der Timer wurde' : n + ' Timer wurden'} gestoppt.` : 'Es läuft derzeit kein Timer.' };
    }
  },

  // ---------- Notizen (für die KI) ----------
  {
    name: 'add_note',
    description: 'Merkt sich eine kurze Notiz für den Nutzer.',
    userHint: 'Notizen („Merke dir …“)',
    parameters: obj({ text: str('Notiztext') }, ['text']),
    async execute({ text }, ctx) {
      const note = String(text || '').trim();
      if (!note) return { ok: false, message: 'Was soll ich mir merken?' };
      const notes = loadNotes(ctx.store);
      notes.push({ text: note, at: (ctx.now || new Date()).toISOString() });
      ctx.store.set('notes', notes);
      return { ok: true, message: `Sehr wohl, ich habe mir notiert: ${note}.` };
    }
  },
  {
    name: 'list_notes',
    description: 'Listet alle gespeicherten Notizen.',
    userHint: 'Notizen abfragen („Was habe ich mir gemerkt?“)',
    parameters: obj({}),
    async execute(_a, ctx) {
      const notes = loadNotes(ctx.store);
      if (!notes.length) return { ok: true, message: 'Ich habe mir bisher nichts gemerkt.' };
      return { ok: true, message: `Sie haben mir ${notes.length === 1 ? 'eine Sache' : notes.length + ' Dinge'} anvertraut: ` + notes.map((n) => n.text).join('; ') + '.' };
    }
  },

  // ---------- Hilfe ----------
  {
    name: 'list_capabilities',
    description: 'Listet alle Fähigkeiten und Werkzeuge von Jarvis.',
    userHint: 'Hilfe („Was kannst du?“)',
    parameters: obj({}),
    // Trigger bleibt in skills.js; Tool ist für die KI
    async execute(_a, ctx) {
      const name = ctx.name || 'Jarvis';
      const lines = (ctx.registry?.helpLines?.() || []).join('; ');
      return {
        ok: true,
        message: `Ich bin ${name}. Ich kann: ${lines}. ` +
          'Aktionen wie Anrufen, SMS, WhatsApp und E-Mail fragen vorher nach. ' +
          'Manche Funktionen (z. B. Taschenlampe) brauchen ggf. die spätere Android-App, falls der Browser sie nicht erlaubt.'
      };
    }
  }
];
