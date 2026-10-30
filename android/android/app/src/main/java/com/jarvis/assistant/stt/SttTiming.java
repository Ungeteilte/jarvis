package com.jarvis.assistant.stt;

/**
 * v0.9.6: Satzende-Erkennung (Endpointing) für den Android-Erkenner. Reine Logik (JUnit-testbar).
 * Die Werte kommen aus js/core/listen-loop.js (ENDPOINT_POLICY) und werden hier begrenzt, damit ein
 * fehlerhafter Wert weder Sätze abschneidet (zu kurz) noch das Mikrofon lange offen hält (zu lang).
 * Es sind HINWEISE: manche Erkenner (z. B. einige Google-Versionen) ignorieren sie – dann gilt deren Standard.
 */
public final class SttTiming {
    public static final int MIN_SILENCE_MS = 600;
    public static final int MAX_SILENCE_MS = 3000;

    private SttTiming() {}

    /** 0 oder ungültig → nicht setzen (Erkenner-Standard); sonst auf 600–3000 ms begrenzt. */
    public static int silenceMs(int ms) {
        if (ms <= 0) return 0;
        return Math.max(MIN_SILENCE_MS, Math.min(MAX_SILENCE_MS, ms));
    }

    /** „Möglicherweise fertig“ darf nie länger sein als „sicher fertig“. */
    public static int possiblySilenceMs(int possibly, int complete) {
        int p = silenceMs(possibly);
        int c = silenceMs(complete);
        if (p == 0) return 0;
        return c > 0 ? Math.min(p, c) : p;
    }
}
