package com.jarvis.assistant.briefing;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * Plant das tägliche Vorladen „jarvis-briefing-prefetch“ (ca. 04:30 Ortszeit), abends
 * „jarvis-evening-prefetch“ (ca. 30 Min. vor dem Rückblick-Fenster) und den Dienst.
 * Unabhängig vom Updater („jarvis-update-check“ in UpdateScheduler) – eigener eindeutiger Name.
 */
public final class BriefingScheduler {
    private BriefingScheduler() {}

    public static final String PREFETCH = "jarvis-briefing-prefetch";
    /** Abend-Vorladen ca. 30 Min. vor dem Fensterbeginn (Standard 18:30). Eigener eindeutiger Name. */
    public static final String EVENING_PREFETCH = "jarvis-evening-prefetch";
    private static final String KEY_EVENING_HOUR = "eveningPrefetchHour";

    static boolean active(Context c) { return BriefingState.backgroundEnabled(c) && BriefingState.anyEnabled(c); }

    /** App-Start: vorhandenen Plan behalten (KEEP), Dienst sicherstellen. */
    public static void ensure(Context c) {
        if (active(c)) { schedule(c, ExistingPeriodicWorkPolicy.KEEP); BriefingService.start(c, false); }
        else cancel(c);
    }

    /** Schalter geändert / Zeitzone gewechselt: Plan neu (UPDATE). */
    public static void apply(Context c) {
        if (active(c)) { schedule(c, ExistingPeriodicWorkPolicy.UPDATE); BriefingService.start(c, false); }
        else cancel(c);
    }

    /** Nach dem Abgleich mit der App: Abend-Vorladen nur neu planen, wenn sich etwas geändert hat. */
    public static void refresh(Context c) {
        if (!active(c)) return;
        scheduleEvening(c, ExistingPeriodicWorkPolicy.KEEP);
    }

    private static void schedule(Context c, ExistingPeriodicWorkPolicy policy) {
        WorkManager wm = WorkManager.getInstance(c);
        if (BriefingState.enabled(c)) {
            long delay = BriefingRules.delayUntil(System.currentTimeMillis(), TimeZone.getDefault(), 4, 30);
            wm.enqueueUniquePeriodicWork(PREFETCH, policy, request(c, delay, BriefingLaunch.KIND_MORNING));
        } else wm.cancelUniqueWork(PREFETCH);
        scheduleEvening(c, policy);
    }

    private static void scheduleEvening(Context c, ExistingPeriodicWorkPolicy policy) {
        WorkManager wm = WorkManager.getInstance(c);
        if (!BriefingState.eveningEnabled(c)) {
            wm.cancelUniqueWork(EVENING_PREFETCH);
            BriefingState.prefs(c).edit().remove(KEY_EVENING_HOUR).apply();
            return;
        }
        int hour = BriefingState.eveningStartHour(c) - 1;
        if (BriefingState.prefs(c).getInt(KEY_EVENING_HOUR, -1) != hour) policy = ExistingPeriodicWorkPolicy.UPDATE;
        long delay = BriefingRules.delayUntil(System.currentTimeMillis(), TimeZone.getDefault(), hour, 30);
        wm.enqueueUniquePeriodicWork(EVENING_PREFETCH, policy, request(c, delay, BriefingLaunch.KIND_EVENING));
        BriefingState.prefs(c).edit().putInt(KEY_EVENING_HOUR, hour).apply();
    }

    private static PeriodicWorkRequest request(Context c, long delayMs, String kind) {
        return new PeriodicWorkRequest.Builder(BriefingPrefetchWorker.class, 24, TimeUnit.HOURS, 1, TimeUnit.HOURS)
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setInputData(new Data.Builder().putString(BriefingPrefetchWorker.KEY_KIND, kind).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
    }

    public static void cancel(Context c) {
        WorkManager.getInstance(c).cancelUniqueWork(PREFETCH);
        WorkManager.getInstance(c).cancelUniqueWork(EVENING_PREFETCH);
        BriefingState.prefs(c).edit().remove(KEY_EVENING_HOUR).apply();
        BriefingService.stop(c);
    }
}
