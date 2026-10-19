package com.jarvis.assistant.updater;

import android.Manifest;
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

/** Benachrichtigung „Jarvis-Update vX bereit – tippen zum Installieren“ im Kanal „Updates“. */
public final class UpdateNotifier {
    public static final String CHANNEL = "updates";
    public static final String ACTION_INSTALL = "com.jarvis.assistant.action.INSTALL_UPDATE";
    static final int NOTIFICATION_ID = 4711;

    private UpdateNotifier() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Updates", NotificationManager.IMPORTANCE_DEFAULT);
                ch.setDescription("Hinweise auf neue Jarvis-Versionen");
                nm.createNotificationChannel(ch);
            }
        }
    }

    public static boolean canNotify(Context c) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    static void notifyReady(Context c, String versionName) {
        if (!canNotify(c)) return; // Hinweis erscheint dann beim nächsten Öffnen in der App
        ensureChannel(c);
        Intent open = new Intent(c, MainActivity.class)
            .setAction(ACTION_INSTALL)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 1, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("Jarvis-Update v" + versionName + " bereit")
            .setContentText("Tippen zum Installieren")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, b.build());
        } catch (SecurityException ignored) { /* Berechtigung zwischenzeitlich entzogen */ }
    }

    static void cancel(Context c) {
        NotificationManagerCompat.from(c).cancel(NOTIFICATION_ID);
    }
}
