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
    def fake_xai(route):
        if route.request.method == "GET" and "/models" in route.request.url:
            route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                          body=json.dumps({"data": [{"id": "grok-4.7"}, {"id": "grok-loaded-extra"}]}))
            return
        body = json.loads(route.request.post_data or "{}")
        last = (body.get("messages") or [{}])[-1].get("content") or ""
        if body.get("stream") and "Live" in last:
            sent["stream_body"] = body
            words = ["Guten ", "Abend, ", "Sir. ", "Das ist ", "eine ", "Live-Antwort. ", "Satz ", "drei!"]
            sse = "".join("data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": w}}]}) + "\n\n" for w in words) + "data: [DONE]\n\n"
            route.fulfill(status=200, content_type="text/event-stream", headers={"access-control-allow-origin": "*"}, body=sse)
            return
        fake_api(route)
    page.route("https://api.x.ai/**", fake_xai)
    gem = {}
    def fake_gemini(route):
        if route.request.method == "GET" and "/models" in route.request.url:
            route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                          body=json.dumps({"data": [{"id": "gemini-3.8-flash"}, {"id": "gemini-3.6-flash"}]}))
            return
        gem["url"] = route.request.url
        gem["body"] = json.loads(route.request.post_data or "{}")
        gem["auth"] = route.request.headers.get("authorization")
        route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                      body=json.dumps({"choices": [{"message": {"content": "Gemini meldet sich zum Dienst."}}]}))
    page.route("https://generativelanguage.googleapis.com/**", fake_gemini)

    # 1) Erster Start → Onboarding
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    check("Onboarding-Dialog beim ersten Start", page.is_visible("#onboarding"))
    check("Onboarding: Gemini vorausgewählt + Schlüssel-Link", page.input_value("#ob-provider") == "gemini"
          and page.get_attribute("#ob-key-hint a", "href") == "https://aistudio.google.com/apikey")
    page.screenshot(path=str(SHOTS / "onboarding.png"))
    page.fill("#ob-name", "Jarvis")
    page.click("#ob-done")
    page.wait_for_timeout(300)
    check("Onboarding geschlossen", not page.is_visible("#onboarding"))
    # Sprachausgabe aus (headless hängt sonst an speechSynthesis)
    page.click("#btn-mute")
    page.wait_for_timeout(200)

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
    page.wait_for_timeout(100)
    opts = page.eval_on_selector_all("#set-model-select option", "os => os.map(o => o.value)")
    check("OpenAI-Modell-Dropdown", "gpt-6-luna" in opts and opts[-1] == "__custom__")
    page.select_option("#set-model-select", "gpt-6-luna")
    check("OpenAI-Modell ausgewählt", page.input_value("#set-model-select") == "gpt-6-luna")
    page.select_option("#set-provider", "gemini")
    gopts = page.eval_on_selector_all("#set-model-select option", "os => os.map(o => o.value)")
    check("Gemini: Modell-Dropdown + Hinweis", "gemini-3.8-flash" in gopts and "keine Kreditkarte" in page.inner_text("#key-hint"))
    page.select_option("#set-model-select", "gemini-3.8-flash")
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

    # Modell per Dropdown + Eigenes Modell speichern
    page.click("#btn-settings"); page.wait_for_timeout(300)
    page.select_option("#set-provider", "xai")
    page.select_option("#set-model-select", "grok-4.6")
    page.click("#settings-form button[type=submit]"); page.wait_for_timeout(300)
    models = page.evaluate("JSON.parse(localStorage.getItem('jarvis.settings')).models")
    check("Modell grok-4.6 gespeichert", models.get("xai") == "grok-4.6")
    page.click("#btn-settings"); page.wait_for_timeout(300)
    page.select_option("#set-model-select", "__custom__")
    check("Eigenes-Modell-Feld sichtbar", page.is_visible("#row-custom-model"))
    page.fill("#set-model-custom", "grok-custom-test")
    page.click("#settings-form button[type=submit]"); page.wait_for_timeout(300)
    models = page.evaluate("JSON.parse(localStorage.getItem('jarvis.settings')).models")
    check("Eigenes Modell gespeichert", models.get("xai") == "grok-custom-test")
    page.click("#btn-settings"); page.wait_for_timeout(200)
    page.select_option("#set-provider", "xai")
    page.click("#btn-loadmodels"); page.wait_for_timeout(800)
    load_opts = page.eval_on_selector_all("#set-model-select option", "os => os.map(o => o.value)")
    check("Laden füllt Dropdown", "grok-loaded-extra" in load_opts)
    # Zurück auf Standard für die folgenden KI-Tests
    page.select_option("#set-model-select", "grok-4.7")
    page.click("#settings-form button[type=submit]"); page.wait_for_timeout(300)

    # 4) KI-Aufruf (gemockt)
    reply = ask("Erzähl mir einen Witz", 1200)
    check("KI-Antwort angezeigt", "Witz" in reply)
    check("KI: Name+Datum im System-Prompt", "Du bist Friday" in sent["body"]["messages"][0]["content"] and "Aktuelles Datum" in sent["body"]["messages"][0]["content"])
    check("KI: Modell grok-4.7 + Bearer", sent["body"]["model"] == "grok-4.7" and sent["auth"] == "Bearer xai-test-123")

    check("KI: stream:true gesendet, JSON-Antwort trotzdem ok", sent["body"].get("stream") is True)

    # 4a) Live-Antwort (SSE-Streaming) + satzweise Sprachausgabe
    page.evaluate("""() => {
      window.__streamSteps = 0; window.__sawStreaming = false;
      new MutationObserver((recs) => {
        for (const r of recs) {
          const m = r.target.closest ? r.target.closest('.msg') : r.target.parentElement && r.target.parentElement.closest('.msg');
          if (m && m.classList.contains('streaming')) { window.__streamSteps++; window.__sawStreaming = true; }
        }
      }).observe(document.querySelector('#chat'), { childList: true, subtree: true, characterData: true });
      window.__speakCalls = [];
    }""")
    page.click("#btn-mute"); page.wait_for_timeout(150)  # Sprachausgabe kurz an
    reply = ask("Bitte eine Live-Antwort", 1500)
    try:
        page.wait_for_function("window.__speakCalls.length >= 1", timeout=6000)
    except Exception:
        pass
    spoken = page.evaluate("window.__speakCalls.map(c => c.text)")
    page.click("#btn-mute"); page.wait_for_timeout(150)  # wieder stumm
    check("Live: gestreamte Antwort vollständig", reply.strip().endswith("Guten Abend, Sir. Das ist eine Live-Antwort. Satz drei!"))
    check("Live: Blase wuchs schrittweise", page.evaluate("window.__sawStreaming") and page.evaluate("window.__streamSteps") >= 4)
    check("Live: Blase abgeschlossen", page.locator(".msg.streaming").count() == 0)
    check("Live: Satzweise Sprachausgabe (erster Satz einzeln)", len(spoken) >= 1 and spoken[0] == "Guten Abend, Sir.")
    print("INFO gesprochene Sätze:", spoken)
    check("Live: nur eine Antwort-Blase", page.locator(".msg.assistant", has_text="Live-Antwort").count() == 1)

    # 4b) Gemini als Anbieter (gemockt)
    page.click("#btn-settings"); page.wait_for_timeout(300)
    page.select_option("#set-provider", "gemini")
    page.fill("#set-apikey", "fake-gemini-key")
    page.click("#settings-form button[type=submit]"); page.wait_for_timeout(300)
    check("Gemini-Antwort angezeigt", "Gemini meldet sich" in ask("Was ist ein schwarzes Loch?", 1200))
    check("Gemini: Endpunkt, Modell, Bearer", gem.get("url") == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
          and gem["body"]["model"] == "gemini-3.8-flash" and gem["auth"] == "Bearer fake-gemini-key"
          and "Du bist Friday" in gem["body"]["messages"][0]["content"])
    page.click("#btn-settings"); page.wait_for_timeout(300)
    page.select_option("#set-provider", "xai")
    check("xAI-Schlüssel nach Anbieterwechsel noch da", page.input_value("#set-apikey") == "xai-test-123")
    page.click("#btn-back"); page.wait_for_timeout(200)

    # 4c) Handy-Werkzeuge (lokale Trigger + Bestätigungskarte)
    page.evaluate("""() => {
      window.__opened = [];
      document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        if (/^(tel|sms|mailto|https?):/i.test(href)) {
          e.preventDefault(); e.stopPropagation();
          window.__opened.push(href);
        }
      }, true);
    }""")
    reply = ask("Ruf die 01701234567 an", 900)
    check("Anruf: Bestätigungstext", "anrufen" in reply.lower() or "Nummer" in reply)
    check("Anruf: Ja/Nein-Karte", page.locator(".confirm-card .confirm-yes").count() >= 1)
    page.locator(".confirm-card .confirm-yes").last.click()
    page.wait_for_timeout(700)
    check("Nach Ja: Karte erledigt", page.locator(".confirm-card.confirm-done").count() >= 1)
    check("Nach Ja: tel: ausgelöst oder Bestätigung", bool(page.evaluate("window.__opened")) or "öffne" in page.locator(".msg.assistant").last.inner_text().lower())
    clip = ask("Kopiere den Text: Hallo Jarvis Test", 900)
    check("Zwischenablage-Tool", "Zwischenablage" in clip)
    help_txt = ask("Was kannst du?", 900)
    check("Hilfe listet Werkzeuge", "Anrufen" in help_txt and ("WhatsApp" in help_txt or "Navigation" in help_txt or "YouTube" in help_txt))
    ask("Schreib eine SMS an 01709999999: Test", 900)
    page.wait_for_timeout(400)
    page.locator(".confirm-card:not(.confirm-done) .confirm-no").last.click()
    page.wait_for_timeout(500)
    check("Nach Nein: Abbruchtext", "Alles klar" in page.locator(".msg.assistant").last.inner_text() or "ab" in page.locator(".msg.assistant").last.inner_text().lower())

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
