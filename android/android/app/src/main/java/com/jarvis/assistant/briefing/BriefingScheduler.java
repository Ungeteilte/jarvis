package com.jarvis.assistant.briefing;

import android.content.Context;

import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * Plant das tägliche Vorladen „jarvis-briefing-prefetch“ (ca. 04:30 Ortszeit) und den Dienst.
 * Unabhängig vom Updater („jarvis-update-check“ in UpdateScheduler) – eigener eindeutiger Name.
 */
public final class BriefingScheduler {
    private BriefingScheduler() {}

    public static final String PREFETCH = "jarvis-briefing-prefetch";

    static boolean active(Context c) { return BriefingState.backgroundEnabled(c) && BriefingState.enabled(c); }

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

    private static void schedule(Context c, ExistingPeriodicWorkPolicy policy) {
        long delay = BriefingRules.delayUntil(System.currentTimeMillis(), TimeZone.getDefault(), 4, 30);
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(BriefingPrefetchWorker.class, 24, TimeUnit.HOURS, 1, TimeUnit.HOURS)
            .setInitialDelay(delay, TimeUnit.MILLISECONDS)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork(PREFETCH, policy, req);
    }

    public static void cancel(Context c) {
        WorkManager.getInstance(c).cancelUniqueWork(PREFETCH);
        BriefingService.stop(c);
    }
}
