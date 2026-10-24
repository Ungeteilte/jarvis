"""Headless-Test des nativen App-Starts (Android-WebView nachgestellt) – startet seinen eigenen Server.

Baut www wie android/scripts/sync-www.mjs (PWA + native/ + Bootstrap-Skript), simuliert die
Capacitor-Bridge (JarvisNative, Preferences) mit verzögerten Antworten und lädt die Module gedrosselt.
Prüft: native Adapter aktiv, JarvisNative.speak für Antwort und Vorhören, kein Willkommens-Dialog,
kein speechSynthesis. Zusätzlich: Bridge hängt → nach ca. 3 s Start mit Web-Adaptern (Sicherheitsnetz).
Wake-Word (v0.7): nachgestellte native Erkennung (JarvisNative.sttStart/sttCancel + sttEvent) –
nie zwei Erkennungen gleichzeitig, kein Start während Jarvis spricht (auch Hintergrund-Vorlesen),
Pausen nach Stille/Fehlern statt Dauer-Neustart, Startton-Unterdrückung nur beim Wake-Word.

Aufruf: python3 tools/native_boot_test.py [--www PFAD]   (ohne --www: aus diesem Repo gebaut)
"""
import functools, http.server, json, shutil, sys, tempfile, threading, time
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
results, errors = [], []

def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

def build_www():
    out = Path(tempfile.mkdtemp(prefix="jarvis-www-"))
    for n in ["index.html", "manifest.json", "css", "js", "icons"]:
        src = REPO / n
        (shutil.copytree if src.is_dir() else shutil.copy)(src, out / n)
    shutil.copytree(REPO / "android" / "native-web", out / "native")
    html = (out / "index.html").read_text(encoding="utf-8")
    tag = '<script type="module" src="js/app.js"></script>'
    assert tag in html, "app.js-Skript nicht gefunden"
    html = html.replace(tag, '<script type="module" src="native/bootstrap.js"></script>\n  ' + tag)
    (out / "index.html").write_text(html, encoding="utf-8")
    return out

www = None
if "--www" in sys.argv:
    www = Path(sys.argv[sys.argv.index("--www") + 1]).resolve()
tmp = None
if www is None:
    www = tmp = build_www()

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(www)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{httpd.server_address[1]}"

FAKE = r"""
(() => {
  const CFG = %s;
  const lat = (v) => new Promise((r) => setTimeout(() => r(v), CFG.bridgeMs));
  const never = () => new Promise(() => {});
  window.__nat = { speak: [], web: [], calls: [], listenPending: CFG.listenLaunch || null };
  const st = window.__stt = { starts: 0, overlaps: 0, active: null, speaking: 0, bg: false, startsDuringSpeak: 0, startsDuringBg: 0,
    mode: CFG.sttMode || 'silence', segMs: CFG.segMs || 300, times: [], speakEnds: [], mute: [], cancels: 0, cbs: {} };
  const emit = (name, ev) => (st.cbs[name] || []).forEach((cb) => { try { cb(ev); } catch (e) {} });
  st.emitFinal = (text) => { const s = st.active; if (!s) return false; st.active = null; emit('sttEvent', { session: s, type: 'final', text }); return true; };
  st.bgSpeech = (on) => { st.bg = on; emit('backgroundSpeech', { speaking: on }); };
  const secure = {
    'jarvis.persona': JSON.stringify({ name: 'Jarvis', onboarded: true, voiceId: '' }),
    'jarvis.settings': JSON.stringify({ speak: true, provider: 'gemini', apiKeys: { gemini: 'test-key' }, wakeWord: Boolean(CFG.wake), listenOnOpen: Boolean(CFG.listenOnOpen) })
  };
  if (CFG.memory) secure['jarvis.memory'] = JSON.stringify({ version: 1, items: CFG.memory.map((t, i) => ({ id: 'm' + i, text: t, kategorie: 'sonstiges', quelle: 'sprache', erstellt: '2026-10-19T10:00:00.000Z', geaendert: '2026-10-19T10:00:00.000Z' })) });
  window.__secure = secure;
  window.__nat.opened = [];
  const rec = (n, v) => () => { window.__nat.calls.push(n); return lat(v); };
  const base = {
    secureGet: ({ key }) => { window.__nat.calls.push('secureGet'); return CFG.hang ? never() : lat({ value: secure[key] ?? null }); },
    secureSet: ({ key, value }) => { secure[key] = value; return lat({}); },
    secureRemove: ({ key }) => { delete secure[key]; return lat({}); },
    speak: (a) => {
      window.__nat.speak.push(a.text); st.speaking++;
      return new Promise((r) => setTimeout(() => { st.speaking--; st.speakEnds.push(performance.now()); r({}); }, CFG.speakMs || CFG.bridgeMs));
    },
    sttStart: ({ session, muteBeep }) => {
      st.starts++; st.times.push(performance.now()); st.mute.push(Boolean(muteBeep));
      if (st.active) st.overlaps++;
      if (st.speaking) st.startsDuringSpeak++;
      if (st.bg) st.startsDuringBg++;
      st.active = session;
      setTimeout(() => {
        if (st.active !== session) return;
        emit('sttEvent', { session, type: 'ready' });
        if (st.mode === 'manual') return;
        setTimeout(() => {
          if (st.active !== session) return;
          st.active = null;
          if (st.mode === 'busy') emit('sttEvent', { session, type: 'error', kind: 'busy', code: 8 });
          else emit('sttEvent', { session, type: 'error', kind: 'silence', code: 7 });
        }, st.mode === 'busy' ? 20 : st.segMs);
      }, 30);
      return lat({});
    },
    sttCancel: () => { st.cancels++; st.active = null; return lat({}); },
    openUrl: ({ url }) => { window.__nat.opened.push(url); return lat({}); },
    setAlarm: (a) => { (window.__nat.alarms = window.__nat.alarms || []).push(a); return CFG.alarmFail ? lat(null).then(() => { throw new Error('Keine Uhr-App gefunden, die Wecker annimmt.'); }) : lat(CFG.alarmOpened ? { ok: true, opened: true, hour: a.hour, minute: a.minute } : { ok: true, opened: false }); },
    // v0.9 W1: Launcher-Liste + Start per Paketname
    listLaunchableApps: () => { window.__nat.calls.push('listLaunchableApps'); return lat({ ok: true, apps: [
      { label: 'Instagram', package: 'com.instagram.android' }, { label: 'Samsung Notes', package: 'com.samsung.android.app.notes' },
      { label: 'Google Notizen', package: 'com.google.android.keep' }, { label: 'Kamera', package: 'com.sec.android.app.camera' }] }); },
    launchPackage: (a) => { (window.__nat.launched = window.__nat.launched || []).push(a.package); return lat({ ok: true }); },
    // v0.9 W5: Medientasten, Lautstärke in Prozent, Gerätestatus, Kalender-Entwurf
    mediaKey: (a) => { (window.__nat.media = window.__nat.media || []).push(a.action); return lat({ ok: true }); },
    setVolumePercent: (a) => { (window.__nat.volume = window.__nat.volume || []).push(a.percent); return lat({ ok: true, percent: a.percent }); },
    getDeviceStatus: () => lat({ ok: true, status: { wlan: 'verbunden', mobil: 'nicht verbunden', bluetooth: 'unbekannt', nichtStoeren: 'aus', akku: 64, laedt: 'nein' } }),
    calendarDraft: (a) => { (window.__nat.drafts = window.__nat.drafts || []).push(a); return lat({ ok: true }); },
    // v0.9 W2: Fake-SAF (System-Dialoge) und Teilen
    saveDocument: (a) => { (window.__nat.saved = window.__nat.saved || []).push(a); return lat({ ok: true, name: a.name }); },
    openTextDocument: () => { window.__nat.calls.push('openTextDocument'); return lat(CFG.pickFile || { ok: false, cancelled: true }); },
    // v0.9 Stufe 0: Start über Kachel/Verknüpfung (einmal abholbar) + Ereignis bei laufender App
    consumeListenLaunch: () => { const r = window.__nat.listenPending || { listen: false, opened: false }; window.__nat.listenPending = null; return lat(r); },
    pinListenShortcut: rec('pinListenShortcut', { ok: true }),
    requestAddListenTile: rec('requestAddListenTile', { ok: true }),
    shareTextFile: (a) => { (window.__nat.shared = window.__nat.shared || []).push(a); return lat({ ok: true }); },
    stopSpeaking: rec('stopSpeaking', {}),
    listVoices: rec('listVoices', { voices: [{ id: 'de-de-x-deb-local', name: 'de-de-x-deb-local', lang: 'de-DE', default: true }] }),
    // v0.9.4: Termin-Hinweise (Status, Test) + Sync-Inhalt mitschreiben
    syncBriefing: (a) => { (window.__nat.syncs = window.__nat.syncs || []).push(JSON.parse(a.json)); return lat({}); },
    getEventReminderStatus: () => { window.__nat.calls.push('getEventReminderStatus'); return lat({ enabled: true, leadMin: 15, calendar: CFG.evCal || 'denied', notifications: true, exact: false, nextAt: CFG.evNext || 0 }); },
    testEventReminder: rec('testEventReminder', { ok: true }),
    getUpdateStatus: rec('getUpdateStatus', { enabled: true, intervalHours: 6, wifiOnly: false, status: 'up-to-date', installedVersionName: '0.5', installedVersionCode: 5, notificationsAllowed: true }),
    __emitListen: (o) => { window.__nat.listenPending = o; (st.cbs.listenLaunch || []).forEach((cb) => cb({ listen: !!o.listen })); },
    addListener: (name, cb) => { (st.cbs[name] = st.cbs[name] || []).push(cb); return { remove() {} }; }
  };
  const J = new Proxy(base, { get: (t, k) => (k in t ? t[k] : rec(String(k), {})) });
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    Plugins: { JarvisNative: J,
      // v0.9 W4: Fake-LocalNotifications (Erlaubnis, Kanal, planen, löschen, genaue Alarme)
      LocalNotifications: {
        checkPermissions: () => lat({ display: 'prompt' }),
        requestPermissions: () => lat({ display: 'granted' }),
        createChannel: (c) => { (window.__nat.channels = window.__nat.channels || []).push(c); return lat({}); },
        schedule: (o) => { (window.__nat.scheduled = window.__nat.scheduled || []).push(...o.notifications); return lat({ notifications: o.notifications.map((n) => ({ id: n.id })) }); },
        cancel: (o) => { (window.__nat.cancelled = window.__nat.cancelled || []).push(...o.notifications.map((n) => n.id)); return lat({}); },
        checkExactNotificationSetting: () => lat({ exact_alarm: CFG.exact || 'denied' }),
        changeExactNotificationSetting: () => { window.__nat.calls.push('changeExact'); return lat({ exact_alarm: 'granted' }); }
      },
      SpeechRecognition: { requestPermissions: () => lat({ speechRecognition: 'granted' }) }, Preferences: { keys: () => lat({ keys: [] }), get: () => lat({ value: null }), set: () => lat({}), remove: () => lat({}) } }
  };
  // Android-WebView hat kein speechSynthesis – Aufrufe hier wären der Fehler (Web-Adapter)
  try {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak: (u) => window.__nat.web.push(u && u.text), cancel() {}, pause() {}, resume() {},
      getVoices: () => [], addEventListener() {}, speaking: false, pending: false
    } });
  } catch (e) {}
})();
"""

def safe(fn, *a, **k):
    try:
        fn(*a, **k); return True
    except Exception as e:
        print("INFO Aktion fehlgeschlagen:", str(e).splitlines()[0])
        return False

def open_groups(page):
    """v0.9: Einstellungs-Gruppen per Tipp aufklappen (wie am Handy)."""
    for i in range(page.locator("details.set-group").count()):
        d = page.locator("details.set-group").nth(i)
        if not d.evaluate("e => e.open"):
            safe(d.locator("> summary").click, timeout=3000)
    page.wait_for_timeout(150)

def run(pw, *, bridge_ms, file_ms, hang=False, **extra):
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 412, "height": 915}, locale="de-DE", timezone_id="Europe/Berlin")
    ctx.add_init_script(FAKE % json.dumps({"bridgeMs": bridge_ms, "hang": hang, **extra}))
    page = ctx.new_page()
    logs, errs = [], []
    page.on("console", lambda m: logs.append(m.text))
    page.on("pageerror", lambda e: errs.append(str(e)))
    def slow(route):
        if route.request.url.endswith(".js"):
            time.sleep(file_ms / 1000.0)
        route.continue_()
    page.route(BASE + "/**", slow)
    t0 = time.time()
    page.goto(BASE + "/index.html")
    page.wait_for_function("document.querySelector('#btn-send') && [...document.querySelectorAll('.msg')].length > 0", timeout=15000)
    started = time.time() - t0
    return b, page, logs, errs, started

with sync_playwright() as pw:
    # 1) Normaler Start: langsame Bridge (25 ms je Aufruf) + gedrosselte Module (15 ms je Datei)
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=15)
    page.wait_for_timeout(500)
    check("Start: native Adapter aktiv (Log)", any("[Jarvis] Adapter: native" in l for l in logs))
    check("Start: kein Web-Adapter", not any("[Jarvis] Adapter: web" in l for l in logs))
    check("Start: kein Willkommens-Dialog (Persona aus sicherem Speicher)", not page.is_visible("#onboarding"))
    check("Start: Klasse jarvis-native gesetzt", page.evaluate("document.documentElement.classList.contains('jarvis-native')"))
    safe(page.fill, "#input", "Wie spät ist es?", timeout=3000)
    safe(page.click, "#btn-send", timeout=3000)
    try:
        page.wait_for_function("window.__nat.speak.length >= 1", timeout=5000)
    except Exception:
        pass
    nat = page.evaluate("window.__nat")
    check("Antwort: JarvisNative.speak aufgerufen", any("Uhr" in t for t in nat["speak"]))
    before = len(nat["speak"])
    safe(page.click, "#btn-settings", timeout=3000)
    page.wait_for_timeout(400)
    open_groups(page)
    safe(page.click, "#btn-preview", timeout=3000)
    try:
        page.wait_for_function(f"window.__nat.speak.length > {before}", timeout=5000)
    except Exception:
        pass
    nat = page.evaluate("window.__nat")
    check("Vorhören: JarvisNative.speak aufgerufen", len(nat["speak"]) > before)
    check("Kein speechSynthesis-Aufruf", nat["web"] == [])
    check("Keine JS-Fehler (normaler Start)", not errs)
    errors.extend(errs)
    print("INFO gesprochen:", nat["speak"])
    b.close()

    # 2) Sicherheitsnetz: Bridge hängt → nach ca. 3 s Start mit Web-Adaptern, App bleibt bedienbar
    b, page, logs, errs, started = run(pw, bridge_ms=5, file_ms=0, hang=True)
    page.wait_for_timeout(300)
    check("Hängende Bridge: Start nach Zeitlimit (2,5–8 s)", 2.5 <= started <= 8)
    check("Hängende Bridge: Web-Adapter als Rückfall (Log)", any("[Jarvis] Adapter: web" in l for l in logs))
    check("Hängende Bridge: Oberfläche bedienbar", page.is_visible("#input"))
    check("Hängende Bridge: keine JS-Fehler", not errs)
    errors.extend(errs)
    print(f"INFO Startzeit bei hängender Bridge: {started:.1f} s")
    b.close()

    # 3) Wake-Word: Satz → Antwort wird gesprochen; währenddessen KEIN Start der Erkennung
    b, page, logs, errs, started = run(pw, bridge_ms=10, file_ms=0, wake=True, speakMs=1200, sttMode="manual")
    try:
        page.wait_for_function("window.__stt.starts >= 1 && window.__stt.active", timeout=5000)
    except Exception:
        pass
    check("Wake: Erkennung gestartet (nativ, mit Startton-Unterdrückung)", page.evaluate("window.__stt.starts") == 1 and page.evaluate("window.__stt.mute[0]") is True)
    page.evaluate("window.__stt.emitFinal('Hey Jarvis wie spät ist es')")
    try:
        page.wait_for_function("window.__stt.speakEnds.length >= 1", timeout=6000)
    except Exception:
        pass
    page.wait_for_timeout(1500)
    st = page.evaluate("({ starts: __stt.starts, overlaps: __stt.overlaps, during: __stt.startsDuringSpeak, times: __stt.times, ends: __stt.speakEnds, spoken: __nat.speak })")
    check("Wake: Befehl ausgeführt und gesprochen", any("Uhr" in t for t in st["spoken"]))
    check("Wake: kein Start der Erkennung während Jarvis spricht", st["during"] == 0)
    gap = (st["times"][-1] - st["ends"][0]) if st["ends"] and len(st["times"]) >= 2 else -1
    check("Wake: nach dem Sprechen wieder zuhören (mit Nachhall-Pause ≥ 600 ms)", st["starts"] == 2 and gap >= 600)
    # Hintergrund-Dienst liest vor → Erkennung zu, danach wieder auf
    c0 = page.evaluate("__stt.cancels")
    page.evaluate("__stt.bgSpeech(true)")
    page.wait_for_timeout(1500)
    bg = page.evaluate("({ cancels: __stt.cancels, during: __stt.startsDuringBg, active: __stt.active })")
    check("Wake: Hintergrund-Vorlesen pausiert die Erkennung", bg["cancels"] > c0 and bg["during"] == 0 and not bg["active"])
    page.evaluate("__stt.bgSpeech(false)")
    page.wait_for_timeout(1200)
    check("Wake: nach Hintergrund-Vorlesen wieder zuhören", page.evaluate("__stt.active") is not None and page.evaluate("__stt.starts") == 3)
    # Mikrofon-Knopf: eigene Erkennung, Wake-Word ruht; Startton bleibt hörbar
    safe(page.click, "#btn-mic", timeout=3000)
    page.wait_for_timeout(400)
    mic = page.evaluate("({ starts: __stt.starts, mute: __stt.mute, overlaps: __stt.overlaps })")
    check("Mikrofon-Knopf: nutzt dieselbe Erkennung ohne Überlappen, Startton nicht unterdrückt",
          mic["starts"] == 4 and mic["mute"][-1] is False and mic["overlaps"] == 0)
    check("Wake: keine JS-Fehler", not errs)
    errors.extend(errs)
    print("INFO Wake-Starts:", [round(t) for t in st["times"]], "Sprechende:", [round(t) for t in st["ends"]])
    b.close()

    # 4) Stille und Fehler: Pausen wachsen statt Dauer-Neustart (früher alle ~0,35 s ein neuer Start/Ton)
    b, page, logs, errs, started = run(pw, bridge_ms=10, file_ms=0, wake=True, sttMode="silence", segMs=300)
    page.wait_for_timeout(500)
    s0 = page.evaluate("__stt.starts")
    page.wait_for_timeout(8000)
    s1 = page.evaluate("__stt.starts")
    check(f"Stille: wenige Neustarts in 8 s ({s1 - s0}, erwartet ≤ 6)", 1 <= s1 - s0 <= 6)
    check("Stille: nie zwei Erkennungen gleichzeitig", page.evaluate("__stt.overlaps") == 0)
    page.evaluate("__stt.mode = 'busy'")
    page.wait_for_timeout(4000)
    s2 = page.evaluate("__stt.starts")
    page.wait_for_timeout(8000)
    s3 = page.evaluate("__stt.starts")
    check(f"Fehler: exponentielles Warten ({s3 - s2} Starts in 8 s, erwartet ≤ 2)", s3 - s2 <= 2)
    check("Fehler: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

    # 5) v0.8: Gedächtnis aus dem sicheren Speicher, Merken schreibt verschlüsselt, Website erst nach Ja
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, memory=["Ich streame dienstags um 20 Uhr"])
    page.wait_for_timeout(400)
    def nask(text, wait=900):
        safe(page.fill, "#input", text, timeout=3000)
        safe(page.click, "#btn-send", timeout=3000)
        page.wait_for_timeout(wait)
        return page.locator(".msg.assistant").last.inner_text()
    r = nask("Was weißt du über mich?")
    check("Gedächtnis: beim Start aus dem sicheren Speicher geladen", "dienstags um 20 Uhr" in r)
    nask("Merk dir, dass ich grünen Tee mag")
    page.wait_for_timeout(300)
    stored = page.evaluate("window.__secure['jarvis.memory'] || ''")
    check("Gedächtnis: Merken schreibt in den sicheren Speicher (secureSet)", "Ich mag grünen Tee" in stored and "dienstags" in stored)
    r = nask("Öffne example.com/seite?x=1")
    card = page.locator(".confirm-card:not(.confirm-done)").last
    ctext = card.inner_text() if card.count() else ""
    check("Website: Karte mit Domain + voller Adresse, vorher kein openUrl",
          "example.com" in ctext and "https://example.com/seite?x=1" in ctext and page.evaluate("window.__nat.opened") == [])
    nask("ja")
    check("Website: nach „Ja“ genau einmal JarvisNative.openUrl", page.evaluate("window.__nat.opened") == ["https://example.com/seite?x=1"])
    # Wecker (Fehler bis v0.7: Jarvis verschwand, kein Wecker): ohne Uhrzeit nachfragen, dann stellen, App bleibt sichtbar
    r = nask("Stell mir einen Wecker")
    check("Wecker: ohne Uhrzeit fragt Jarvis nach (kein Timer)", "Für wie viel Uhr" in r and not page.evaluate("window.__nat.alarms || []"))
    r = nask("halb acht")
    check("Wecker: nach der Antwort JarvisNative.setAlarm mit 7:30, Ansage, Jarvis bleibt sichtbar",
          page.evaluate("window.__nat.alarms") == [{"hour": 7, "minute": 30, "message": "Jarvis Wecker"}]
          and "7:30 Uhr gestellt" in r and page.is_visible("#input")
          and any("7:30 Uhr gestellt" in t for t in page.evaluate("window.__nat.speak")))
    check("Gedächtnis/Website/Wecker: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, alarmFail=True)
    page.wait_for_timeout(400)
    r = nask("Stell einen Wecker auf 6 Uhr")
    check("Wecker: Fehler der Uhr-App wird klar angesagt (ohne Klammern)", "konnte ich leider nicht stellen: Keine Uhr-App" in r and "(" not in r)
    errors.extend(errs)
    b.close()
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, alarmOpened=True)
    page.wait_for_timeout(400)
    r = nask("stell mir einen Wecker für 4 Uhr morgens")
    check("Wecker-Ersatzweg: Uhr-App mit 4 Uhr geöffnet, ehrlicher Hinweis auf „Speichern“",
          page.evaluate("window.__nat.alarms") == [{"hour": 4, "minute": 0, "message": "Jarvis Wecker"}]
          and "bitte tippen Sie dort auf „Speichern“" in r and "gestellt." not in r)
    errors.extend(errs)
    b.close()

    # 6) v0.9 W1: Apps starten – eindeutig sofort, mehrdeutig per Auswahlkarte, nur Paketnamen an Java
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5)
    page.wait_for_timeout(400)
    r = nask("Öffne Instagram")
    check("Apps: „Öffne Instagram“ → launchPackage(com.instagram.android) ohne Karte",
          page.evaluate("window.__nat.launched") == ["com.instagram.android"] and "Ich öffne Instagram" in r)
    r = nask("Öffne Notes")
    card = page.locator(".choice-card:not(.confirm-done)").last
    btns = card.locator(".confirm-choice")
    check("Apps: „Öffne Notes“ → Auswahlkarte mit 2 Apps + Paketnamen, noch kein Start",
          btns.count() == 2 and "com.google.android.keep" in card.inner_text() and page.evaluate("window.__nat.launched.length") == 1)
    safe(btns.nth(1).click, timeout=3000)
    page.wait_for_timeout(600)
    check("Apps: Tipp auf „2. Google Notizen“ startet genau dieses Paket",
          page.evaluate("window.__nat.launched") == ["com.instagram.android", "com.google.android.keep"])
    r = nask("Öffne a")
    check("Apps: zu kurzer Name → kein Start, klare Antwort", "Welche App" in r and page.evaluate("window.__nat.launched.length") == 2)
    check("Apps: Launcher-Liste nur einmal pro Sitzung geladen", page.evaluate("window.__nat.calls.filter((c) => c === 'listLaunchableApps').length") == 1)
    check("Apps: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

    # 7) v0.9 W2: Dateien über Fake-SAF – Export nach „Ja“, Lesen ohne Karte (der Dialog ist die Wahl), Teilen
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, pickFile={"ok": True, "name": "liste.txt", "mime": "text/plain", "size": 12, "text": "Milch\nEier"})
    page.wait_for_timeout(400)
    nask("Notiere Brot kaufen")
    r = nask("Speichere meine Notizen als Datei")
    check("Dateien: Export-Karte, vorher kein saveDocument", "als Datei speichern" in r and not page.evaluate("window.__nat.saved || []"))
    nask("ja")
    saved = page.evaluate("window.__nat.saved || []")
    check("Dateien: nach „Ja“ saveDocument mit Name/Typ/Inhalt", len(saved) == 1 and saved[0]["name"].startswith("jarvis-notizen-")
          and saved[0]["mime"] == "text/plain" and "Brot kaufen" in saved[0]["text"])
    r = nask("Lies mir eine Datei vor")
    check("Dateien: openTextDocument direkt, Inhalt angezeigt", "openTextDocument" in page.evaluate("window.__nat.calls") and "Milch" in r and "liste.txt" in r)
    nask("Teile meine Notizen als Datei")
    sh = page.evaluate("window.__nat.shared || []")
    check("Dateien: shareTextFile mit .txt", len(sh) == 1 and sh[0]["name"].endswith(".txt"))
    check("Dateien: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

    # 8) v0.9 W4: Erinnerungen über Fake-LocalNotifications (Kanal reminder_v1, ehrlicher Hinweis ohne Freigabe)
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5)
    page.wait_for_timeout(400)
    r = nask("Erinnere mich in 2 Stunden an den Ofen")
    check("Erinnerung: Vorlesen + „richtig?“, noch nichts geplant", "richtig?" in r and not page.evaluate("window.__nat.scheduled || []"))
    t0 = page.evaluate("Date.now()")
    r = nask("ja")
    sch = page.evaluate("window.__nat.scheduled || []")
    ch = page.evaluate("window.__nat.channels || []")
    ok_time = bool(sch) and abs(page.evaluate("(s) => Date.parse(s)", sch[0]["schedule"]["at"]) - (t0 + 2 * 3600000)) < 120000
    check("Erinnerung: schedule mit Kanal reminder_v1, Text, Zeit ≈ in 2 h, allowWhileIdle",
          len(sch) == 1 and sch[0]["channelId"] == "reminder_v1" and sch[0]["body"] == "Ofen" and ok_time and sch[0]["schedule"]["allowWhileIdle"] is True
          and any(c["id"] == "reminder_v1" for c in ch))
    check("Erinnerung: ohne Freigabe genauer Alarme ehrlicher Hinweis", "Erinnerung gestellt" in r and "nicht freigegeben" in r)
    nask("Lösche die Erinnerung an den Ofen")
    check("Erinnerung: Löschen ruft cancel mit derselben ID", page.evaluate("window.__nat.cancelled || []") == [sch[0]["id"]] if sch else False)
    check("Erinnerung: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

    # 9) v0.9 W5: Medien, Lautstärke %, Gerätestatus, Kalender-Entwurf, Notizen löschen
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5)
    page.wait_for_timeout(400)
    nask("Pause"); nask("nächstes Lied")
    check("Medien: mediaKey pause → naechster", page.evaluate("window.__nat.media || []") == ["pause", "naechster"])
    r = nask("Lautstärke auf 30 Prozent")
    check("Lautstärke: setVolumePercent(30) + Ansage", page.evaluate("window.__nat.volume || []") == [30] and "30 Prozent" in r)
    r = nask("Bin ich im WLAN?")
    check("Gerätestatus: alle Felder, „unbekannt“ statt Fehler", "WLAN: verbunden" in r and "Bluetooth: unbekannt" in r and "Akku: 64 %" in r)
    r = nask("Trag morgen um 15 Uhr Zahnarzt ein")
    check("Kalender: Karte vor dem Entwurf", "Zahnarzt" in r and not page.evaluate("window.__nat.drafts || []"))
    nask("ja")
    d = page.evaluate("window.__nat.drafts || []")
    check("Kalender: calendarDraft mit Titel und Beginn/Ende (1 h)", len(d) == 1 and d[0]["title"] == "Zahnarzt" and d[0]["end"] - d[0]["begin"] == 3600000)
    nask("Notiere Brot kaufen"); nask("Notiere Milch holen")
    r = nask("Lösche alle Notizen")
    check("Notizen: „alle“ nur mit Karte", "2 Notizen" in r and page.locator(".confirm-card:not(.confirm-done)").count() >= 1)
    nask("ja")
    r = nask("Rückgängig")
    check("Notizen: Rückgängig holt beide zurück", "2 Notizen sind wieder da" in r)
    check("W5: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

    # 10) v0.9 Stufe 0: „Jarvis fragen“ – Kachel/Verknüpfung hört sofort zu, normaler Start nur mit Schalter
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, sttMode="manual", listenLaunch={"listen": True, "opened": False})
    page.wait_for_timeout(1500)
    check("Jarvis fragen: Start über Kachel → Erkennung läuft sofort (ohne Wake-Word)",
          page.evaluate("__stt.starts") == 1 and page.evaluate("__stt.active") is not None)
    page.evaluate("__stt.emitFinal('Wie spät ist es')")
    page.wait_for_timeout(900)
    check("Jarvis fragen: Frage wird beantwortet", any("Uhr" in t for t in page.evaluate("window.__nat.speak")))
    check("Jarvis fragen: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, sttMode="manual", listenLaunch={"listen": False, "opened": True})
    page.wait_for_timeout(2200)
    check("Normaler Start ohne Schalter: kein Zuhören", page.evaluate("__stt.starts") == 0)
    page.evaluate("window.Capacitor.Plugins.JarvisNative.__emitListen({ listen: true, opened: false })")
    page.wait_for_timeout(800)
    check("Laufende App: Kachel-Tipp (Ereignis) → Erkennung startet", page.evaluate("__stt.starts") == 1)
    safe(page.click, "#btn-settings", timeout=3000)
    page.wait_for_timeout(300)
    open_groups(page)
    safe(page.click, "#btn-listen-tile", timeout=3000)
    safe(page.click, "#btn-listen-pin", timeout=3000)
    page.wait_for_timeout(400)
    calls = page.evaluate("window.__nat.calls")
    check("Einstellungen: Kachel- und Verknüpfungs-Knopf rufen das Plugin", "requestAddListenTile" in calls and "pinListenShortcut" in calls)
    check("Einstellungen: Anleitung mit Seitentaste/Bixby/Hey Google", page.locator("#listen-guide-list li").count() >= 5)
    errors.extend(errs)
    b.close()
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5, sttMode="manual", listenOnOpen=True, listenLaunch={"listen": False, "opened": True})
    page.wait_for_timeout(2600)
    check("Normaler Start mit „Beim Öffnen sofort zuhören“: Erkennung startet", page.evaluate("__stt.starts") == 1)
    errors.extend(errs)
    b.close()

    # 11) v0.9: Einstellungs-Menü in der App – native Bereiche erreichbar, genaue Alarme, Updates-Gruppe, Vorschau gesperrt
    b, page, logs, errs, started = run(pw, bridge_ms=25, file_ms=5)
    page.wait_for_timeout(500)
    safe(page.click, "#btn-settings", timeout=3000)
    page.wait_for_timeout(400)
    open_groups(page)
    page.wait_for_timeout(500)
    unreach = page.evaluate("""() => [...document.querySelectorAll('#settings-form input, #settings-form select, #settings-form button')]
      .filter((el) => !el.closest('.web-only, .hidden, details:not([open]) > :not(summary)')).filter((el) => !el.getClientRects().length).map((el) => el.id || el.tagName)""")
    check("App-Einstellungen: alle Bedienelemente (auch nur-App) erreichbar", unreach == [])
    if unreach: print("INFO nicht erreichbar:", unreach)
    check("App-Einstellungen: Startton-Schalter unter „Sprache & Wake-Word“", page.locator("#grp-speech #set-wake-mute").is_visible())
    check("App-Einstellungen: App-Updates in der Gruppe „Updates“", page.locator("#grp-updates #upd-fieldset").count() == 1)
    check("App-Einstellungen: genaue Erinnerungen „nicht freigegeben“ + Knopf", "nicht freigegeben" in page.inner_text("#exact-status") and page.is_visible("#btn-exact"))
    safe(page.click, "#btn-exact", timeout=3000)
    page.wait_for_timeout(1200)
    check("App-Einstellungen: Knopf öffnet „Wecker & Erinnerungen“", "changeExact" in page.evaluate("window.__nat.calls"))
    check("App-Einstellungen: Benachrichtigungen lesen gesperrt, kein Plugin-Aufruf dazu",
          page.evaluate("[...document.querySelectorAll('#notif-fieldset input')].every((i) => i.disabled)")
          and not any("otif" in c and "Listener" in c for c in page.evaluate("window.__nat.calls")))
    # v0.9.4 Termin-Hinweise: Bereich in „Werkzeuge & Berechtigungen“, Status, Erlaubnis beim Einschalten, Test, Sync
    check("App-Einstellungen: Termin-Hinweise in „Werkzeuge & Berechtigungen“ (an, 15 Min., Vorlesen aus)",
          page.locator("#grp-tools #set-ev-enabled").is_visible() and page.is_checked("#set-ev-enabled")
          and page.input_value("#set-ev-lead") == "15" and not page.is_checked("#set-ev-speak"))
    check("App-Einstellungen: Termin-Status ohne Kalender-Erlaubnis + Knopf", "Kalender-Erlaubnis" in page.inner_text("#ev-status") and page.is_visible("#btn-ev-cal"))
    page.uncheck("#set-ev-enabled"); page.check("#set-ev-enabled"); page.wait_for_timeout(400)
    check("App-Einstellungen: Einschalten fragt nach dem Kalender", "getCalendarEvents" in page.evaluate("window.__nat.calls"))
    safe(page.click, "#btn-ev-test", timeout=3000); page.wait_for_timeout(300)
    check("App-Einstellungen: Test-Hinweis über das Plugin", "testEventReminder" in page.evaluate("window.__nat.calls"))
    page.select_option("#set-ev-lead", "30"); page.check("#set-ev-speak")
    page.check("#set-wake-mute") if not page.is_checked("#set-wake-mute") else page.uncheck("#set-wake-mute")
    want = page.is_checked("#set-wake-mute")
    safe(page.click, ".settings-save .btn", timeout=3000)
    page.wait_for_timeout(600)
    stored = page.evaluate("JSON.parse(window.__secure['jarvis.settings'] || 'null')")
    check("App-Einstellungen: Speichern übernimmt den Schalter (sicherer Speicher), Schlüssel bleibt",
          bool(stored) and stored.get("wakeMuteBeep") == want and stored.get("apiKeys", {}).get("gemini") == "test-key")
    syncs = page.evaluate("window.__nat.syncs || []")
    check("App-Einstellungen: Termin-Hinweise gespeichert und an den nativen Teil übergeben",
          stored and stored.get("eventReminders") == {"enabled": True, "leadMin": 30, "speak": True}
          and bool(syncs) and syncs[-1].get("events") == {"enabled": True, "leadMin": 30, "speak": True})
    # v0.9.5 Morgen-Impuls: Schalter in „Morgen-Briefing & Abend“, Standard an
    check("App-Einstellungen: Morgen-Impuls-Schalter in „Morgen-Briefing & Abend“ (an)",
          page.locator("#grp-briefing #set-brief-impulse").count() == 1 and page.is_checked("#set-brief-impulse"))
    check("App-Einstellungen: keine JS-Fehler", not errs)
    errors.extend(errs)
    b.close()

httpd.shutdown()
if tmp:
    shutil.rmtree(tmp, ignore_errors=True)
print("\nJS-Fehler:", errors or "keine")
failed = [n for n, ok in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} bestanden")
sys.exit(1 if failed or errors else 0)
