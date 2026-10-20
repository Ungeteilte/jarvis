package com.jarvis.assistant.briefing;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationManagerCompat;

import java.util.TimeZone;

/**
 * Nicht exportiert. System: BOOT_COMPLETED / MY_PACKAGE_REPLACED (Dienst neu starten und einmal
 * nachprüfen), TIMEZONE_CHANGED (gespeicherten Ort verwerfen). Intern: Aktionen der Benachrichtigung.
 */
public class BriefingSystemReceiver extends BroadcastReceiver {
    public static final String ACTION_PAUSE = "com.jarvis.assistant.briefing.PAUSE_TODAY";
    public static final String ACTION_OFF = "com.jarvis.assistant.briefing.OFF";

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (a == null) return;
        switch (a) {
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
                if (BriefingScheduler.active(c)) BriefingService.start(c, true);
                break;
            case Intent.ACTION_TIMEZONE_CHANGED:
                BriefingState.onTimezoneChanged(c);
                if (BriefingScheduler.active(c)) { try { BriefingScheduler.apply(c); } catch (Exception ignored) {} }
                break;
            case ACTION_PAUSE:
                BriefingState.pauseDay(c, BriefingRules.dayKey(System.currentTimeMillis(), TimeZone.getDefault()));
                break;
            case ACTION_OFF:
                BriefingState.setBackgroundEnabled(c, false, true);
                BriefingScheduler.cancel(c);
                NotificationManagerCompat.from(c).cancel(BriefingNotifier.ID_READY);
                break;
            default:
                break;
        }
    }
}
