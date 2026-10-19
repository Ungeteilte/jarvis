# 🤖 Jarvis – Ihr persönlicher Sprachassistent (PWA)

Ein deutschsprachiger Assistent im Stil von J.A.R.V.I.S. aus *Iron Man* – als **Progressive Web App**
(läuft im Browser und lässt sich wie eine App auf dem Startbildschirm installieren).
Optimiert für das **Samsung Galaxy A55 5G mit Chrome**.

## Was kann Jarvis?

| Funktion | Beschreibung |
|---|---|
| 💬 Chat | Texteingabe mit Verlauf (bleibt nach dem Schließen erhalten, gespeichert im Browser) |
| 🎙️ Spracheingabe | Mikrofon-Knopf (oder auf die leuchtende Kugel tippen) – Deutsch (de-DE) |
| 🔊 Sprachausgabe | Antworten werden vorgelesen; Lautsprecher-Knopf oben schaltet stumm |
| 👂 Wake-Word | „Hey Jarvis …“ – hört dauerhaft zu, **solange die App offen ist** |
| 🧑 Name & Stimme | Name frei wählbar (z. B. „Friday“) – gilt auch als Wake-Word; Stimme, Tempo, Tonhöhe einstellbar, mit „Vorhören“ |
| 🧠 KI-Gehirn | Google Gemini (kostenlos), xAI (Grok), OpenAI oder eine eigene OpenAI-kompatible Adresse – mit Ihrem eigenen API-Schlüssel |
| ⏰ Ohne KI | Uhrzeit, Datum, Timer, Notizen (funktionieren auch ohne API-Schlüssel) |

### Beispiel-Sätze (funktionieren ohne KI)
- „Wie spät ist es?“ · „Welches Datum haben wir?“
- „Stell einen Timer auf 5 Minuten“ · „Timer auf 1 Stunde und 30 Minuten“ · „Wie lange läuft der Timer noch?“ · „Timer stoppen“
- „Merke dir, dass das Auto in der Tiefgarage steht“ · „Was habe ich mir gemerkt?“ · „Lösche alle Notizen“
- „Was kannst du?“ · „Wie heißt du?“

Alles andere („Erzähl mir einen Witz“, „Was ist ein schwarzes Loch?“) geht an die KI.

---

## 🚀 Kostenlos hosten mit GitHub Pages (Schritt für Schritt)

Das Mikrofon funktioniert im Browser **nur über HTTPS** – GitHub Pages liefert das kostenlos.

1. **GitHub-Konto anlegen:** <https://github.com/signup> (kostenlos).
2. **Neues Repository:** oben rechts **„+“ → „New repository“**.
   Name z. B. `jarvis`, Sichtbarkeit **Public**, auf **„Create repository“** tippen.
3. **Dateien hochladen:** Im neuen Repository auf **„uploading an existing file“** klicken.
   Den **Inhalt** des Ordners `jarvis` (also `index.html`, `manifest.json`, `sw.js` und die Ordner `css`, `js`, `icons` …)
   per Drag & Drop hineinziehen. *Wichtig:* `index.html` muss direkt im Hauptverzeichnis liegen, nicht in einem Unterordner.
   Unten auf **„Commit changes“** klicken.
   *(Tipp: Am PC geht das Hochladen von Ordnern am einfachsten. Auf dem Handy erst die ZIP-Datei am PC entpacken.)*
4. **Pages einschalten:** **Settings → Pages**. Bei *Source* **„Deploy from a branch“** wählen,
   Branch **`main`** und Ordner **`/ (root)`** → **Save**.
5. **1–2 Minuten warten.** Oben erscheint die Adresse, z. B.
   `https://IHR-NAME.github.io/jarvis/` – diese im Handy öffnen.

**Updates:** Geänderte Dateien einfach erneut hochladen. Damit das Handy die neue Version sicher lädt,
in `sw.js` die Zeile `const VERSION = 'jarvis-v4';` hochzählen (`jarvis-v4` …).

*Alternativen:* Netlify, Cloudflare Pages oder Vercel funktionieren genauso (Ordner hochladen, fertig).

---

## 📱 Auf dem Samsung-Startbildschirm installieren

1. Die HTTPS-Adresse in **Chrome** öffnen (nicht im Samsung Internet-Browser – dort fehlt die Spracherkennung).
2. Oben rechts **⋮ (drei Punkte)** → **„App installieren“** bzw. **„Zum Startbildschirm hinzufügen“** → **Installieren**.
3. Jarvis erscheint als App-Symbol auf dem Startbildschirm und startet im Vollbild.
4. Beim ersten Tippen auf das Mikrofon fragt Chrome nach der **Mikrofon-Erlaubnis** → **„Zulassen“ / „Bei Nutzung der App“**.
   Falls versehentlich abgelehnt: Chrome → ⋮ → **Einstellungen → Website-Einstellungen → Mikrofon** → Seite erlauben
   (oder in der App lange auf das Symbol drücken → App-Info → Berechtigungen).
5. Beim ersten Start fragt Jarvis nach **Name und Stimme** – jederzeit änderbar unter ⚙️.

**Tipp für bessere deutsche Stimmen:** Android-Einstellungen → *Allgemeine Verwaltung* → *Sprache* →
*Text-zu-Sprache* → **Google-Sprachausgabe** wählen und dort „Deutsch“ installieren.

---

## 🔑 API-Schlüssel besorgen

Ohne Schlüssel funktionieren nur die lokalen Funktionen (Uhrzeit, Datum, Timer, Notizen).
xAI und OpenAI berechnen pro Nutzung (meist wenige Cent pro Tag) und brauchen Guthaben. **Google Gemini hat einen kostenlosen Tarif.**

**Google Gemini – kostenlos, ideal zum Einstieg**
1. <https://aistudio.google.com/apikey> öffnen und mit dem Google-Konto anmelden.
2. **„API-Schlüssel erstellen“** (Create API key) antippen – **keine Kreditkarte nötig**.
3. Schlüssel kopieren (beginnt meist mit `AIza…`).
4. In Jarvis: ⚙️ → Anbieter **Google Gemini** → Schlüssel einfügen → **Speichern**
   (oder direkt im Willkommens-Dialog beim ersten Start). Modell leer lassen = `gemini-2.5-flash` (bei Überlastung automatisch Fallback).
5. Hinweis: Im kostenlosen Tarif gelten Anfrage-Limits pro Minute/Tag, und Google darf die Eingaben zur
   Verbesserung seiner Produkte nutzen. Für Vertrauliches lieber einen bezahlten Tarif verwenden.
   Bitte die aktuellen Nutzungsbedingungen für Nutzer in der EU in AI Studio prüfen.

**xAI (Grok)**
1. <https://console.x.ai> öffnen und anmelden.
2. Guthaben aufladen (Billing), dann **API Keys → Create API Key**.
3. Schlüssel kopieren (beginnt mit `xai-…`).
4. In Jarvis: ⚙️ → Anbieter **xAI** → Schlüssel einfügen → **Speichern**. Modell leer lassen = `grok-4.7`.

**OpenAI**
1. <https://platform.openai.com/api-keys> → **Create new secret key**.
2. Unter *Billing* Guthaben hinterlegen.
3. In Jarvis: Anbieter **OpenAI** → Schlüssel einfügen. Modell leer lassen = `gpt-6-luna` (günstig und schnell).

**Eigene URL** – für jeden OpenAI-kompatiblen Dienst (z. B. ein eigener Server, LM Studio, Ollama mit HTTPS).
Basis-URL bis einschließlich `/v1` eintragen, z. B. `https://mein-server.de/v1`. Der Server muss CORS erlauben.

Mit **„Laden“** neben dem Modell-Feld holt Jarvis die Liste aller Modelle, die Ihr Schlüssel nutzen darf.
**„Verbindung testen“** schickt eine kurze Testfrage.

🔒 **Datenschutz:** Der Schlüssel wird **nur auf Ihrem Gerät** (im Browser-Speicher `localStorage`) gespeichert und nur an den
gewählten Anbieter gesendet. Trotzdem: Schlüssel nicht weitergeben und bei Verlust des Handys im Anbieter-Konto löschen.
Bei den Anbietern ein **Ausgabenlimit** setzen.

---

## ⚠️ Einschränkungen

- **Wake-Word nur bei offener App und eingeschaltetem Bildschirm.** Browser dürfen im Hintergrund oder bei
  gesperrtem Bildschirm nicht zuhören. (Das wäre erst mit einer nativen Android-App möglich.)
- **Android-Chrome beendet die Spracherkennung regelmäßig** (nach einigen Sekunden Stille). Jarvis startet sie
  automatisch neu. Dabei kann Android jedes Mal einen kurzen **Signalton** abspielen – das ist ein Systemverhalten.
  Abhilfe: Medien-/Systemlautstärke anpassen oder Wake-Word nur bei Bedarf einschalten.
- **Mikrofon nur über HTTPS** (oder `localhost` am PC). Über `http://` oder als lokal geöffnete Datei funktioniert es nicht.
- **Spracherkennung braucht Internet** (Chrome schickt das Audio an Googles Spracherkennung).
- **Samsung Internet / Firefox** unterstützen die Spracherkennung nicht oder nur eingeschränkt → **Chrome** benutzen.
- Während Jarvis spricht, hört das Wake-Word nicht zu (damit er sich nicht selbst „hört“).
- Timer klingeln nur, wenn die App offen ist. Ist ein Timer abgelaufen, während die App zu war, meldet er sich beim nächsten Öffnen.
- Verlauf, Notizen und Einstellungen liegen nur im Browser dieses Geräts. „Browserdaten löschen“ löscht sie auch.

### CORS-Prüfung (Stand Oktober 2026)
Browser-Aufrufe direkt an die APIs wurden geprüft (Preflight-Anfrage mit fremder Herkunft):
- **xAI** `api.x.ai`: erlaubt (`Access-Control-Allow-Origin: *`) ✅
- **OpenAI** `api.openai.com`: erlaubt (spiegelt die Herkunft, erlaubt `authorization`) ✅
- **Google Gemini** `generativelanguage.googleapis.com/v1beta/openai` (OpenAI-kompatibel): erlaubt (spiegelt die Herkunft, erlaubt `authorization`) ✅
- **Eigene URL:** hängt vom Server ab. Meldung „Netzwerkfehler oder vom Anbieter blockiert (CORS)“ → am Server CORS aktivieren.

---


## 🛠️ Werkzeuge (Handy-Steuerung)

Jarvis kann – soweit eine Web-App auf Android Chrome das erlaubt – Ihr Handy steuern.
Die KI entscheidet über **Function Calling** (`tools` / `tool_calls`, OpenAI-kompatibel: xAI, OpenAI, Gemini),
häufige Befehle greifen aber auch **ohne API-Schlüssel** über lokale Erkennung.

| Werkzeug | Beispiel | Android Chrome | Native App später |
|---|---|---|---|
| Anrufen | „Ruf die 0170… an“ | ✅ öffnet Telefon-App nach Ja | – |
| SMS | „Schreib eine SMS an …: Text“ | ✅ öffnet SMS-App nach Ja | – |
| WhatsApp | „WhatsApp an 49170…: Hallo“ | ✅ wa.me nach Ja | – |
| E-Mail | „Schreib eine Mail an …“ | ✅ mailto: nach Ja | – |
| Navigation | „Navigiere zum Hauptbahnhof“ | ✅ Google Maps nach Ja | – |
| YouTube / Spotify | „Such auf YouTube nach …“ | ✅ Suche im Browser/App | – |
| Website | „Öffne wikipedia.org“ | ✅ | – |
| Teilen | „Teile den Text: …“ | ✅ `navigator.share` (sonst Zwischenablage) | – |
| Vibrieren | „Vibriere kurz“ | ✅ | – |
| Akku | „Wie voll ist der Akku?“ | ✅ Battery API | – |
| Standort | „Wo bin ich?“ | ✅ nach Erlaubnis, dann Karte anbieten | Hintergrund-GPS |
| Zwischenablage | „Kopiere …“ | ✅ | – |
| Taschenlampe | „Taschenlampe an“ | ⚠️ oft **nicht** unterstützt (Camera torch) | ✅ geplant |
| Timer / Notizen | „Stell einen Timer…“ / „Merke dir…“ | ✅ | – |

Aktionen, die die App verlassen (Anruf, SMS, WhatsApp, E-Mail, Maps, …), zeigen zuerst eine **Ja/Nein-Karte** im Chat.

### Neues Werkzeug hinzufügen

1. In `js/core/tools/definitions.js` ein Objekt ergänzen: `name`, `description`, `parameters` (JSON-Schema),
   `execute(args, ctx)`, optional `localTriggers` und `userHint`.
2. Plattformzugriff nur über `ctx.device` (Methoden in `js/adapters/web-device.js`, später Android-Adapter).
3. Unit-Test in `tests/tools.test.mjs` schreiben, `npm test` ausführen.
4. In `sw.js` die `VERSION` hochzählen und die neue Datei ggf. in `APP_SHELL` eintragen.

## 🧩 Aufbau des Codes (für den späteren Umbau zur Android-App)

```
index.html          Oberfläche (Hauptansicht, Einstellungen, Willkommens-Dialog)
manifest.json       App-Infos für die Installation
sw.js               Service Worker (Offline-Cache der App-Dateien)
css/style.css       Design (dunkles HUD, leuchtende Kugel)
js/app.js           Verbindet alles miteinander
js/core/            ★ Kern – reine Logik OHNE Browser-Funktionen (wiederverwendbar)
  storage.js          Speicher über austauschbaren Adapter
  settings.js         KI-Anbieter, Schlüssel, Modelle
  persona.js          Name & Stimme (name, voiceId, rate, pitch) + Stimmen-Auswahl mit Fallback
  wakeword.js         Wake-Word-Erkennung („Hey <Name>“), fehlertolerant
  wake-controller.js  Ablauf des Wake-Word-Modus
  skills.js           Uhrzeit, Datum, Timer, Notizen
  timers.js           Timer-Verwaltung
  prompt.js           System-Prompt (Deutsch, Datum/Uhrzeit, Notizen)
  ai.js               OpenAI-kompatibler API-Aufruf
  assistant.js        Entscheidet: Skill → Tool-Trigger → KI+Tools
  tools/              Werkzeug-Registry, Trigger, KI-Schleife, Definitionen
js/adapters/        Browser-Anbindungen (für Android später ersetzen)
  web-storage.js      localStorage
  web-tts.js          Sprachausgabe: listVoices(), speak(text, {voiceId, rate, pitch})
  web-stt.js          Spracherkennung inkl. Auto-Neustart
  web-audio.js        Signaltöne, Vibration
  web-device.js       Handy-Aktionen (tel, Maps, Akku, Standort, …)
js/ui/              Anzeige (view.js, settings-view.js)
tests/              Unit-Tests für den Kern (Node.js)
tools/              Icon-Generator, Browser-Test
```

**Tests ausführen** (Node.js ≥ 20): `npm test` – testet Kern-Logik inkl. Persona und Wake-Word mit eigenen Namen.
**Lokal starten:** `python3 -m http.server 8080` → <http://localhost:8080> (am PC funktioniert dort auch das Mikrofon).
**Icons neu erzeugen:** `python3 tools/make_icons.py` (benötigt Pillow).
**Browser-Test:** `python3 tools/browser_test.py` (benötigt Playwright + Chrome, Server muss laufen).
