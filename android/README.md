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


## 👂 Wake-Word / Spracherkennung (ab v0.7)

Fehler bis v0.6: Der Dauer-Zuhören-Kreislauf in `native-stt.js` fragte `isListening` alle 300 ms ab und startete die
Erkennung des Community-Plugins nach 350 ms neu – ohne Backoff, bei langsamem Plugin-Thread (blockierendes `speak`)
mehrfach parallel; `stop()` des Plugins kehrt nie zurück. Folge: Piepton im Sekundentakt, überlappende Erkenner,
hängendes Mikrofon.

Jetzt:
- **Ein Erkenner**: `JarvisNative.sttStart({session, language, partial, muteBeep})` / `sttCancel()` / Ereignis
  `sttEvent {session, type: ready|partial|final|error, text, code, kind}`. `NativeRecognizer` (Paket `stt`) läuft
  komplett auf dem Main-Thread, zerstört den alten `SpeechRecognizer` vor jedem Neustart, Ereignisse alter Sitzungen
  werden verworfen. Fehlerklassen in `SttErrors` (6/7 Stille, 8 belegt, 9/12/13 endgültig, sonst erneut versuchen).
- **Zustandsautomat** `js/core/listen-loop.js`: nie zwei Starts gleichzeitig; Stille 0,4/0,4/0,8/1,5/3 s; Fehler
  1/2/4/8/16 s, nach 6 Fehlern Pause + Hinweis; Watchdog 20 s.
- **Pausen mit Gründen** (`wake-controller.js`): `tts`, `turn`, `mic`, `hidden`, `bg-tts` – das Wake-Word läuft erst
  wieder, wenn kein Grund mehr offen ist (nach TTS 0,7 s Verzögerung gegen Eigenecho). Hintergrund-Sprachausgabe
  (`BriefingSpeaker`) meldet `backgroundSpeech {speaking}`.
- **`speak` blockiert den Plugin-Thread nicht mehr** (vorher bis 120 s Warten → alle anderen Aufrufe stauten sich).
- **Startton unterdrücken** (Einstellung, Standard an, nur Wake-Word): `BeepMuter` schaltet für ca. 1 s
  `STREAM_SYSTEM` und – nur wenn gerade keine Musik läuft – `STREAM_MUSIC` stumm (`ADJUST_MUTE`) und danach wieder
  laut (`ADJUST_UNMUTE`, ändert nie die Lautstärke). Abwägung: Es gibt kein offizielles Extra gegen den Piepton.
  Benachrichtigungs-/Klingelton werden bewusst **nicht** angefasst (Samsung kann sonst den Klingelmodus ändern /
  „Nicht stören“ verlangt Sonderrecht). Bei „Nicht stören“ oder Telefonat wird nichts stummgeschaltet. Stummgeschaltete
  Streams stehen in den Prefs `jarvis_stt` und werden nach einem Absturz beim nächsten Start wiederhergestellt.
  Je nach Gerät/Spracherkennungs-App kommt der Ton über einen anderen Stream – dann bleibt er hörbar.
  Der Mikrofon-Knopf behält den Ton (Rückmeldung „ich höre zu“).

## 🧠 Gedächtnis & Backup (ab v0.8)

Das Gedächtnis (`jarvis.memory`) liegt wie alle `jarvis.*`-Schlüssel in EncryptedSharedPreferences (`secureGet/secureSet`,
Ladeliste in `native-web/native-storage.js`). **Backup ist aus:** `android:allowBackup="false"`, dazu
`res/xml/data_extraction_rules.xml` (Android 12+: Cloud-Backup **und** Gerät-zu-Gerät-Übertragung schließen alle Bereiche aus)
und `res/xml/backup_rules.xml` (Android 6–11). Grund: Gedächtnis, Schlüssel und Verlauf sollen nicht zu Google wandern, und
EncryptedSharedPreferences lassen sich nach einer Wiederherstellung ohnehin nicht entschlüsseln (Schlüssel im Keystore wird
nicht mitgesichert). Folge: Bei einem Handywechsel Gedächtnis über *Einstellungen → Gedächtnis → Exportieren* mitnehmen,
API-Schlüssel neu eintragen. App-Updates sind davon nicht betroffen (Daten bleiben erhalten).

Websites/Links: `JarvisNative.openUrl` wird nur nach bestätigter Karte aufgerufen (siehe README, „Websites“).

## ☀️ Morgen-Briefing im Hintergrund (ab v0.4)

Paket `com.jarvis.assistant.briefing`: Vordergrund-Dienst `BriefingService` (Typ `specialUse`, nur wenn „Im Hintergrund bereithalten“ an ist) hört auf `SCREEN_OFF`/`USER_PRESENT`; Regeln in `BriefingRules` (gleiche Testfälle wie JS: `tests/fixtures/briefing-rules.json` = `app/src/test/resources/briefing-rules.json`). Tägliches Vorladen `jarvis-briefing-prefetch` (WorkManager, ca. 04:30) – unabhängig von `jarvis-update-check`. Netz nur zu `api.open-meteo.com` und `www.tagesschau.de` über `SafeHttp` mit eigener Erlaubnisliste (`BriefingPolicy`). Kanäle `ready_v1` (minimal, lautlos) und `briefing_v1` (leise). Start aus der Benachrichtigung mit Einmal-Schlüssel. Kalender über `CalendarReader` (READ_CALENDAR, nur lesen).

**Abendzusammenfassung (ab v0.6):** derselbe Dienst prüft nach dem Morgen-Briefing `BriefingRules.decideEvening` (Testfälle `tests/fixtures/evening-rules.json` = `app/src/test/resources/evening-rules.json`) und zeigt die Vorlage `BriefingText.composeEvening` (nur Zahlen + feste Themen-Etiketten aus der App, Wetter/Termine morgen) im Kanal `evening_v1` (leise, ID 4723). Vorladen `jarvis-evening-prefetch` ca. 30 Min. vor Fensterbeginn (Standard 18:30).

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
