package com.jarvis.assistant.stt;

/**
 * Einordnung der SpeechRecognizer-Fehlercodes (reine Java-Logik, JUnit-getestet).
 *  silence – niemand hat gesprochen (normal beim Wake-Word): kurz warten, neu starten
 *  busy    – Erkennung noch belegt: abbrechen, mit Wartezeit neu
 *  retry   – vorübergehend (Audio, Netz, Server, Client): exponentiell warten
 *  fatal   – dauerhaft (keine Erlaubnis, Sprache fehlt): aufhören und Hinweis zeigen
 * Codes als Zahlen (identisch mit android.speech.SpeechRecognizer.ERROR_*).
 */
public final class SttErrors {
    private SttErrors() {}

    public static final String SILENCE = "silence";
    public static final String BUSY = "busy";
    public static final String RETRY = "retry";
    public static final String FATAL = "fatal";

    public static String classify(int code) {
        switch (code) {
            case 6:  // ERROR_SPEECH_TIMEOUT
            case 7:  // ERROR_NO_MATCH
                return SILENCE;
            case 8:  // ERROR_RECOGNIZER_BUSY
                return BUSY;
            case 9:  // ERROR_INSUFFICIENT_PERMISSIONS
            case 12: // ERROR_LANGUAGE_NOT_SUPPORTED
            case 13: // ERROR_LANGUAGE_UNAVAILABLE
                return FATAL;
            default: // 1 NETWORK_TIMEOUT, 2 NETWORK, 3 AUDIO, 4 SERVER, 5 CLIENT, 10 TOO_MANY_REQUESTS, 11 SERVER_DISCONNECTED …
                return RETRY;
        }
    }

    public static String name(int code) {
        switch (code) {
            case 1: return "network-timeout";
            case 2: return "network";
            case 3: return "audio";
            case 4: return "server";
            case 5: return "client";
            case 6: return "speech-timeout";
            case 7: return "no-match";
            case 8: return "busy";
            case 9: return "permission";
            case 10: return "too-many-requests";
            case 11: return "server-disconnected";
            case 12: return "language-not-supported";
            case 13: return "language-unavailable";
            default: return "error-" + code;
        }
    }

    /** Welche Ströme beim Starton-Stummschalten angefasst werden (rein, getestet). */
    public static boolean shouldMuteStream(boolean isMusicStream, boolean musicActive, boolean alreadyMuted, int volume) {
        if (alreadyMuted || volume <= 0) return false;     // nichts zu tun – und später nichts „wiederherstellen“
        return !(isMusicStream && musicActive);             // laufende Musik/Podcast nie unterbrechen
    }
}
