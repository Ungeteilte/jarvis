# Jarvis Android (Capacitor 7)

Native Android-App um den Kern aus `../js/core/**`.

## Schnellstart (Build)
```bash
cd android   # dieses Verzeichnis (= jarvis-android-Projekt)
export JAVA_HOME=… ANDROID_HOME=…
npm install
npm run sync-www
npx cap sync android
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Native vs Web
| Feature | Native APK | PWA (Chrome) |
|---|---|---|
| Spracherkennung | Android SpeechRecognizer (kein Chrome-Piep) | Web Speech API |
| Sprachausgabe | Android TextToSpeech | speechSynthesis |
| API-Schlüssel | EncryptedSharedPreferences | localStorage |
| Taschenlampe | CameraManager torch | oft unsupported |
| App öffnen / Lautstärke / System-Timer | ✅ | Hinweis „Android-App“ |
| WLAN/Bluetooth | öffnet Einstellungs-Panel | unsupported |
| Wake-Word Hintergrund | noch nicht (nur App offen) | nur App offen |
| Anruf/SMS/WhatsApp | Intents + Ja/Nein | tel:/sms:/wa.me + Ja/Nein |

Siehe `INSTALL-DE.md` für die Installation auf dem Galaxy A55.


## ☀️ Morgen-Briefing im Hintergrund (ab v0.4)

Paket `com.jarvis.assistant.briefing`: Vordergrund-Dienst `BriefingService` (Typ `specialUse`, nur wenn „Im Hintergrund bereithalten“ an ist) hört auf `SCREEN_OFF`/`USER_PRESENT`; Regeln in `BriefingRules` (gleiche Testfälle wie JS: `tests/fixtures/briefing-rules.json` = `app/src/test/resources/briefing-rules.json`). Tägliches Vorladen `jarvis-briefing-prefetch` (WorkManager, ca. 04:30) – unabhängig von `jarvis-update-check`. Netz nur zu `api.open-meteo.com` und `www.tagesschau.de` über `SafeHttp` mit eigener Erlaubnisliste (`BriefingPolicy`). Kanäle `ready_v1` (minimal, lautlos) und `briefing_v1` (leise). Start aus der Benachrichtigung mit Einmal-Schlüssel. Kalender über `CalendarReader` (READ_CALENDAR, nur lesen).

## 🔄 Selbst-Update (ab v0.3)

Die App sucht im Hintergrund (WorkManager, auch bei geschlossener App) nach neuen
Releases unter `github.com/Ungeteilte/jarvis` mit Tag `vX.Y-android`.

**Ablauf:** Prüfen (GitHub-API mit ETag) → neueres Release mit `update.json` gefunden →
APK im Hintergrund laden (optional nur im WLAN) → SHA-256, Paketname, versionCode und
Signatur prüfen → Benachrichtigung **„Jarvis-Update vX bereit – tippen zum Installieren“** →
Android-Dialog **„Installieren“** (Bestätigung ist immer nötig). Beim ersten Mal fragt
Android nach **„Unbekannte Apps installieren“** für Jarvis.

**Einstellungen → App-Updates**
- *Automatisch nach Updates suchen* (Standard an) – plant/stoppt den Job `jarvis-update-check`
- *Wie oft prüfen*: alle 3 / 6 (Standard) / 12 / 24 Stunden
- *Nur über WLAN herunterladen* (Standard aus)
- *Jetzt prüfen* + Statuszeile „Zuletzt geprüft: … – aktuell (v0.x)“
- Karte „Update verfügbar“ mit Änderungen und *Jetzt installieren*

**Code:** `android/app/src/main/java/com/jarvis/assistant/updater/` (Java), Oberfläche
`native-web/updater-ui.js` (+ `updater-format.js`). `js/core/**` bleibt unberührt.
Tests: `./gradlew testDebugUnitTest` (JUnit) und `tests/updater-format.test.mjs`,
`tools/updater_ui_test.py` (Headless-UI mit Fake-Plugin).

### Veröffentlichen

Vor jedem Release laufen automatisch (Abbruch bei Fehler, vor dem Versions-Bump): `node --test tests/` und `tools/native_boot_test.py` gegen das gebaute `www` (nativer Start: `app.js` wartet auf `window.__JARVIS_BOOT__`, höchstens 3 s; native Sprachausgabe, kein Willkommens-Dialog). Zusätzlich vorher von Hand: `tools/browser_test.py`, `tools/updater_ui_test.py` (Server `python3 -m http.server 8080`).

```bash
export JARVIS_SIGNING_DIR=/pfad/zu/jarvis-signing   # außerhalb des Repos!
export ANDROID_DIR=/pfad/zum/capacitor-projekt JAVA_HOME=… ANDROID_HOME=…
tools/release-android.sh 0.4 "Was ist neu …"          # --dry-run zum Testen
```
Das Skript erhöht versionCode (+1) und versionName, baut, signiert mit Rotation, prüft,
schreibt `update.json` und erstellt das Release mit `Jarvis.apk` + `update.json`.

### ⚠️ Signaturschlüssel
Ab v0.3 signiert Jarvis mit einem eigenen Release-Schlüssel (RSA 4096). Damit v0.3 über
die mit dem Debug-Schlüssel signierte v0.2 installiert werden kann, nutzt das APK eine
**Schlüsselrotation (APK Signature Scheme v3, Lineage alt → neu)**. Für **jedes** künftige
Update werden der Release-Schlüssel, der alte Debug-Schlüssel und die Lineage-Datei gebraucht.
Gehen sie verloren, lässt sich Jarvis nur noch durch Deinstallieren (Datenverlust) aktualisieren.
Die Schlüssel liegen nie im Repo.
