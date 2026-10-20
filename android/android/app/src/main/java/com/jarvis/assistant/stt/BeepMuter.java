package com.jarvis.assistant.stt;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.os.Build;

/**
 * Unterdrückt den Startton der Spracherkennung beim Wake-Word: Für etwa eine Sekunde rund um
 * startListening() werden STREAM_SYSTEM und – nur wenn gerade nichts abgespielt wird –
 * STREAM_MUSIC stummgeschaltet (ADJUST_MUTE) und danach wiederhergestellt (ADJUST_UNMUTE stellt
 * die vorige Lautstärke wieder her, erhöht also nie). Nicht angefasst: Klingelton und
 * Benachrichtigungen (kann auf Samsung den Klingelmodus verstellen). Nichts bei „Nicht stören“,
 * während eines Anrufs oder vor Android 6. Was stummgeschaltet wurde, steht in den Prefs –
 * stirbt die App im Fenster, stellt der nächste Start es wieder her (restoreLeftovers).
 */
public final class BeepMuter {
    private BeepMuter() {}

    private static final String PREFS = "jarvis_stt";
    private static final String KEY = "mutedStreams";
    private static final int[] STREAMS = { AudioManager.STREAM_SYSTEM, AudioManager.STREAM_MUSIC };

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized void mute(Context c) {
        if (Build.VERSION.SDK_INT < 23 || !prefs(c).getString(KEY, "").isEmpty()) return;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (am == null || am.getMode() != AudioManager.MODE_NORMAL) return;
        if (nm != null && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL
            && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return;
        StringBuilder done = new StringBuilder();
        for (int s : STREAMS) {
            try {
                if (!SttErrors.shouldMuteStream(s == AudioManager.STREAM_MUSIC, am.isMusicActive(), am.isStreamMute(s), am.getStreamVolume(s))) continue;
                am.adjustStreamVolume(s, AudioManager.ADJUST_MUTE, 0);
                if (done.length() > 0) done.append(',');
                done.append(s);
            } catch (SecurityException ignored) { /* nicht erlaubt → Ton bleibt */ }
        }
        if (done.length() > 0) prefs(c).edit().putString(KEY, done.toString()).commit();
    }

    public static synchronized void restore(Context c) {
        String list = prefs(c).getString(KEY, "");
        if (list.isEmpty()) return;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am != null && Build.VERSION.SDK_INT >= 23) {
            for (String p : list.split(",")) {
                try { am.adjustStreamVolume(Integer.parseInt(p.trim()), AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) {}
            }
        }
        prefs(c).edit().remove(KEY).commit();
    }

    /** Beim Start der App: von einem Absturz im Stumm-Fenster übrig gebliebene Stummschaltung aufheben. */
    public static void restoreLeftovers(Context c) { restore(c); }

    public static boolean isMuting(Context c) { return !prefs(c).getString(KEY, "").isEmpty(); }
}
