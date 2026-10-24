package com.jarvis.assistant.events;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ExistingWorkPolicy;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Kalender-Scan (alle 12 h bzw. nach einer Kalender-Änderung). Kein Netz, nur lesen. */
public class EventScanWorker extends Worker {
    public EventScanWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull @Override
    public Result doWork() {
        Context c = getApplicationContext();
        try { EventReminders.apply(c); } catch (Exception ignored) {}
        // Beobachter für die nächste Kalender-Änderung erneut anhängen (läuft erst nach diesem Lauf an)
        if (getInputData().getBoolean("watch", false) && EventReminders.active(c)) {
            try { WorkManager.getInstance(c).enqueueUniqueWork(EventReminders.WORK_WATCH, ExistingWorkPolicy.APPEND_OR_REPLACE, EventReminders.watchRequest()); }
            catch (Exception ignored) {}
        }
        return Result.success();
    }
}
