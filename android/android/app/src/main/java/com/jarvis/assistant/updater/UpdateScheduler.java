package com.jarvis.assistant.updater;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

/**
 * Plant die regelmäßige Prüfung „jarvis-update-check“.
 * WorkManager plant nach Neustart/App-Update selbst neu ein (bringt RECEIVE_BOOT_COMPLETED mit).
 */
public final class UpdateScheduler {
    public static final String PERIODIC = "jarvis-update-check";
    public static final String NOW = "jarvis-update-check-now";
    public static final String WIFI = "jarvis-update-wifi";

    private UpdateScheduler() {}

    /** App-Start: vorhandenen Plan behalten (KEEP). */
    public static void ensureScheduled(Context c) {
        if (UpdateState.enabled(c)) schedule(c, ExistingPeriodicWorkPolicy.KEEP);
        else cancel(c);
    }

    /** Einstellungen geändert: Plan aktualisieren (UPDATE) oder abbrechen. */
    public static void applyConfig(Context c) {
        if (UpdateState.enabled(c)) schedule(c, ExistingPeriodicWorkPolicy.UPDATE);
        else cancel(c);
    }

    private static void schedule(Context c, ExistingPeriodicWorkPolicy policy) {
        int hours = UpdateState.intervalHours(c); // nie unter 3 h (> 15-min-Minimum)
        Constraints cons = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .setRequiresBatteryNotLow(true)
            .build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(UpdateCheckWorker.class, hours, TimeUnit.HOURS)
            .setConstraints(cons)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PERIODIC, policy, req);
    }

    public static void cancel(Context c) {
        WorkManager wm = WorkManager.getInstance(c);
        wm.cancelUniqueWork(PERIODIC);
        wm.cancelUniqueWork(WIFI);
    }

    /** „Jetzt prüfen“: einmalig, nur Netz nötig. */
    public static void checkNow(Context c, boolean allowMetered) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(new Data.Builder().putBoolean(UpdateCheckWorker.KEY_ALLOW_METERED, allowMetered).build())
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req);
    }

    /** Nur-WLAN: Download nachholen, sobald WLAN (nicht getaktet) da ist. */
    static void enqueueWifiDownload(Context c) {
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(UpdateCheckWorker.class)
            .setConstraints(new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.UNMETERED)
                .setRequiresBatteryNotLow(true).build())
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork(WIFI, ExistingWorkPolicy.KEEP, req);
    }
}
