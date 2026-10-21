package com.jarvis.assistant.listen;

import java.util.Set;

/**
 * v0.9 Stufe 0 – „fast wie Hey Google“ ohne Akku: Jarvis öffnen und sofort zuhören.
 *
 * Auslöser: jarvis://zuhoeren, die Aktion ACTION_LISTEN (Kachel, Verknüpfung „Jarvis fragen“) oder das
 * Extra EXTRA_LISTEN=true. Ein normaler Start über das App-Symbol, die Seitentaste oder „Hey Google,
 * öffne Jarvis“ wird als „opened“ gemeldet – zugehört wird dann nur, wenn du „Beim Öffnen sofort
 * zuhören“ eingeschaltet hast. Kein Dienst im Hintergrund, kein Mikrofon ohne sichtbare App.
 * Reines Java (JUnit); MainActivity reicht Aktion/Daten/Kategorien durch.
 */
public final class ListenLaunch {
    private ListenLaunch() {}

    public static final String ACTION_LISTEN = "com.jarvis.assistant.action.LISTEN";
    public static final String EXTRA_LISTEN = "jarvis_listen";
    public static final String SCHEME = "jarvis";
    public static final String HOST = "zuhoeren";
    public static final String ACTION_MAIN = "android.intent.action.MAIN";
    public static final String ACTION_VIEW = "android.intent.action.VIEW";
    public static final String CATEGORY_LAUNCHER = "android.intent.category.LAUNCHER";

    public enum Kind { NONE, LISTEN, OPENED }

    /** listen=true: zuhören angefordert; false: nur normal geöffnet. */
    public interface Listener { void onLaunch(boolean listen); }

    private static volatile boolean listen = false;
    private static volatile boolean opened = false;
    private static volatile Listener listener;

    public static void setListener(Listener l) { listener = l; }

    /** Was ist das für ein Start? (rein, testbar) */
    public static Kind classify(String action, String scheme, String host, boolean listenExtra, Set<String> categories) {
        if (ACTION_LISTEN.equals(action) || listenExtra) return Kind.LISTEN;
        if (ACTION_VIEW.equals(action) && SCHEME.equalsIgnoreCase(scheme) && HOST.equalsIgnoreCase(host)) return Kind.LISTEN;
        if (ACTION_MAIN.equals(action) && categories != null && categories.contains(CATEGORY_LAUNCHER)) return Kind.OPENED;
        return Kind.NONE;
    }

    /** Aus MainActivity: Start merken und die laufende App benachrichtigen. */
    public static Kind record(Kind k) {
        if (k == Kind.LISTEN) listen = true;
        else if (k == Kind.OPENED) opened = true;
        else return k;
        Listener l = listener;
        if (l != null) { try { l.onLaunch(k == Kind.LISTEN); } catch (Exception ignored) {} }
        return k;
    }

    /** Für die App: einmal abholen. → {listen, opened} */
    public static synchronized boolean[] consume() {
        boolean[] r = {listen, opened};
        listen = false;
        opened = false;
        return r;
    }
}
