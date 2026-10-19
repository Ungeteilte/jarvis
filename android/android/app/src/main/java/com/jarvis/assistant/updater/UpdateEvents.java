package com.jarvis.assistant.updater;

import android.content.Context;

import org.json.JSONObject;

import java.util.concurrent.CopyOnWriteArraySet;

/** Meldet Statusänderungen an das Plugin (→ Web-Event „updateStatus“). */
public final class UpdateEvents {
    public interface Listener { void onStatus(JSONObject status); }
    private static final CopyOnWriteArraySet<Listener> LISTENERS = new CopyOnWriteArraySet<>();
    private UpdateEvents() {}

    public static void add(Listener l) { LISTENERS.add(l); }
    public static void remove(Listener l) { LISTENERS.remove(l); }

    static void emit(Context c) {
        if (LISTENERS.isEmpty()) return;
        JSONObject s = UpdateState.toJson(c);
        for (Listener l : LISTENERS) {
            try { l.onStatus(s); } catch (Exception ignored) {}
        }
    }
}
