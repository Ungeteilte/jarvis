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
| ⏰ Ohne KI | Uhrzeit, Datum, Timer, Notizen, Gedächtnis (funktionieren auch ohne API-Schlüssel) |
| 🧠 Gedächtnis (ab v0.8) | „Merk dir, dass …“ – Jarvis merkt sich Fakten über Sie, ansehen/ändern/löschen in den Einstellungen |

### Beispiel-Sätze (funktionieren ohne KI)
- „Wie spät ist es?“ · „Welches Datum haben wir?“
- „Stell einen Timer auf 5 Minuten“ · „Timer auf 1 Stunde und 30 Minuten“ · „Wie lange läuft der Timer noch?“ · „Timer stoppen“
- „Merk dir, dass ich dienstags um 20 Uhr streame“ · „Was weißt du über mich?“ · „Vergiss, dass …“ · „Vergiss das“
- „Notiere: Milch kaufen“ · „Schreib auf: …“ · „Meine Notizen“ · „Lösche die Notiz Milch“ · „Lösche alle Notizen“ (mit Karte) · „Rückgängig“
- „Erinnere mich morgen um 9 an den Arzt“ · „Erinnere mich in 2 Stunden an den Ofen“ · „Welche Erinnerungen habe ich?“ (ab v0.9)
- „Öffne Instagram“ · „Pause“ · „nächstes Lied“ · „Lautstärke auf 30 Prozent“ · „Bin ich im WLAN?“ (ab v0.9)
- „Speichere meine Notizen als Datei“ · „Lies mir eine Datei vor“ · „Trag morgen um 15 Uhr Zahnarzt ein“ (ab v0.9)
- „Antworte kürzer“ · „Duz mich“ · „Weniger Witze“
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
in `sw.js` die Zeile `const VERSION = 'jarvis-v6';` hochzählen (`jarvis-v5` …).

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
   (oder direkt im Willkommens-Dialog beim ersten Start). Modell leer lassen = `gemini-3.8-flash` (bei Überlastung/404 automatisch Retry + Fallback auf verfügbare 3.x-Flash-Modelle).
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

## ⚡ Live-Antworten (Streaming)

Antworten der KI erscheinen **Wort für Wort**, während sie entstehen, und werden
**Satz für Satz** vorgelesen – Jarvis beginnt also zu sprechen, bevor die ganze
Antwort da ist. Technisch: `stream: true` an die OpenAI-kompatiblen Endpunkte
(xAI, OpenAI, Gemini), die Antwort kommt als Server-Sent Events und wird in
`js/core/ai.js` (`askAIStream`) zusammengesetzt – auch Werkzeug-Aufrufe.

- Klappt Streaming nicht (alter Browser, Abbruch mitten in der Antwort, Anbieter
  liefert kein SSE), fällt Jarvis automatisch auf die normale Antwort zurück.
- Wiederholung bei Überlastung (503/429) und Ersatzmodelle (404) gelten weiter.
- Vorbereitet für Mehrgeräte-Sync per WebSocket: `js/core/realtime/` definiert
  das Ereignis-Protokoll (`{v, type, id, room, from, ts, …}` mit `msg`/`delta`/`ack`)
  und einen lokalen Transport, der nichts sendet. Ein Server ist (noch) nicht nötig.

## ☀️ Morgen-Briefing

Beim **ersten Öffnen nach dem Aufwachen** (keine Nutzung seit mindestens 4 Stunden, einstellbar 3–8 h) begrüßt Jarvis Sie mit einem kurzen Tagesüberblick: Wetter am **aktuellen Standort** (Open-Meteo, ohne Schlüssel), Termine (nur Android-App, Kalender nur lesend), Nachrichten der **tagesschau** (RSS; Ressorts wählbar) und Hinweise wie knapper Akku.

- Startet höchstens **einmal pro Tag** (Tag beginnt um 3 Uhr), nie zwischen 23 und 3 Uhr und nur bis zur eingestellten Uhrzeit (Standard 14 Uhr, einstellbar bis 23 Uhr).
- Jederzeit per Sprache: „Guten Morgen“, „Briefing“, „Was steht heute an?“. Einstellungen per Sprache: „Briefing aus/an“, „Nachrichten nur Sport und Wirtschaft“, „alle Nachrichten“, „keine Nachrichten“.
- Im Browser verhindert die Autoplay-Sperre das sofortige Vorlesen – dann erscheint eine Karte „Briefing starten“.
- Datenschutz: Der Standort wird auf ca. 1 km gerundet, nur an Open-Meteo geschickt und **nie an die KI**. Fremde Texte (Schlagzeilen, Termine) werden bereinigt und als reine Daten markiert; das Briefing selbst ruft keine Werkzeuge auf.
- **Android (ab v0.4):** optional „Im Hintergrund bereithalten“ (Standard aus). Dann zeigt Jarvis beim ersten Entsperren am Morgen eine stille Benachrichtigung mit der Kurzfassung und liest sie auf Wunsch vor (nicht bei Anruf, lautlos/Vibration oder „Nicht stören“; Lautstärke wird nie verändert). Die Hintergrund-Kurzfassung entsteht ohne KI und ohne API-Schlüssel.

## 🌙 Abendzusammenfassung (ab v0.6)

Beim **ersten Öffnen am Abend** (Standard ab 19 Uhr, einstellbar 17–22 Uhr, bis 23 Uhr) gibt Jarvis einen kurzen Tagesrückblick: wie oft und zu welchen Themen Sie heute gefragt haben (nur Anzahl und feste Themen, keine Zitate), heute notierte Dinge, abgelaufene Timer – und einen Ausblick auf morgen (erste Termine nur in der Android-App, Wetter morgen, optional Schlagzeilen des Tages mit den gewählten Ressorts). Zum Schluss ein Angebot: „Soll ich Ihnen einen Wecker für morgen stellen …?“ – danach genügt „7 Uhr“ oder „halb sieben“.

- Einmal pro Abend, nicht direkt nach einem Morgen-Briefing, nie beim allerersten Start.
- Per Sprache: „Wie war mein Tag?“, „Tagesrückblick“, „Abendzusammenfassung“; „Abendzusammenfassung aus/an“. Neu: „Stell einen Wecker auf 7 Uhr“ / „Weck mich um halb sieben“ (Uhr-App, nur Android).
- Gleiche Schutzregeln wie beim Briefing: Daten eingezäunt, keine Werkzeuge während des Rückblicks, keine Koordinaten an die KI, ohne Schlüssel eine Vorlage.
- **Android:** mit „Im Hintergrund bereithalten“ zeigt Jarvis beim ersten Entsperren am Abend still „Guten Abend – Ihr Tagesrückblick ist bereit“ (eigener leiser Kanal) und liest auf Wunsch vor (gleiche Sperren wie morgens).

## 🗓️ Wochenrückblick (ab v0.9.3)

**Sonntags** beim ersten Öffnen ab der eingestellten Uhrzeit (Standard 18 Uhr, einstellbar 9–21 Uhr, bis 23 Uhr) gibt Jarvis einen Wochenrückblick: Höhepunkte der letzten sieben Tage (Anzahl der Gespräche, an wie vielen Tagen, feste Themen – keine Zitate; neue Notizen, gemerkte Dinge, erledigte Erinnerungen, abgelaufene Timer) und einen Ausblick auf die neue Woche (Termine der nächsten 7 Tage nur in der Android-App, anstehende Erinnerungen). Zum Schluss: „Soll ich Ihnen für die neue Woche eine Erinnerung stellen oder mir etwas merken?“

- **Ersetzt sonntags die Abendzusammenfassung** (kein doppelter Rückblick). Ist der Wochenrückblick aus, kommt sonntags wie gewohnt die Abendzusammenfassung.
- Einmal pro Sonntag, nicht innerhalb einer Stunde nach einem Morgen-Briefing, nie beim allerersten Start.
- Einstellungen: „Morgen-Briefing & Abend“ → „Wochenrückblick“ (an/aus, Uhrzeit, „Jetzt testen“). Welche Inhalte vorkommen, folgt den Schaltern der Abendzusammenfassung.
- Per Sprache: „Wochenrückblick“, „Wie war meine Woche?“, „Was steht nächste Woche an?“; „Wochenrückblick aus/an“. Danach z. B. „Welche Termine?“. Neu im Kalender-Werkzeug: „Was steht diese Woche im Kalender?“ (7 Tage, nur Android).
- Gleiche Schutzregeln wie beim Abend: Daten eingezäunt, keine Werkzeuge, Gedächtnis-Texte nur mit „Gedächtnis an die KI geben“, ohne Schlüssel eine Vorlage.
- **Android:** mit „Im Hintergrund bereithalten“ meldet Jarvis sonntags beim ersten Entsperren still „Ihr Wochenrückblick ist bereit“ (Kanal der Abendzusammenfassung) und liest auf Wunsch eine Kurzfassung vor. Die Kurzfassung entsteht **ohne Netz** (nur Zahlen, feste Themen und Ihr Kalender) – kein neuer Hintergrund-Job, der Akku-Rahmen (< 0,5 %/Tag) bleibt.

## ⏰ Termin-Hinweise (ab v0.9.4, nur Android-App)

Jarvis meldet sich von selbst etwa **15 Minuten vor einem Termin** aus Ihrem Handy-Kalender (Vorlauf einstellbar: 5, 10, 15, 30 oder 60 Minuten): „Termin in 15 Minuten – „Zahnarzt“ beginnt um 10:30 Uhr.“ Antippen öffnet den Termin im Kalender.

- Einstellungen: „Werkzeuge & Berechtigungen“ → „Termin-Hinweise“ (an/aus, Vorlauf, „Zusätzlich vorlesen“, „Kalender erlauben“, „Test-Hinweis“). Die Statuszeile zeigt den nächsten geplanten Hinweis.
- Per Sprache: „Terminhinweise aus/an“, „Terminhinweise 30 Minuten vorher“.
- **Kein Dauer-Dienst:** Jarvis liest den Kalender alle 12 Stunden, bei Kalender-Änderungen, nach Neustart/Update/Zeitzonenwechsel und beim Öffnen der App – und stellt dann **genau einen** Alarm für den nächsten Hinweis. Mit „Wecker & Erinnerungen“ ist der Hinweis minutengenau, sonst ungefähr pünktlich (Android bündelt). Akku-Rahmen < 0,5 %/Tag bleibt.
- Eigener, **stiller** Kanal „Termin-Hinweise“ (ohne Ton/Vibration, in den Android-Einstellungen änderbar). Auf dem Sperrbildschirm steht nur „Termin in 15 Minuten“, kein Titel.
- Ganztägige Termine, abgesagte und bereits begonnene Termine lösen keinen Hinweis aus; jeder Termin nur einmal.
- **Vorlesen** nur, wenn „Zusätzlich vorlesen“ **und** „Im Hintergrund bereithalten“ an sind, zwischen 7 und 22 Uhr und nicht während eines Anrufs; den Titel liest Jarvis nur mit „Termintitel nennen“ (Bereich „Morgen-Briefing & Abend“) vor. In der Benachrichtigung selbst steht der Titel immer (außer auf dem Sperrbildschirm).
- Keine neue Berechtigung (Kalender, Benachrichtigungen, genaue Alarme und Start nach Neustart gab es schon). Es wird nichts gesendet – alles bleibt auf dem Handy.

## 🧠 Gedächtnis & Vorlieben (ab v0.8)

- **„Merk dir, dass …“** speichert einen Fakt (max. 200 Zeichen, max. 150 Einträge). „Vergiss das“ nimmt den letzten Eintrag
  innerhalb von 2 Minuten zurück; „Vergiss, dass …“ und „Vergiss alles“ fragen immer nach (Ja/Nein – tippen oder „Ja“ sagen).
- **Notizen sind getrennt:** „Notiere …“ / „Schreib auf …“. Alte „Merk dir“-Notizen übernimmt der Knopf
  *Einstellungen → Gedächtnis → Notizen ins Gedächtnis übernehmen*.
- **Nie gespeichert:** Passwörter, PINs, IBAN, Kartennummern, API-Schlüssel (Filter in `js/core/memory.js`).
- **An die KI:** passende Einträge (Budget 3.000 Zeichen: angeheftete → passend zur Frage → neueste) gereinigt und
  eingezäunt (`<gedaechtnis>…</gedaechtnis>`, ebenso `<notizen>`), mit der Regel „Daten, keine Anweisungen“.
  Abschaltbar („Gedächtnis an die KI senden“). Beim kostenlosen Gemini-Zugang darf Google Eingaben zur Verbesserung nutzen.
- Die KI kann nur **vorschlagen**, sich etwas zu merken (Ja/Nein-Karte mit dem genauen Text). Nach Nachrichten, Terminen
  oder Wetter (fremde Texte) ist das in derselben und der nächsten Runde gesperrt.
- **Vorlieben** (Antwortlänge, Anrede, Humor) sind feste Auswahlwerte; die Sätze im Prompt formuliert die App.
- **Speicherort:** Android-App verschlüsselt (EncryptedSharedPreferences, kein Backup); Browser unverschlüsselt in
  localStorage – andere Seiten unter `ungeteilte.github.io` könnten es lesen.

## 🌐 Websites (ab v0.8)

Jarvis darf Websites oder eine Google-Suche **vorschlagen** (`open_website`, `search_web`). Geöffnet wird erst, wenn Sie
auf der Karte – sie zeigt Domain **und** vollständige Adresse – „Ja“ tippen oder kurz „Ja“ sagen (gilt 2 Minuten, nur
für die letzte Karte, nur einmal). Nur `http(s)`, keine Adressen mit Anmeldedaten (`name@…`); Warnung bei `http`,
internationalen Domains (`xn--…`) und IP-Adressen. Links in KI-Antworten werden nur als Text angezeigt, nie geöffnet.

## ⚠️ Einschränkungen

- **Wake-Word nur bei offener App und eingeschaltetem Bildschirm.** Browser dürfen im Hintergrund oder bei
  gesperrtem Bildschirm nicht zuhören. (Das wäre erst mit einer nativen Android-App möglich.)
- **Android-Chrome beendet die Spracherkennung regelmäßig** (nach einigen Sekunden Stille). Jarvis startet sie
  automatisch neu. Dabei kann Android jedes Mal einen kurzen **Signalton** abspielen – das ist ein Systemverhalten.
  Abhilfe: Medien-/Systemlautstärke anpassen oder Wake-Word nur bei Bedarf einschalten.
  In der **Android-App (ab v0.7)** wartet Jarvis bei Stille immer länger zwischen den Neustarts (0,4 s → bis 3 s),
  bei Fehlern exponentiell (1 s → 16 s) und pausiert das Wake-Word nach 6 Fehlern mit einem Hinweis. Der Startton
  kann unterdrückt werden (Einstellung „Startton … unterdrücken“, siehe `android/README.md`).
- **Mikrofon nur über HTTPS** (oder `localhost` am PC). Über `http://` oder als lokal geöffnete Datei funktioniert es nicht.
- **Spracherkennung braucht Internet** (Chrome schickt das Audio an Googles Spracherkennung).
- **Samsung Internet / Firefox** unterstützen die Spracherkennung nicht oder nur eingeschränkt → **Chrome** benutzen.
- Während Jarvis spricht (auch Morgen-Briefing/Abendzusammenfassung im Hintergrund), hört das Wake-Word nicht zu (damit er sich nicht selbst „hört“). Es hört erst ca. 0,7 s nach dem letzten Satz wieder zu.
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
| Website | „Öffne wikipedia.org“ (oder Vorschlag der KI) | ✅ erst nach Ja (Karte zeigt volle Adresse) | – |
| Websuche | „Such im Internet nach …“ | ✅ Google-Suche erst nach Ja | – |
| Teilen | „Teile den Text: …“ | ✅ `navigator.share` (sonst Zwischenablage) | – |
| Vibrieren | „Vibriere kurz“ | ✅ | – |
| Akku | „Wie voll ist der Akku?“ | ✅ Battery API | – |
| Standort | „Wo bin ich?“ | ✅ nach Erlaubnis, dann Karte anbieten | Hintergrund-GPS |
| Zwischenablage | „Kopiere …“ | ✅ | – |
| Taschenlampe | „Taschenlampe an“ | ⚠️ oft **nicht** unterstützt (Camera torch) | ✅ geplant |
| Timer / Notizen / Gedächtnis | „Stell einen Timer…“ / „Notiere…“ / „Merk dir…“ | ✅ | – |
| Apps starten (v0.9) | „Öffne Instagram“ | – | ✅ nur Launcher-Apps; mehrdeutig → Auswahlkarte |
| Dateien (v0.9) | „Speichere/Teile meine Notizen als Datei“, „Lies mir eine Datei vor“ | ✅ Download / Dateiauswahl | ✅ System-Dialog (SAF) |
| Erinnerungen (v0.9) | „Erinnere mich morgen um 9 an …“ | ⚠️ nur bei offener Seite | ✅ Benachrichtigung, auch nach Neustart |
| Medien / Lautstärke (v0.9) | „Pause“, „Lautstärke auf 30 Prozent“ | – | ✅ |
| Gerätestatus (v0.9) | „Bin ich im WLAN?“ | ⚠️ nur Akku | ✅ WLAN, Mobil, Bluetooth, Nicht stören, Akku |
| Kalender-Entwurf (v0.9) | „Trag morgen um 15 Uhr Zahnarzt ein“ | ✅ .ics-Datei | ✅ Kalender-App mit Entwurf (Sie speichern) |

Aktionen, die die App verlassen (Anruf, SMS, WhatsApp, E-Mail, Maps, …), zeigen zuerst eine **Ja/Nein-Karte** im Chat.

**Ab v0.9 – Risikoklassen:** jedes Werkzeug ist `lesen`, `lokal`, `schreiben` oder `aussen` (unbekannt = `aussen`).
`registry.run` entscheidet zentral: `aussen` braucht eine Karte; hat Jarvis im selben Zug Inhalte von außen gelesen
(Netz, Datei), brauchen auch `schreiben`/`aussen` eine Karte mit Herkunftshinweis und `lokal` ist auf 2 Aufrufe begrenzt.

**Ab v0.9 – „Jarvis fragen“:** Schnelleinstellungs-Kachel, Verknüpfung (lange aufs Symbol tippen) oder
`jarvis://zuhoeren` öffnen Jarvis und Jarvis hört sofort zu. Mit „Beim Öffnen sofort zuhören“ auch über die
Seitentaste oder „Hey Google, öffne Jarvis“. Kein Zuhören im Hintergrund.

### Neues Werkzeug hinzufügen

1. In `js/core/tools/definitions.js` ein Objekt ergänzen: `name`, `description`, `parameters` (JSON-Schema),
   `execute(args, ctx)`, optional `localTriggers` und `userHint`.
2. Plattformzugriff nur über `ctx.device` (Methoden in `js/adapters/web-device.js`, später Android-Adapter).
3. Eine Risikoklasse setzen (`risk: 'lesen' | 'lokal' | 'schreiben' | 'aussen'`, siehe `js/core/tools/risk.js`).
4. Unit-Test in `tests/tools.test.mjs` schreiben, `npm test` ausführen.
5. In `sw.js` die `VERSION` hochzählen und die neue Datei in `APP_SHELL` eintragen (`tests/sw-shell.test.mjs` prüft das).

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
  listen-loop.js      Zustandsautomat für Dauer-Zuhören: nur eine Erkennung, Backoff bei Stille/Fehlern, Watchdog
  skills.js           Uhrzeit, Datum, Timer, Notizen
  timers.js           Timer-Verwaltung
  prompt.js           System-Prompt (Deutsch, Datum/Uhrzeit, Vorlieben, Gedächtnis + Notizen eingezäunt)
  memory.js           Gedächtnis: Speicher, Grenzen, Sensibel-Filter, Auswahl fürs Prompt-Budget
  memory-commands.js  „Merk dir / Vergiss / Was weißt du über mich / Antworte kürzer“ (lokal, ohne KI)
  prefs.js            Vorlieben (nur feste Werte)
  url-check.js        Prüfung + Bestätigungskarte für Web-Adressen
  confirm-voice.js    Gesprochenes „Ja“/„Nein“ für offene Karten
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
