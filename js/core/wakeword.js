// Wake-Word-Erkennung (reine Textlogik). Erkennt "Hey <Name>", "Hallo <Name>"
// oder nur "<Name>" – tolerant gegenüber Groß-/Kleinschreibung, Umlauten und
// typischen Fehlern der Spracherkennung (z. B. "Jarwis", "Dschawis").

const GREETINGS = new Set(['hey', 'hei', 'hej', 'he', 'hallo', 'hi', 'ok', 'okay', 'oke', 'hay', 'ey']);

/** Kleinbuchstaben, Umlaute → ae/oe/ue, ß → ss, Akzente/Satzzeichen entfernen. */
export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grober "Klang-Schlüssel", damit ähnlich klingende Schreibweisen gleich werden. */
export function soundKey(word) {
  return normalizeText(word)
    .replace(/\s/g, '')
    .replace(/^(tsch|dsch|dj|sch|ch|zh|g(?=[ei]))/, 'j') // Jarvis ≈ Dschawis ≈ Tscharvis
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/ck|q|c(?=[aou])/g, 'k')
    .replace(/(ae|oe|ue)/g, (m) => m[0])
    .replace(/y/g, 'i')
    .replace(/h(?![aeiou])/g, '')     // stummes h (z. B. "Jahrvis")
    .replace(/(?<=[aeiou])r(?=[^aeiou])/g, '') // "ar" vor Konsonant oft verschluckt
    .replace(/(.)\1+/g, '$1')           // Doppelbuchstaben
    .replace(/[sz]+$/, 's');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

const allowedDistance = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

/**
 * Erstellt eine Prüffunktion für einen (auch mehrteiligen) Namen.
 * match(text) → { matched, command, greeting }
 *   command = Text nach dem Namen (Originalschreibweise), evtl. leer.
 */
export function createWakeMatcher(name) {
  const nameWords = normalizeText(name).split(' ').filter(Boolean);
  const nameKey = soundKey(nameWords.join(''));
  const n = nameWords.length || 1;

  return function match(text) {
    // Wörter im Original behalten, parallel normalisieren
    const original = String(text ?? '').trim().split(/\s+/).filter(Boolean);
    const words = original.map((w) => normalizeText(w).replace(/\s/g, ''));
    for (let i = 0; i < words.length; i++) {
      // Name darf auch als 1 Wort erkannt werden, wenn er eigentlich aus 2 besteht
      for (const size of new Set([n, 1, n + 1])) {
        if (i + size > words.length) continue;
        const candidate = words.slice(i, i + size).join('');
        if (!candidate) continue;
        const key = soundKey(candidate);
        if (key.length < 2) continue;
        if (levenshtein(key, nameKey) <= allowedDistance(nameKey.length)) {
          // Nur am Satzanfang (ggf. nach Begrüßung/Füllwort) gilt es als Weckruf,
          // damit "Ich mag Jarvis" nicht auslöst – außer der Satz endet mit dem Namen.
          const before = words.slice(0, i);
          const greetingOnly = before.every((w) => GREETINGS.has(w) || w === 'na' || w === 'du');
          if (!greetingOnly && i + size < words.length) continue;
          const command = original.slice(i + size).join(' ').replace(/^[,.!?:;\s]+/, '').trim();
          return { matched: true, command: greetingOnly ? command : '', greeting: before.join(' ') };
        }
      }
    }
    return { matched: false, command: '', greeting: '' };
  };
}

/** v0.9.6: Nur „Hey <Name>“ (bzw. nur der Name) ohne weiteren Text? „Danke Jarvis“ zählt nicht. */
export function isBareWake(m) {
  return Boolean(m?.matched && !m.command && String(m.greeting || '').split(' ').filter(Boolean).every((w) => GREETINGS.has(w)));
}
