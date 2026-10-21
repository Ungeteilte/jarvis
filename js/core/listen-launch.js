// v0.9 Stufe 0 – „Jarvis fragen“: öffnen und sofort zuhören (reine Logik, browserfrei).
//
// Auslöser (Android): Schnelleinstellungs-Kachel, Verknüpfung „Jarvis fragen“, jarvis://zuhoeren.
// Auslöser (PWA): index.html?zuhoeren=1 (Verknüpfung aus manifest.json).
// Normaler Start (App-Symbol, Seitentaste, „Hey Google, öffne Jarvis“) hört nur zu, wenn
// „Beim Öffnen sofort zuhören“ eingeschaltet ist. Kein Zuhören im Hintergrund – immer nur in der sichtbaren App.

export const LISTEN_PARAM = 'zuhoeren';

/**
 * Soll Jarvis jetzt zuhören?
 * @param {{listen?:boolean, opened?:boolean}|null} launch abgeholter Start
 * @param {{listenOnOpen?:boolean}} settings
 * @param {{onboarded:boolean, busy:boolean, listening:boolean, hidden?:boolean}} state
 * @returns {{listen:boolean, reason:string}}
 */
export function decideListen(launch, settings, state) {
  if (!launch || (!launch.listen && !launch.opened)) return { listen: false, reason: 'kein Start' };
  if (launch.listen !== true && !(launch.opened && settings?.listenOnOpen === true)) return { listen: false, reason: 'normal geöffnet' };
  if (!state?.onboarded) return { listen: false, reason: 'Einrichtung zuerst' };
  if (state.hidden) return { listen: false, reason: 'nicht sichtbar' };
  if (state.listening) return { listen: false, reason: 'hört schon' };
  if (state.busy) return { listen: false, reason: 'beschäftigt' };
  return { listen: true, reason: launch.listen ? 'Jarvis fragen' : 'beim Öffnen' };
}

/** PWA: steht ?zuhoeren=1 in der Adresse? → { listen, cleanUrl } (cleanUrl ohne den Parameter). */
export function parseListenUrl(href) {
  try {
    const u = new URL(href);
    const v = u.searchParams.get(LISTEN_PARAM);
    if (v === null) return { listen: false, cleanUrl: null };
    u.searchParams.delete(LISTEN_PARAM);
    return { listen: v === '' || v === '1' || v === 'ja' || v === 'true', cleanUrl: u.pathname + u.search + u.hash };
  } catch {
    return { listen: false, cleanUrl: null };
  }
}

/** Anleitung (Einstellungen) – ein Ort für Text, damit Test und UI dasselbe zeigen. */
export const LISTEN_GUIDE = Object.freeze([
  { id: 'tile', title: 'Schnelleinstellungs-Kachel', text: 'Zweimal von oben wischen, auf ✏️ (Bearbeiten) tippen und „Jarvis fragen“ in die Kacheln ziehen. Ein Tipp öffnet Jarvis und Jarvis hört sofort zu.' },
  { id: 'shortcut', title: 'Startbildschirm', text: 'Lange auf das Jarvis-Symbol tippen und „Jarvis fragen“ auf den Startbildschirm ziehen – oder unten „Verknüpfung anlegen“.' },
  { id: 'google', title: '„Hey Google, öffne Jarvis“', text: 'Funktioniert ohne Einrichtung, solange Google Assistant/Gemini auf dem Handy aktiv ist. Mit „Beim Öffnen sofort zuhören“ hört Jarvis danach direkt zu.' },
  { id: 'bixby', title: 'Bixby', text: '„Hi Bixby, öffne Jarvis“. Zuerst Bixby einrichten (Einstellungen → Erweiterte Funktionen → Bixby) und „Mit Sprachbefehl aufwecken“ einschalten.' },
  { id: 'sidekey', title: 'Seitentaste', text: 'Einstellungen → Erweiterte Funktionen → Seitentaste → „Doppelt drücken“ einschalten → „App öffnen“ → Jarvis. Mit „Beim Öffnen sofort zuhören“ ist das fast wie ein eigener Assistenz-Knopf.' },
  { id: 'assistant', title: 'Standard-Assistenz-App', text: 'Jarvis kann (noch) nicht als Standard-Assistent gewählt werden; „Hey Jarvis“ bei geschlossener App kommt frühestens nach einem Test in v0.9.x.' }
]);
