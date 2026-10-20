package com.jarvis.assistant.briefing;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.jarvis.assistant.MainActivity;
import com.jarvis.assistant.R;

/**
 * Zwei eigene Kanäle (getrennt vom Updater-Kanal „updates“, ID 4711):
 *  - ready_v1  „Jarvis bereit“: IMPORTANCE_MIN, lautlos, ohne Symbol in der Statusleiste, ohne Badge (ID 4721)
 *  - briefing_v1 „Morgen-Briefing“: IMPORTANCE_LOW, ohne Ton und Vibration, privat auf dem Sperrbildschirm (ID 4722)
 * Kanal-Einstellungen sind nach dem ersten Anlegen fest (der Nutzer kann sie ändern) → Version im Namen.
 */
public final class BriefingNotifier {
    private BriefingNotifier() {}

    public static final String CHANNEL_READY = "ready_v1";
    public static final String CHANNEL_BRIEFING = "briefing_v1";
    public static final int ID_READY = 4721;
    public static final int ID_BRIEFING = 4722;
    static final int RC_OPEN = 21, RC_PAUSE = 22, RC_OFF = 23, RC_READY_OPEN = 24;

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_READY) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_READY, "Jarvis bereit", NotificationManager.IMPORTANCE_MIN);
            ch.setDescription("Stiller Hinweis, solange Jarvis im Hintergrund auf das erste Entsperren wartet");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.enableLights(false);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
            nm.createNotificationChannel(ch);
        }
        if (nm.getNotificationChannel(CHANNEL_BRIEFING) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_BRIEFING, "Morgen-Briefing", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("„Guten Morgen – Ihr Briefing ist bereit“ (standardmäßig ohne Ton und Vibration)");
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setShowBadge(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(ch);
        }
    }

    public static boolean canNotify(Context c) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    private static PendingIntent internal(Context c, String action, int rc) {
        Intent i = new Intent(c, BriefingSystemReceiver.class).setAction(action).setPackage(c.getPackageName());
        return PendingIntent.getBroadcast(c, rc, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Dauer-Benachrichtigung des Dienstes – so unauffällig wie Android es zulässt. */
    static Notification ready(Context c) {
        ensureChannels(c);
        Intent open = new Intent(c, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, RC_READY_OPEN, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_READY)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle("Jarvis ist bereit")
            .setContentText("Briefing beim ersten Entsperren am Morgen")
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_DEFERRED)
            .addAction(0, "Heute pausieren", internal(c, BriefingSystemReceiver.ACTION_PAUSE, RC_PAUSE))
            .addAction(0, "Ausschalten", internal(c, BriefingSystemReceiver.ACTION_OFF, RC_OFF));
        return b.build();
    }

    /** „Guten Morgen – Ihr Briefing ist bereit“. Volltext nur entsperrt sichtbar. */
    static void briefing(Context c, String text) {
        if (!canNotify(c)) return;
        ensureChannels(c);
        String nonce = BriefingState.newNonce(c);
        Intent open = new Intent(c, MainActivity.class).setAction(BriefingLaunch.ACTION)
            .putExtra(BriefingLaunch.EXTRA_NONCE, nonce)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, RC_OPEN, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String title = "Guten Morgen – Ihr Briefing ist bereit";
        Notification pub = new NotificationCompat.Builder(c, CHANNEL_BRIEFING)
            .setSmallIcon(R.drawable.ic_stat_jarvis).setContentTitle(title).setContentText("Entsperren zum Ansehen").build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_BRIEFING)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub)
            .setTimeoutAfter(6 * BriefingRules.H);
        try { NotificationManagerCompat.from(c).notify(ID_BRIEFING, b.build()); } catch (SecurityException ignored) {}
    }
}
