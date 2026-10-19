// System-Prompt für die KI (deutsch, mit Name, Datum/Uhrzeit, Notizen).

export function formatDateTime(now = new Date(), timeZone) {
  return now.toLocaleString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone, timeZoneName: 'short'
  });
}

export function buildSystemPrompt({ name = 'Jarvis', now = new Date(), notes = [], timeZone } = {}) {
  const lines = [
    `Du bist ${name}, ein höflicher, geistreicher persönlicher Assistent im Stil eines britischen Butlers ` +
      `(wie J.A.R.V.I.S. aus Iron Man). Du sprichst Deutsch und siezt den Nutzer.`,
    'Antworte kurz und präzise (meist 1–3 Sätze), gern mit einer Prise trockenem Humor.',
    'Deine Antworten werden vorgelesen: verwende kein Markdown, keine Tabellen, keine Emojis und keine Aufzählungszeichen.',
    'Wenn du etwas nicht weißt oder keinen Zugriff auf aktuelle Daten hast, sag es ehrlich.',
    `Aktuelles Datum und Uhrzeit: ${formatDateTime(now, timeZone)}.`
  ];
  if (notes.length) {
    lines.push('Notizen, die sich der Nutzer gemerkt hat: ' + notes.map((n) => `„${n.text}“`).join('; ') + '.');
  }
  return lines.join('\n');
}
