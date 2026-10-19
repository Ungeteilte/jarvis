"""Headless-Browsertest: startet keinen Server selbst – vorher
   python3 -m http.server 8080  im Projektordner starten.
Aufruf: python3 tools/browser_test.py [URL]
"""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/index.html"
SHOTS = Path(__file__).resolve().parent.parent / "screenshots"
SHOTS.mkdir(exist_ok=True)
errors, results = [], []

def check(name, cond):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2.625, is_mobile=True, has_touch=True,
                              locale="de-DE", timezone_id="Europe/Berlin",
                              user_agent="Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")
    # Zählt speechSynthesis.speak-Aufrufe (headless gibt es oft keine Stimmen)
    ctx.add_init_script("""
      window.__speakCalls = [];
      if (window.speechSynthesis) {
        const orig = speechSynthesis.speak.bind(speechSynthesis);
        speechSynthesis.speak = (u) => { window.__speakCalls.push({ text: u.text, rate: u.rate, pitch: u.pitch, voice: u.voice && u.voice.name }); try { orig(u); } catch (e) {} };
      }
    """)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))

    # Mock der xAI-API (kein echter Schlüssel nötig)
    sent = {}
    def fake_api(route):
        sent["body"] = json.loads(route.request.post_data or "{}")
        sent["auth"] = route.request.headers.get("authorization")
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                      body=json.dumps({"choices": [{"message": {"content": "Selbstverständlich, Sir. Hier ist ein Witz."}}]}))
    page.route("https://api.x.ai/**", fake_api)

    # 1) Erster Start → Onboarding
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    check("Onboarding-Dialog beim ersten Start", page.is_visible("#onboarding"))
    page.screenshot(path=str(SHOTS / "onboarding.png"))
    page.fill("#ob-name", "Jarvis")
    page.click("#ob-done")
    page.wait_for_timeout(300)
    check("Onboarding geschlossen", not page.is_visible("#onboarding"))

    # 2) Lokale Skills
    def ask(text, wait=600):
        page.fill("#input", text)
        page.click("#btn-send")
        page.wait_for_timeout(wait)
        return page.locator(".msg.assistant").last.inner_text()

    check("Uhrzeit-Skill", "Uhr" in ask("Wie spät ist es?"))
    check("Datum-Skill", "Heute ist" in ask("Welches Datum haben wir?"))
    check("Timer-Skill", "gestellt" in ask("Stell einen Timer auf 5 Minuten"))
    page.wait_for_timeout(1200)
    check("Timer-Anzeige sichtbar", page.is_visible("#timer-chip"))
    ask("Merke dir, dass das Auto in der Tiefgarage steht")
    check("Notiz-Skill", "Tiefgarage" in ask("Was habe ich mir gemerkt?"))
    check("Ohne Schlüssel: Hinweis", "API-Schlüssel" in ask("Erzähl mir einen Witz"))
    page.reload(); page.wait_for_load_state("networkidle")
    check("Verlauf nach Neuladen erhalten", page.locator(".msg").count() >= 10)
    check("Timer nach Neuladen erhalten", page.wait_for_selector("#timer-chip:not(.hidden)", timeout=3000) is not None)
    ask("Timer stoppen")

    # Hauptbildschirm-Screenshot (mit Beispielverlauf)
    page.screenshot(path=str(SHOTS / "main.png"))

    # 3) Einstellungen: Name + Schlüssel
    page.click("#btn-settings")
    page.wait_for_timeout(400)
    check("Einstellungen sichtbar", page.is_visible("#view-settings"))
    page.screenshot(path=str(SHOTS / "settings.png"))
    page.evaluate("document.querySelector('.settings-form').scrollTop = 99999")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "settings-bottom.png"))
    page.select_option("#set-provider", "openai")
    check("OpenAI-Modell-Platzhalter", page.get_attribute("#set-model", "placeholder") == "gpt-6-luna")
    page.select_option("#set-provider", "custom")
    check("Basis-URL-Feld bei eigener URL", page.is_visible("#row-baseurl"))
    page.select_option("#set-provider", "xai")
    page.fill("#set-apikey", "xai-test-123")
    page.fill("#set-name", "Friday")
    page.fill("#set-pitch", "1.2")
    page.wait_for_timeout(1600)  # Stimmenliste wird asynchron geladen
    voice_opts = page.eval_on_selector_all("#set-voice option", "os => os.map(o => o.value).filter(Boolean)")
    print(f"INFO verfügbare Stimmen headless: {len(voice_opts)}")
    if voice_opts:
        page.select_option("#set-voice", voice_opts[0])
    check("Stimmen-Auswahl vorhanden", page.locator("#set-voice option").count() >= 1)
    before = page.evaluate("window.__speakCalls.length")
    page.click("#btn-preview")
    page.wait_for_timeout(2500)
    calls = page.evaluate("window.__speakCalls")[before:]
    check("Vorhören ruft speechSynthesis.speak mit Namen auf", any("Ich bin Friday" in c["text"] for c in calls) and all(abs(c["pitch"] - 1.2) < 1e-6 for c in calls))
    page.locator("#set-speak").uncheck()
    page.click("#settings-form button[type=submit]")
    page.wait_for_timeout(400)
    check("Name im Header", page.inner_text("#brand") == "FRIDAY")
    check("Name im Platzhalter", "Friday" in page.get_attribute("#input", "placeholder"))
    check("Name in Chat-Blasen", page.locator(".msg.assistant .who").first.inner_text().lower() == "friday")
    stored = page.evaluate("JSON.parse(localStorage.getItem('jarvis.persona'))")
    check("Persona gespeichert", stored["name"] == "Friday" and abs(stored["pitch"] - 1.2) < 1e-9)

    # 4) KI-Aufruf (gemockt)
    reply = ask("Erzähl mir einen Witz", 1200)
    check("KI-Antwort angezeigt", "Witz" in reply)
    check("KI: Name+Datum im System-Prompt", "Du bist Friday" in sent["body"]["messages"][0]["content"] and "Aktuelles Datum" in sent["body"]["messages"][0]["content"])
    check("KI: Modell grok-4.7 + Bearer", sent["body"]["model"] == "grok-4.7" and sent["auth"] == "Bearer xai-test-123")

    # 5) Wake-Word-Logik im Browser (Kern-Module, simuliertes Transkript)
    wk = page.evaluate("""async () => {
      const { createWakeMatcher } = await import('./js/core/wakeword.js');
      const { createWakeController } = await import('./js/core/wake-controller.js');
      const m = createWakeMatcher('Friday');
      const cmds = []; let h;
      const c = createWakeController({ stt: { startContinuous: (x) => { h = x; return { stop() {} }; } }, getName: () => 'Friday', onCommand: (t) => cmds.push(t) });
      c.enable(); h.onFinal('Hey Friday wie spät ist es'); h.onFinal('Hey Jarvis welches Datum'); c.disable();
      return { a: m('hey friday, merke dir Milch'), b: m('Hey Jarvis'), cmds };
    }""")
    check("Wake-Word 'Hey Friday' erkannt + Befehl", wk["a"]["matched"] and wk["a"]["command"] == "merke dir Milch")
    check("Alter Name 'Jarvis' löst nicht mehr aus", not wk["b"]["matched"] and wk["cmds"] == ["wie spät ist es"])

    # 6) PWA-Grundlagen
    page.wait_for_timeout(500)
    check("Service Worker aktiv", page.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)"))
    print("INFO SW-Scope:", page.evaluate("navigator.serviceWorker.getRegistration().then(r => r && r.scope)"))
    check("Manifest verlinkt", page.evaluate("fetch('manifest.json').then(r => r.json()).then(m => m.icons.length === 3)"))
    check("Wake-Word-Chip bedienbar", page.is_visible("#btn-wake"))

    if not URL.startswith("http://localhost"):
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "pages-live.png"))
        print("INFO Screenshot:", SHOTS / "pages-live.png")
    browser.close()

print("\nJS-Fehler:", errors or "keine")
failed = [n for n, ok in results if not ok]
print(f"{len(results) - len(failed)}/{len(results)} bestanden")
sys.exit(1 if failed or errors else 0)
