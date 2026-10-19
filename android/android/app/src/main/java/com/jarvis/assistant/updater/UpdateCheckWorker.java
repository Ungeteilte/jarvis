package com.jarvis.assistant.updater;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/** Hintergrund-Prüfung (WorkManager) – läuft auch bei geschlossener App. */
public class UpdateCheckWorker extends Worker {
    public static final String KEY_ALLOW_METERED = "allowMetered";

    public UpdateCheckWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        boolean allowMetered = getInputData().getBoolean(KEY_ALLOW_METERED, false);
        UpdateEngine.Outcome o = UpdateEngine.run(getApplicationContext(), allowMetered);
        if (o == UpdateEngine.Outcome.RETRY && getRunAttemptCount() < 3) return Result.retry();
        return Result.success();
    }
}
