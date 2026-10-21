package com.jarvis.assistant.tools;

/**
 * v0.9 W5 – Medientasten und Lautstärke in Prozent (reines Java, per JUnit testbar).
 * Die Tastencodes entsprechen android.view.KeyEvent (Konstanten, hier fest, damit JUnit ohne Android läuft).
 */
public final class MediaControl {
    private MediaControl() {}

    public static final int KEYCODE_MEDIA_PLAY = 126;
    public static final int KEYCODE_MEDIA_PAUSE = 127;
    public static final int KEYCODE_MEDIA_NEXT = 87;
    public static final int KEYCODE_MEDIA_PREVIOUS = 88;

    /** pause | weiter | naechster | zurueck → Tastencode; unbekannt → -1 (nichts senden). */
    public static int keyCode(String action) {
        if (action == null) return -1;
        switch (action) {
            case "pause": return KEYCODE_MEDIA_PAUSE;
            case "weiter": return KEYCODE_MEDIA_PLAY;
            case "naechster": return KEYCODE_MEDIA_NEXT;
            case "zurueck": return KEYCODE_MEDIA_PREVIOUS;
            default: return -1;
        }
    }

    /** Prozent (0–100, wird begrenzt) → Lautstärkestufe 0..max (gerundet). */
    public static int volumeIndex(int percent, int max) {
        int p = Math.max(0, Math.min(100, percent));
        if (max <= 0) return 0;
        return Math.round(p * max / 100f);
    }

    /** Stufe → Prozent (für die ehrliche Ansage „auf 33 Prozent“). */
    public static int percentOf(int index, int max) {
        if (max <= 0) return 0;
        return Math.round(Math.max(0, Math.min(index, max)) * 100f / max);
    }
}
