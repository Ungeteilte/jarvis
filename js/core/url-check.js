// Prüft eine Web-Adresse, bevor Jarvis anbietet, sie zu öffnen.
// Ergebnis zeigt IMMER die vollständige Adresse und die Domain – geöffnet wird erst nach Bestätigung.

export const MAX_URL = 2048;

/** → { ok:true, url, host, warn? } oder { ok:false, message } */
export function checkWebUrl(input) {
  let u = String(input ?? '').trim().replace(/^<|>$/g, '');
  if (!u) return { ok: false, message: 'Welche Website soll ich öffnen?' };
  if (/\s/.test(u)) return { ok: false, message: 'Das ist keine gültige Adresse.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^https?:\/\//i.test(u)) {
    return { ok: false, message: 'Ich öffne nur normale Web-Adressen (https).' };
  }
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (u.length > MAX_URL) return { ok: false, message: 'Diese Adresse ist zu lang.' };
  let p;
  try { p = new URL(u); } catch { return { ok: false, message: 'Das ist keine gültige Adresse.' }; }
  if (p.protocol !== 'https:' && p.protocol !== 'http:') return { ok: false, message: 'Ich öffne nur normale Web-Adressen (https).' };
  if (p.username || p.password) return { ok: false, message: 'Adressen mit Anmeldedaten (name@…) öffne ich nicht – sie verschleiern das echte Ziel.' };
  const host = p.hostname.toLowerCase();
  if (!host || (!host.includes('.') && host !== 'localhost') || host.endsWith('.')) return { ok: false, message: 'Das ist keine gültige Adresse.' };
  const warn = [];
  if (p.protocol === 'http:') warn.push('unverschlüsselt (http)');
  if (host.split('.').some((l) => l.startsWith('xn--'))) warn.push('internationale Schreibweise – auf ähnlich aussehende Buchstaben achten');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith('[')) warn.push('IP-Adresse statt Name');
  return { ok: true, url: p.href, host, warn };
}

/** Bestätigungskarte für eine Web-Adresse (Domain im Titel, volle Adresse im Detail). */
export function websiteConfirm(url, host, warn = [], { title, ask } = {}) {
  const hint = warn.length ? `Achtung: ${warn.join('; ')}.` : '';
  return {
    ok: true,
    needsConfirm: true,
    message: `${ask || `Soll ich ${host} öffnen?`} Die vollständige Adresse steht auf der Karte.${hint ? ' ' + hint : ''} Tippen Sie auf Ja oder sagen Sie „Ja“.`,
    confirm: {
      title: title || `Website öffnen: ${host}?`,
      detail: url + (hint ? `\n${hint}` : ''),
      action: { type: 'openUrl', url }
    }
  };
}
