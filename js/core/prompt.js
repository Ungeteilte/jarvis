// System-Prompt für die KI (deutsch, mit Name, Datum/Uhrzeit, Notizen).

export function formatDateTime(now = new Date(), timeZone) {
  return now.toLocaleString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short'
  });
}

export function buildSystemPrompt({ name = 'Jarvis', now = new Date(), notes = [], timeZone, tools = [] } = {}) {
  const lines = [
    `Du bist ${name}, ein höflicher, geistreicher persönlicher Assistent im Stil eines britischen Butlers ` +
      `(wie J.A.R.V.I.S. aus Iron Man). Du sprichst Deutsch und siezt den Nutzer.`,
    'Antworte kurz und präzise (meist 1–3 Sätze), gern mit einer Prise trockenem Humor.',
    'Deine Antworten werden vorgelesen: verwende kein Markdown, keine Tabellen, keine Emojis und keine Aufzählungszeichen.',
    'Wenn du etwas nicht weißt oder keinen Zugriff auf aktuelle Daten hast, sag es ehrlich.',
    'Du hast Werkzeuge für Handy-Steuerung. Nutze sie, wenn der Nutzer das möchte ' +
      '(Anrufen, SMS, WhatsApp, E-Mail, Navigation, YouTube, Spotify, Website, Teilen, Vibration, Akku, Standort, Zwischenablage, Taschenlampe, Timer, Notizen).',
    'Erfinde keine Werkzeug-Ergebnisse. Wenn ein Werkzeug eine Bestätigung verlangt, erkläre kurz, dass der Nutzer auf Ja tippen muss.',
    `Aktuelles Datum und Uhrzeit: ${formatDateTime(now, timeZone)}.`
  ];
  if (tools.length) {
    lines.push('Verfügbare Fähigkeiten: ' + tools.join('; ') + '.');
  }
  if (notes.length) {
    lines.push('Notizen, die sich der Nutzer gemerkt hat: ' + notes.map((n) => `„${n.text}“`).join('; ') + '.');
  }
  return lines.join('\n');
}
