package com.jarvis.assistant.events;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Nicht exportiert. Nur der eigene Alarm (PendingIntent) kommt hier an: Hinweise zeigen, nächsten Alarm stellen. */
public class EventReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (intent == null || !EventReminders.ACTION_FIRE.equals(intent.getAction())) return;
        final PendingResult pr = goAsync();
        final Context app = c.getApplicationContext();
        new Thread(() -> {
            try { EventReminders.scan(app); } catch (Exception ignored) {} finally { pr.finish(); }
        }, "jarvis-event-fire").start();
    }
}
