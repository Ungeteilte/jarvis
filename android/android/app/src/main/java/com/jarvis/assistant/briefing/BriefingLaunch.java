package com.jarvis.assistant.briefing;

import android.content.Context;
import android.content.Intent;

/**
 * Start aus der Briefing-Benachrichtigung. MainActivity ist exportiert (Launcher) – andere Apps
 * könnten die Aktion also auch schicken. Nur mit gültigem Einmal-Schlüssel gilt der Start als
 * „vertraut“ (sofort vorlesen); sonst zeigt die App nur eine Tipp-Karte.
 */
public final class BriefingLaunch {
    private BriefingLaunch() {}

    public static final String ACTION = "com.jarvis.assistant.action.MORNING_BRIEFING";
    public static final String EXTRA_NONCE = "nonce";
    public static final String EXTRA_KIND = "kind";
    public static final String KIND_MORNING = "morning";
    public static final String KIND_EVENING = "evening";
    public static final String KIND_WEEKLY = "weekly";

    public interface Listener { void onLaunch(); }

    private static volatile boolean pending = false;
    private static volatile boolean trusted = false;
    private static volatile String kind = KIND_MORNING;
    private static volatile Listener listener;

    public static void setListener(Listener l) { listener = l; }

    /** Aus MainActivity.handleIntent. true = war eine Briefing-Aktion. */
    public static boolean handle(Context c, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return false;
        String nonce = null;
        try { nonce = intent.getStringExtra(EXTRA_NONCE); } catch (Exception ignored) {}
        String k = null;
        try { k = intent.getStringExtra(EXTRA_KIND); } catch (Exception ignored) {}
        kind = KIND_EVENING.equals(k) ? KIND_EVENING : KIND_WEEKLY.equals(k) ? KIND_WEEKLY : KIND_MORNING; // nur bekannte Werte
        trusted = BriefingState.consumeNonce(c, nonce);
        pending = true;
        Listener l = listener;
        if (l != null) { try { l.onLaunch(); } catch (Exception ignored) {} }
        return true;
    }

    /** Für die App: einmal abholen (danach zurückgesetzt). */
    public static synchronized boolean[] consume() {
        boolean[] r = {pending, trusted};
        pending = false;
        trusted = false;
        return r;
    }

    /** Art des letzten Starts (morning|evening|weekly) – vor consume() abfragen. */
    public static String kind() { return kind; }
}
