// Vorlieben für das Antwortverhalten. NUR feste Auswahlwerte – die Sätze im Prompt formuliert
// die App selbst, damit über Vorlieben kein fremder Text in den Prompt gelangt.

export const PREF_OPTIONS = Object.freeze({
  antwortlaenge: ['kurz', 'normal', 'ausfuehrlich'],
  anrede: ['Sie', 'du'],
  humor: ['an', 'weniger']
});
export const DEFAULT_PREFS = Object.freeze({ antwortlaenge: 'normal', anrede: 'Sie', humor: 'an' });
export const PREF_LABELS = Object.freeze({
  antwortlaenge: { kurz: 'kurz', normal: 'normal', ausfuehrlich: 'ausführlich' },
  anrede: { Sie: 'Sie', du: 'du' },
  humor: { an: 'mit Humor', weniger: 'weniger Humor' }
});

export function normalizePrefs(p) {
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(PREF_OPTIONS)) {
    if (p && PREF_OPTIONS[k].includes(p[k])) out[k] = p[k];
  }
  return out;
}

/** Feste Prompt-Sätze aus den Vorlieben. */
export function prefSentences(prefs) {
  const p = normalizePrefs(prefs);
  const anrede = p.anrede === 'du' ? 'Du duzt den Nutzer.' : 'Du siezt den Nutzer.';
  const laenge = {
    kurz: 'Antworte sehr knapp: höchstens 2 kurze Sätze.',
    normal: 'Antworte kurz und präzise (meist 1–3 Sätze).',
    ausfuehrlich: 'Antworte gern ausführlicher (bis zu 6 Sätze), aber gut vorlesbar.'
  }[p.antwortlaenge];
  const humor = p.humor === 'weniger' ? 'Verzichte weitgehend auf Witze und Ironie.' : 'Gern mit einer Prise trockenem Humor.';
  return { anrede, laenge, humor };
}
