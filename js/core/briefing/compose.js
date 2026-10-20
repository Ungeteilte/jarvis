// Briefing-Text: KI-Prompt (Fakten eingezäunt, ohne Werkzeuge) oder Vorlage ohne KI.
import { fenceData, DATA_RULE } from './sanitize.js';
import { weatherSentence } from './weather.js';
import { normalizeText } from '../wakeword.js';

const NUM_DE = ['keine', 'einen', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];

/** Worauf zielt die Rückfrage? news > events > weather > null */
export function followUpTopic(facts) {
  if (facts.news?.length) return 'news';
  if (facts.events?.length) return 'events';
  if (facts.weather) return 'weather';
  return null;
}

const QUESTIONS = {
  news: 'Soll ich Ihnen mehr zu den Nachrichten sagen?',
  events: 'Soll ich Ihnen die Termine genauer vorlesen?',
  weather: 'Möchten Sie noch die Aussichten für morgen hören?',
  null: 'Womit kann ich Ihnen heute behilflich sein?'
};

export function buildBriefingMessages({ name = 'Jarvis', facts }) {
  const system = [
    `Du bist ${name}, ein höflicher, geistreicher persönlicher Assistent im Stil eines britischen Butlers. Du sprichst Deutsch und siezt den Nutzer.`,
    'Deine Antwort wird vorgelesen: kein Markdown, keine Aufzählungszeichen, keine Emojis, keine Links, keine Koordinaten.',
    'Aufgabe: ein kurzes, natürliches Morgen-Briefing in 4 bis 6 Sätzen aus den gelieferten Fakten. Beginne mit einem kurzen Morgengruß.',
    'Nenne nur Fakten aus den Daten und erfinde nichts. Fehlt etwas, lass es weg oder erwähne es höchstens in einem Halbsatz.',
    'Nachrichten nur als kurze Schlagzeilen in eigenen Worten, höchstens drei. Akku nur erwähnen, wenn er unter 30 Prozent ist.',
    'Beende das Briefing mit genau einer natürlichen Rückfrage, zum Beispiel „Soll ich Ihnen mehr zu … sagen?“.',
    DATA_RULE
  ].join('\n');
  const user = `${fenceData(facts)}\nErstelle jetzt das Morgen-Briefing.`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Kurzes Briefing ohne KI (oder wenn die KI ausfällt). */
export function templateBriefing(facts, { name = 'Jarvis' } = {}) {
  const parts = [`Guten Morgen. Heute ist ${facts.date}, es ist ${facts.time} Uhr.`];
  if (facts.weather) parts.push(weatherSentence({ ...facts.weather, day: 'heute' }, { stale: facts.weather.stale }));
  else if (facts.weatherNote) parts.push(facts.weatherNote);
  if (Array.isArray(facts.events)) {
    const ev = facts.events;
    if (!ev.length) parts.push('Im Kalender steht heute nichts.');
    else {
      const first = ev.find((e) => e.time) || ev[0];
      parts.push(`Sie haben heute ${ev.length === 1 ? 'einen Termin' : `${NUM_DE[ev.length] || ev.length} Termine`}` +
        (first.time ? `, ${ev.length === 1 ? '' : 'der erste '}um ${first.time} Uhr: ${first.title}` : `: ${first.title}`) + '.');
    }
  } else if (facts.calendarNote) parts.push(facts.calendarNote);
  if (facts.news?.length) {
    const t = facts.news.slice(0, 3).map((n) => n.title.replace(/[.!?…]+$/, ''));
    parts.push(`Aus den Nachrichten: ${t[0]}.` + (t.length > 1 ? ` Außerdem: ${t.slice(1).join('; ')}.` : ''));
  }
  if (facts.battery && (facts.battery.percent < 30 && !facts.battery.charging)) {
    parts.push(`Der Akku steht nur noch bei ${facts.battery.percent} Prozent.`);
  }
  if (facts.timers) parts.push(facts.timers === 1 ? 'Ein Timer läuft noch.' : `${facts.timers} Timer laufen noch.`);
  if (facts.notes?.length) parts.push(`Notiert hatten Sie zuletzt: ${facts.notes.at(-1)}.`);
  parts.push(QUESTIONS[followUpTopic(facts)]);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim() || `${name} wünscht einen guten Morgen.`;
}

/** Fakten für Nachfragen (an den System-Prompt angehängt). */
export function factsContext(facts) {
  return `Fakten aus dem heutigen Morgen-Briefing, falls der Nutzer nachfragt:\n${fenceData(facts)}\n${DATA_RULE}`;
}

/** Nachfrage ohne KI-Schlüssel beantworten („Ja, mehr zu den Nachrichten“). → Text oder null */
export function localFollowUp(text, facts) {
  if (!facts) return null;
  const t = normalizeText(text);
  const yes = /^(ja|jo|gerne?|bitte|klar|okay|ok|sicher|unbedingt|mehr)\b/.test(t);
  let topic = null;
  if (/nachricht|schlagzeil|news|meldung/.test(t)) topic = 'news';
  else if (/termin|kalender/.test(t)) topic = 'events';
  else if (/wetter|regen|temperatur/.test(t)) topic = 'weather';
  else if (yes) topic = followUpTopic(facts);
  if (!topic) return null;
  if (topic === 'news' && facts.news?.length) {
    return facts.news.map((n) => `${n.title.replace(/[.!?…]+$/, '')}: ${n.summary || 'keine weiteren Details.'}`).join(' ') ;
  }
  if (topic === 'events' && facts.events?.length) {
    return 'Ihre Termine heute: ' + facts.events.map((e) => (e.time ? `${e.time} Uhr ${e.title}` : `ganztägig ${e.title}`) + (e.location ? ` (${e.location})` : '')).join('; ') + '.';
  }
  if (topic === 'weather' && facts.weather) return weatherSentence({ ...facts.weather, day: 'heute' }, { stale: facts.weather.stale }) + ' Für morgen fragen Sie einfach: Wie wird das Wetter morgen?';
  return null;
}
