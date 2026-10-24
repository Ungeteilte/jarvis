// Sprachbefehle rund ums Briefing: starten, an/aus, Nachrichten-Ressorts.
import { normalizeText } from '../wakeword.js';
import { loadSettings, saveSettings } from '../settings.js';
import { RESSORTS, RESSORT_IDS, ressortsFromWords } from './news.js';
import { normalizeBriefingConfig } from './trigger.js';
import { impulseToggle } from './impulse.js';

const REQUEST = [
  /^(?:guten morgen|morgen|moin(?: moin)?)(?: [a-z]+)?$/,
  /^(?:(?:mein|das|ein|dein) )?(?:morgen ?)?briefing(?: bitte| starten| jetzt| bitte starten)?$/,
  /^(?:starte?|mach|gib mir|zeig mir) (?:das |mein |ein |bitte )*(?:morgen ?)?briefing(?: bitte)?$/,
  /^was steht (?:heute|fuer heute) (?:so )?an$/,
  /^was liegt heute an$/,
  /^wie sieht mein tag (?:heute )?aus$/,
  /^(?:mein |der )?tagesueberblick(?: bitte)?$/
];

/** Möchte der Nutzer jetzt das Briefing hören? */
export function isBriefingRequest(text) {
  const t = normalizeText(text);
  return Boolean(t) && REQUEST.some((re) => re.test(t));
}

const list = (ids) => {
  const l = ids.map((r) => RESSORTS[r].label);
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} und ${l.at(-1)}` : l[0];
};

/** Einstellungsbefehle. → Antworttext oder null */
export function handleBriefingCommand(text, store) {
  const t = normalizeText(text);
  if (!t) return null;
  const s = loadSettings(store);
  const cfg = normalizeBriefingConfig(s.briefing, RESSORT_IDS);
  const save = (changes) => saveSettings(store, { briefing: { ...cfg, ...changes } });

  if (/^(?:das |mein )?(?:morgen ?)?briefing (?:bitte )?(?:aus|ausschalten|abschalten|deaktivieren|stoppen)$|^(?:schalte?|mach) (?:das |mein )?(?:morgen ?)?briefing aus$|^kein (?:morgen ?)?briefing mehr$/.test(t)) {
    save({ enabled: false });
    return 'Sehr wohl, das Morgen-Briefing ist ausgeschaltet. Sagen Sie „Briefing an“, wenn Sie es wieder möchten.';
  }
  if (/^(?:das |mein )?(?:morgen ?)?briefing (?:bitte )?(?:an|ein|einschalten|aktivieren)$|^(?:schalte?|mach) (?:das |mein )?(?:morgen ?)?briefing (?:an|ein)$/.test(t)) {
    save({ enabled: true });
    return 'Sehr gern, das Morgen-Briefing ist eingeschaltet. Ich melde mich morgens beim ersten Öffnen.';
  }
  const imp = impulseToggle(text, normalizeText);
  if (imp) {
    save({ content: { ...cfg.content, impulse: imp.enabled } });
    return imp.enabled
      ? 'Gern, am Ende des Morgen-Briefings gibt es wieder einen kleinen Impuls – mal ein Gedanke für den Tag, mal ein kurioser Fakt.'
      : 'Verstanden, das Morgen-Briefing kommt künftig ohne Impuls am Ende. Mit „Morgen-Impuls an“ ist er wieder da.';
  }
  if (/^(?:(?:bitte )?(?:wieder )?alle nachrichten|nachrichten (?:wieder )?(?:alle|komplett)|alle ressorts)(?: im briefing)?(?: bitte)?$/.test(t)) {
    save({ newsRessorts: [], content: { ...cfg.content, news: true } });
    return 'Gern, im Briefing kommen wieder alle Nachrichten.';
  }
  if (/^(?:keine nachrichten(?: mehr)?(?: im briefing)?|nachrichten (?:im briefing )?(?:aus|weglassen|abschalten))(?: bitte)?$/.test(t)) {
    save({ content: { ...cfg.content, news: false } });
    return 'Verstanden, das Briefing kommt künftig ohne Nachrichten.';
  }
  if (/^nachrichten (?:im briefing )?(?:wieder )?(?:an|ein|einschalten)$/.test(t)) {
    save({ content: { ...cfg.content, news: true } });
    return 'Sehr wohl, die Nachrichten sind wieder Teil des Briefings.';
  }
  const only = t.match(/^(?:(?:im briefing )?(?:die )?nachrichten (?:bitte )?(?:nur|nur noch|ausschliesslich) (.+)|(?:bitte )?nur(?: noch)? (.+?) (?:nachrichten|news|als nachrichten))$/);
  if (only) {
    const ids = ressortsFromWords(only[1] || only[2]);
    if (!ids.length) return `Diese Rubrik kenne ich nicht. Möglich sind: ${list(RESSORT_IDS)}.`;
    save({ newsRessorts: ids, content: { ...cfg.content, news: true } });
    return `Sehr wohl, Nachrichten künftig nur noch aus ${list(ids)}.`;
  }
  return null;
}
