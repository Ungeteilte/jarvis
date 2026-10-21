/**
 * Einstellungsbereich „App-Updates“ + Karte „Update verfügbar“ (nur in der Android-App).
 * Spricht mit JarvisNative (getUpdateStatus/setUpdateConfig/checkNow/installUpdate, Event updateStatus).
 */
import { INTERVAL_OPTIONS, formatStatusLine, shouldShowCard, normalizeInterval } from './updater-format.js';

const CSS = `
.update-card{margin:8px 12px 0;padding:12px 14px;border:1px solid rgba(58,214,255,.45);border-radius:14px;
  background:rgba(8,30,48,.85);box-shadow:0 0 18px rgba(58,214,255,.15)}
.update-card h3{margin:0 0 6px;font-size:1rem;color:#3ad6ff}
.update-card .changelog{white-space:pre-wrap;font-size:.88rem;opacity:.9;max-height:9em;overflow:auto;margin:0 0 10px}
.update-card .row{display:flex;gap:8px;flex-wrap:wrap}
#upd-status{min-height:1.2em}
`;

export function mountUpdaterUI(plugin, doc = document) {
  if (!plugin?.getUpdateStatus || doc.getElementById('upd-fieldset')) return null;
  const style = doc.createElement('style');
  style.textContent = CSS;
  doc.head.append(style);

  // ---------- Einstellungen ----------
  const fs = doc.createElement('fieldset');
  fs.id = 'upd-fieldset';
  fs.innerHTML = `
    <legend>App-Updates</legend>
    <label class="switch"><input id="upd-enabled" type="checkbox"> Automatisch nach Updates suchen</label>
    <label>Wie oft prüfen
      <select id="upd-interval">${INTERVAL_OPTIONS.map((h) => `<option value="${h}">alle ${h} Stunden</option>`).join('')}</select>
    </label>
    <label class="switch"><input id="upd-wifi" type="checkbox"> Nur über WLAN herunterladen</label>
    <button id="upd-check" type="button" class="btn">Jetzt prüfen</button>
    <p id="upd-status" class="hint" aria-live="polite"></p>
    <p id="upd-notif" class="hint hidden">🔔 Benachrichtigungen sind aus – Updates erscheinen dann nur hier in der App.
      <button id="upd-notif-btn" type="button" class="btn small">Erlauben</button></p>
    <p class="hint">Updates kommen nur von github.com/Ungeteilte/jarvis, werden per SHA-256 und Signatur geprüft
      und erst nach Ihrer Bestätigung im Android-Dialog installiert.</p>`;
  // v0.9: eigene Gruppe „Updates“ in den Einstellungen (#upd-slot); ältere Oberflächen: vor „Daten“
  const slot = doc.getElementById('upd-slot');
  const form = doc.getElementById('settings-form');
  const dataFs = [...(form?.querySelectorAll('fieldset') || [])].find((f) => /Daten/.test(f.querySelector('legend')?.textContent || ''));
  if (slot) slot.append(fs);
  else if (dataFs) form.insertBefore(fs, dataFs); else form?.append(fs);

  // ---------- Karte ----------
  const card = doc.createElement('div');
  card.id = 'update-card';
  card.className = 'update-card hidden';
  card.setAttribute('role', 'status');
  card.innerHTML = `<h3 id="upd-card-title">Update verfügbar</h3>
    <p class="changelog" id="upd-card-log"></p>
    <div class="row"><button id="upd-install" type="button" class="btn">Jetzt installieren</button>
    <button id="upd-later" type="button" class="btn small">Später</button></div>`;
  const chat = doc.getElementById('chat');
  chat?.parentNode?.insertBefore(card, chat);

  const $ = (id) => doc.getElementById(id);
  let dismissedCode = 0;
  let last = {};

  function render(s) {
    last = s || {};
    $('upd-enabled').checked = s.enabled !== false;
    $('upd-interval').value = String(normalizeInterval(s.intervalHours));
    $('upd-interval').disabled = s.enabled === false;
    $('upd-wifi').checked = Boolean(s.wifiOnly);
    $('upd-status').textContent = formatStatusLine(s);
    $('upd-notif').classList.toggle('hidden', s.notificationsAllowed !== false || s.enabled === false);
    const show = shouldShowCard(s) && Number(s.availableVersionCode) !== dismissedCode;
    card.classList.toggle('hidden', !show);
    if (show) {
      $('upd-card-title').textContent = `Update verfügbar: v${s.availableVersionName}`;
      $('upd-card-log').textContent = s.changelog || 'Verbesserungen und Fehlerbehebungen.';
      $('upd-install').textContent = s.ready ? 'Jetzt installieren'
        : s.status === 'downloading' ? `Wird geladen … ${s.progress || 0} %` : 'Laden und installieren';
      $('upd-install').disabled = s.status === 'downloading' || s.status === 'installing';
    }
  }

  async function call(fn, args) {
    try { const r = await plugin[fn](args); if (r) render(r); return r; }
    catch (e) { $('upd-status').textContent = `Fehler: ${e?.message || e}`; return null; }
  }
  const saveConfig = () => call('setUpdateConfig', {
    enabled: $('upd-enabled').checked,
    intervalHours: Number($('upd-interval').value),
    wifiOnly: $('upd-wifi').checked
  });

  $('upd-enabled').addEventListener('change', saveConfig);
  $('upd-interval').addEventListener('change', saveConfig);
  $('upd-wifi').addEventListener('change', saveConfig);
  $('upd-check').addEventListener('click', () => call('checkNow', {}));
  $('upd-notif-btn').addEventListener('click', () => call('requestNotificationPermission', {}));
  $('upd-install').addEventListener('click', () => call('installUpdate', {}));
  $('upd-later').addEventListener('click', () => { dismissedCode = Number(last.availableVersionCode) || 0; render(last); });

  plugin.addListener?.('updateStatus', (s) => render(s));
  // Beim Zurückkehren in die App (z. B. nach dem Installationsdialog) aktualisieren
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') call('getUpdateStatus'); });
  call('getUpdateStatus');
  return { render, card, fieldset: fs };
}
