package com.jarvis.assistant.briefing;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.TimeZone;

/** Lädt früh am Morgen (bzw. vor dem Abend) Wetter und Nachrichten vor (Cache für das Entsperren). */
public class BriefingPrefetchWorker extends Worker {
    public static final String KEY_KIND = "kind";

    public BriefingPrefetchWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        if (!BriefingScheduler.active(c)) return Result.success();
        long now = System.currentTimeMillis();
        int h = BriefingRules.hourOf(now, TimeZone.getDefault());
        if (BriefingLaunch.KIND_EVENING.equals(getInputData().getString(KEY_KIND))) {
            if (!BriefingState.eveningEnabled(c) || h < BriefingState.eveningStartHour(c) - 3 || h >= BriefingRules.NIGHT_LOCK_HOUR) return Result.success();
            // Sonntags ersetzt der Wochenrückblick den Abend – der braucht kein Netz, also nichts vorladen
            if (BriefingRules.weeklyReplacesEvening(now, TimeZone.getDefault(), BriefingState.weeklyEnabled(c))) {
                if (!BriefingService.isRunning()) BriefingService.start(c, false);
                return Result.success();
            }
            boolean ok = true;
            if (BriefingState.eveningContent(c, "weather") && BriefingState.coords(c, now) != null) ok = BriefingFetcher.weatherTomorrow(c, now, 15000) != null;
            if (BriefingState.eveningContent(c, "news")) ok &= BriefingFetcher.news(c, 15000) != null;
            if (!BriefingService.isRunning()) BriefingService.start(c, false);
            return ok || getRunAttemptCount() >= 2 ? Result.success() : Result.retry();
        }
        if (!BriefingState.enabled(c) || h < BriefingRules.DAY_START_HOUR || h >= BriefingState.latestHour(c)) return Result.success();
        boolean ok = true;
        if (BriefingState.content(c, "weather") && BriefingState.coords(c, now) != null) ok = BriefingFetcher.weather(c, now, 15000) != null;
        if (BriefingState.content(c, "news")) ok &= BriefingFetcher.news(c, 15000) != null;
        // Dienst evtl. von Samsung beendet → wieder anstoßen (aus WorkManager ggf. nicht erlaubt – egal)
        if (!BriefingService.isRunning()) BriefingService.start(c, false);
        return ok || getRunAttemptCount() >= 2 ? Result.success() : Result.retry();
    }
}
