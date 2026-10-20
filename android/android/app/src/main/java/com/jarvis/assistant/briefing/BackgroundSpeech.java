package com.jarvis.assistant.briefing;

/**
 * Meldet, wann der Hintergrund-Dienst laut vorliest – die offene App pausiert dann ihr
 * Wake-Word (sonst hört die Erkennung die eigene Stimme). Ein Zuhörer: das JarvisNative-Plugin.
 */
public final class BackgroundSpeech {
    private BackgroundSpeech() {}

    public interface Listener { void onSpeaking(boolean speaking); }

    private static volatile Listener listener;
    private static volatile boolean speaking;

    public static void setListener(Listener l) { listener = l; }
    public static boolean isSpeaking() { return speaking; }

    static void set(boolean on) {
        speaking = on;
        Listener l = listener;
        if (l != null) { try { l.onSpeaking(on); } catch (Exception ignored) {} }
    }
}
