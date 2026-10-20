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
  window.__nat = { speak: [], web: [], calls: [] };
  const st = window.__stt = { starts: 0, overlaps: 0, active: null, speaking: 0, bg: false, startsDuringSpeak: 0, startsDuringBg: 0,
    mode: CFG.sttMode || 'silence', segMs: CFG.segMs || 300, times: [], speakEnds: [], mute: [], cancels: 0, cbs: {} };
  const emit = (name, ev) => (st.cbs[name] || []).forEach((cb) => { try { cb(ev); } catch (e) {} });
  st.emitFinal = (text) => { const s = st.active; if (!s) return false; st.active = null; emit('sttEvent', { session: s, type: 'final', text }); return true; };
  st.bgSpeech = (on) => { st.bg = on; emit('backgroundSpeech', { speaking: on }); };
  const secure = {
    'jarvis.persona': JSON.stringify({ name: 'Jarvis', onboarded: true, voiceId: '' }),
    'jarvis.settings': JSON.stringify({ speak: true, provider: 'gemini', apiKeys: { gemini: 'test-key' }, wakeWord: Boolean(CFG.wake) })
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
    stopSpeaking: rec('stopSpeaking', {}),
    listVoices: rec('listVoices', { voices: [{ id: 'de-de-x-deb-local', name: 'de-de-x-deb-local', lang: 'de-DE', default: true }] }),
    getUpdateStatus: rec('getUpdateStatus', { enabled: true, intervalHours: 6, wifiOnly: false, status: 'up-to-date', installedVersionName: '0.5', installedVersionCode: 5, notificationsAllowed: true }),
    addListener: (name, cb) => { (st.cbs[name] = st.cbs[name] || []).push(cb); return { remove() {} }; }
  };
  const J = new Proxy(base, { get: (t, k) => (k in t ? t[k] : rec(String(k), {})) });
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    Plugins: { JarvisNative: J, SpeechRecognition: { requestPermissions: () => lat({ speechRecognition: 'granted' }) }, Preferences: { keys: () => lat({ keys: [] }), get: () => lat({ value: null }), set: () => lat({}), remove: () => lat({}) } }
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

httpd.shutdown()
if tmp:
    shutil.rmtree(tmp, ignore_errors=True)
print("\nJS-Fehler:", errors or "keine")
failed = [n for n, ok in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} bestanden")
sys.exit(1 if failed or errors else 0)
