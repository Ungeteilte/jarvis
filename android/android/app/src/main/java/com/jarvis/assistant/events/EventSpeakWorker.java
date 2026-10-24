package com.jarvis.assistant.events;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.jarvis.assistant.briefing.BriefingSpeaker;
import com.jarvis.assistant.briefing.BriefingState;

/** Termin-Hinweis vorlesen (blockierend bis 90 s – deshalb nicht im Receiver). Veraltet (Termin begonnen) → still. */
public class EventSpeakWorker extends Worker {
    public EventSpeakWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull @Override
    public Result doWork() {
        Context c = getApplicationContext();
        String text = getInputData().getString("text");
        long until = getInputData().getLong("until", 0);
        if (text == null || text.isEmpty() || System.currentTimeMillis() >= until) return Result.success();
        if (!BriefingState.backgroundEnabled(c) || !EventReminders.speakWanted(c)) return Result.success();
        BriefingSpeaker.speak(c, text);
        return Result.success();
    }
}
