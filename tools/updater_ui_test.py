"""Headless-Test der Updater-Oberfläche (android/native-web/updater-ui.js) mit gefälschtem JarvisNative-Plugin.
Läuft gegen den lokalen Server (python3 -m http.server 8080 im Repo-Wurzelordner)."""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/index.html"
results, errors = [], []

def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

FAKE = """
window.__calls = [];
window.__fake = (() => {
  let listener = null;
  let st = { enabled: true, intervalHours: 6, wifiOnly: false, status: 'up-to-date', message: '',
    progress: 0, lastCheck: Date.now(), installedVersionName: '0.3', installedVersionCode: 3,
    availableVersionCode: 0, availableVersionName: '', changelog: '', ready: false, notificationsAllowed: true };
  const rec = (n, a) => { window.__calls.push({ n, a }); };
  return {
    state: () => st,
    push(p) { st = { ...st, ...p }; listener && listener(st); },
    getUpdateStatus: async () => (rec('getUpdateStatus'), st),
    setUpdateConfig: async (a) => { rec('setUpdateConfig', a); st = { ...st, enabled: a.enabled, intervalHours: a.intervalHours, wifiOnly: a.wifiOnly }; return st; },
    checkNow: async (a) => { rec('checkNow', a); st = { ...st, status: 'checking' }; return st; },
    installUpdate: async (a) => { rec('installUpdate', a); return { ...st, result: 'started' }; },
    requestNotificationPermission: async () => (rec('notif'), st),
    addListener: (ev, cb) => { if (ev === 'updateStatus') listener = cb; return { remove() {} }; }
  };
})();
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    page = b.new_page(viewport={"width": 412, "height": 915})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script("localStorage.setItem('jarvis:persona', JSON.stringify({name:'Jarvis',onboarded:true}));")
    page.goto(URL)
    page.wait_for_timeout(600)
    page.evaluate(FAKE)
    page.evaluate("import('./android/native-web/updater-ui.js').then(m => { window.__ui = m.mountUpdaterUI(window.__fake); })")
    page.wait_for_timeout(400)
    page.evaluate("document.getElementById('onboarding')?.close?.()")
    check("Einstellungsbereich 'App-Updates' eingefügt", page.locator("#upd-fieldset legend").inner_text() == "App-Updates")
    check("Bereich steht vor 'Daten'", page.evaluate("""() => { const fs=[...document.querySelectorAll('#settings-form fieldset legend')].map(l=>l.textContent); return fs.indexOf('App-Updates') === fs.indexOf('Daten') - 1; }"""))
    check("Toggle 'Automatisch nach Updates suchen' Standard AN", page.is_checked("#upd-enabled"))
    check("Toggle 'Nur über WLAN' Standard AUS", not page.is_checked("#upd-wifi"))
    check("Intervall Standard 6 h, Optionen 3/6/12/24",
          page.input_value("#upd-interval") == "6" and page.eval_on_selector_all("#upd-interval option", "o=>o.map(x=>x.value)") == ["3", "6", "12", "24"])
    check("Statuszeile 'Zuletzt geprüft: … aktuell (v0.3)'", "Zuletzt geprüft: heute" in page.inner_text("#upd-status") and "aktuell (v0.3)" in page.inner_text("#upd-status"))
    check("Keine Update-Karte, wenn aktuell", page.locator("#update-card.hidden").count() == 1)

    page.click("#btn-settings"); page.wait_for_timeout(300)
    page.select_option("#upd-interval", "12"); page.wait_for_timeout(100)
    page.check("#upd-wifi"); page.wait_for_timeout(100)
    calls = page.evaluate("window.__calls.filter(c => c.n === 'setUpdateConfig').map(c => c.a)")
    check("Intervall/WLAN → setUpdateConfig", calls and calls[-1] == {"enabled": True, "intervalHours": 12, "wifiOnly": True})
    page.uncheck("#upd-enabled"); page.wait_for_timeout(100)
    check("Auto-Update aus → enabled:false, Intervall gesperrt",
          page.evaluate("window.__calls.at(-1).a.enabled") is False and page.is_disabled("#upd-interval"))
    page.check("#upd-enabled"); page.wait_for_timeout(100)
    page.click("#upd-check"); page.wait_for_timeout(100)
    check("'Jetzt prüfen' → checkNow + 'Suche …'", page.evaluate("window.__calls.some(c => c.n === 'checkNow')") and "Suche" in page.inner_text("#upd-status"))
    page.click("#btn-back"); page.wait_for_timeout(200)

    # Update gefunden und geladen → Karte
    page.evaluate("window.__fake.push({ status: 'ready', availableVersionCode: 4, availableVersionName: '0.4', changelog: 'Neu: Selbst-Update', ready: true })")
    page.wait_for_timeout(150)
    check("Karte 'Update verfügbar: v0.4' sichtbar", page.is_visible("#update-card") and "v0.4" in page.inner_text("#upd-card-title"))
    check("Karte zeigt Änderungen", "Selbst-Update" in page.inner_text("#upd-card-log"))
    check("Button 'Jetzt installieren'", page.inner_text("#upd-install") == "Jetzt installieren")
    page.click("#upd-install"); page.wait_for_timeout(100)
    check("'Jetzt installieren' → installUpdate", page.evaluate("window.__calls.some(c => c.n === 'installUpdate')"))
    page.evaluate("window.__fake.push({ status: 'downloading', ready: false, progress: 40 })"); page.wait_for_timeout(100)
    check("Während Download: Fortschritt, Button gesperrt", "40 %" in page.inner_text("#upd-install") and page.is_disabled("#upd-install"))
    page.evaluate("window.__fake.push({ status: 'ready', ready: true })"); page.wait_for_timeout(100)
    page.click("#upd-later"); page.wait_for_timeout(100)
    check("'Später' blendet Karte aus", not page.is_visible("#update-card"))
    page.evaluate("window.__fake.push({ notificationsAllowed: false })"); page.wait_for_timeout(100)
    check("Hinweis bei abgeschalteten Benachrichtigungen", page.locator("#upd-notif:not(.hidden)").count() == 1)
    page.screenshot(path="screenshots/updater-ui.png", full_page=False)
    b.close()

print("JS-Fehler:", errors or "keine")
failed = [n for n, ok in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} bestanden")
sys.exit(1 if failed or errors else 0)
