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
