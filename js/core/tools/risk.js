// v0.9 W0 – Risikoklassen für alle Werkzeuge und die zentrale Bestätigungsregel.
//
//   lesen      – liest nur (Akku, Wetter, Notizen anzeigen, Status)
//   lokal      – harmlos und sofort umkehrbar (Vibration, Taschenlampe, Lautstärke, Jarvis-Timer)
//   schreiben  – ändert Daten auf dem Gerät (Notiz, Gedächtnis, Zwischenablage, Wecker, Erinnerung)
//   aussen     – öffnet etwas außerhalb von Jarvis oder gibt Daten weiter (App, URL, Anruf, Teilen, Datei)
//
// Fehlt die Klasse oder ist sie unbekannt, gilt „aussen“ (sicherer Standard).
//
// confirms (wie bestätigt ein Werkzeug selbst?):
//   'always' – führt nie selbst aus, liefert immer eine Ja-Karte (Anruf, SMS, URL …)
//   'system' – der System-Dialog ist die Bestätigung (Teilen-Menü, Datei-Dialog, Einstellungs-Panel)
//   'self'   – entscheidet selbst (z. B. open_app: eindeutiger Name sofort, sonst Karte)
//
// Regel (registry.run):
//   - Aufruf durch dich (lokaler Befehl) oder durch die KI ohne fremde Daten: lesen/lokal/schreiben sofort;
//     aussen nur, wenn das Werkzeug sich selbst absichert (confirms gesetzt), sonst zentrale Karte.
//   - KI-Aufruf, nachdem in dieser Runde fremde Daten gelesen wurden (Taint, ctx.turn.external):
//     lesen sofort; lokal höchstens 2× pro Runde; schreiben/aussen nur über eine Karte mit Herkunftshinweis
//     (Ausnahme confirms='always': die eigene Karte bekommt den Hinweis).
import { cleanText } from '../briefing/sanitize.js';

export const RISKS = Object.freeze(['lesen', 'lokal', 'schreiben', 'aussen']);
export const LOKAL_LIMIT_TAINTED = 2;

export function riskOf(tool) {
  return RISKS.includes(tool?.risk) ? tool.risk : 'aussen';
}

/** Kurzbeschreibung der Herkunft fremder Daten für die Karte. */
export function originHint(turn) {
  const src = [...(turn?.sources || [])];
  const what = src.length ? src.join(', ') : 'fremden Daten';
  return `Hinweis: ausgelöst, nachdem ich ${src.length ? 'Inhalte aus ' + what : what} gelesen habe. Bitte prüfen Sie genau.`;
}

/** Titel/Detail der zentralen Karte: tool.describe(args) oder eine sichere Standardbeschreibung. */
export function describeCall(tool, args) {
  let d = null;
  try { d = tool.describe?.(args || {}) || null; } catch { d = null; }
  if (d?.title) return { title: String(d.title), detail: cleanText(String(d.detail || ''), 300) };
  const shown = Object.entries(args || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' · ');
  return { title: `„${tool.userHint || tool.name}“ ausführen?`, detail: cleanText(shown, 300) };
}

/**
 * Entscheidet vor der Ausführung. Gibt null (ausführen) oder ein fertiges Ergebnis (Karte/Ablehnung) zurück.
 * Die zentrale Karte führt nach „Ja“ genau diesen Aufruf mit ctx.confirmed aus (Aktion runTool).
 */
export function gate(tool, args, ctx = {}) {
  if (ctx.confirmed) return null;
  const risk = riskOf(tool);
  const tainted = Boolean(ctx.viaAI && ctx.turn?.external);
  if (risk === 'lesen') return null;
  if (risk === 'lokal') {
    if (!tainted) return null;
    ctx.turn.lokalCount = (ctx.turn.lokalCount || 0) + 1;
    if (ctx.turn.lokalCount > LOKAL_LIMIT_TAINTED) {
      return { ok: false, blocked: true, message: 'Mehr Gerätefunktionen führe ich nach dem Lesen fremder Inhalte in einer Runde nicht aus. Sagen Sie es mir bitte direkt.' };
    }
    return null;
  }
  if (risk === 'schreiben' && !tainted) return null;
  if (risk === 'aussen' && !tainted && tool.confirms) return null;
  if (tainted && tool.confirms === 'always') return null; // eigene Karte, Hinweis kommt in registry.run dazu
  const { title, detail } = describeCall(tool, args);
  const hint = tainted ? originHint(ctx.turn) : '';
  return {
    ok: true,
    needsConfirm: true,
    gated: true,
    message: `${title} Tippen Sie auf Ja oder sagen Sie „Ja“.`,
    confirm: { title, detail: [detail, hint].filter(Boolean).join('\n'), origin: tainted ? hint : undefined, action: { type: 'runTool', name: tool.name, args: args || {} } }
  };
}

/** Hängt bei Taint den Herkunftshinweis an eine Karte an, die das Werkzeug selbst erzeugt hat. */
export function markOrigin(result, ctx = {}) {
  if (!result?.needsConfirm || !result.confirm || !(ctx.viaAI && ctx.turn?.external)) return result;
  const hint = originHint(ctx.turn);
  return { ...result, confirm: { ...result.confirm, origin: hint, detail: [result.confirm.detail, hint].filter(Boolean).join('\n') } };
}
