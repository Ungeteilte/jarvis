package com.jarvis.assistant.events;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.CalendarContract;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.jarvis.assistant.MainActivity;
import com.jarvis.assistant.R;
import com.jarvis.assistant.briefing.BriefingNotifier;
import com.jarvis.assistant.briefing.BriefingState;
import com.jarvis.assistant.briefing.CalendarReader;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * v0.9.4 Termin-Hinweise (Android). Kein Dauerdienst: ein Kalender-Scan (alle 12 h, bei Kalender-Änderungen,
 * nach Neustart/Update, beim Entsperren höchstens alle 15 Min. und beim Speichern in der App) stellt genau
 * EINEN Alarm zum nächsten Hinweis. Der Alarm zeigt die Benachrichtigung und plant den nächsten.
 * Liest nur den Kalender (READ_CALENDAR), schickt nichts nach außen.
 */
public final class EventReminders {
    private EventReminders() {}

    public static final String CHANNEL = "termine_v1";
    static final String ACTION_FIRE = "com.jarvis.assistant.events.FIRE";
    static final String WORK_SCAN = "jarvis-event-scan";
    static final String WORK_WATCH = "jarvis-event-watch";
    static final String WORK_SPEAK = "jarvis-event-speak";
    private static final String PREFS = "jarvis_events";
    private static final int RC_ALARM = 31, RC_OPEN = 32;
    private static final int ID_BASE = 47300;
    private static final long UNLOCK_THROTTLE_MS = 15 * EventReminderRules.MIN;
    private static final ExecutorService BG = Executors.newSingleThreadExecutor();

    // ---------- Einstellungen (kommen per syncBriefing aus der App: { events: { enabled, leadMin, speak } }) ----------
    static JSONObject cfg(Context c) {
        JSONObject e = BriefingState.sync(c).optJSONObject("events");
        return e == null ? new JSONObject() : e;
    }
    public static boolean enabled(Context c) { return cfg(c).optBoolean("enabled", true); }
    public static int leadMin(Context c) { return EventReminderRules.clampLead(cfg(c).optInt("leadMin", EventReminderRules.DEFAULT_LEAD)); }
    static boolean speakWanted(Context c) { return cfg(c).optBoolean("speak", false); }
    /** Aktiv = eingeschaltet, Einrichtung fertig und Kalender lesbar. */
    public static boolean active(Context c) { return enabled(c) && BriefingState.onboarded(c) && CalendarReader.granted(c); }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    public static long nextAt(Context c) { return prefs(c).getLong("nextAt", 0); }

    public static boolean exactAllowed(Context c) {
        if (Build.VERSION.SDK_INT < 31) return true;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    // ---------- Einstieg ----------
    /** Im Hintergrund neu planen (alle Auslöser außer dem Alarm selbst). */
    public static void applyAsync(Context c) {
        Context app = c.getApplicationContext();
        BG.execute(() -> { try { apply(app); } catch (Exception ignored) {} });
    }

    /** Beim Entsperren: höchstens alle 15 Minuten neu scannen (fängt kurzfristig eingetragene Termine). */
    public static void onUnlock(Context c, long now) {
        SharedPreferences p = prefs(c);
        if (now - p.getLong("lastUnlockScan", 0) < UNLOCK_THROTTLE_MS) return;
        p.edit().putLong("lastUnlockScan", now).apply();
        applyAsync(c);
    }

    /** Arbeit einrichten bzw. alles abbauen, dann einmal scannen. Auf einem Hintergrund-Thread aufrufen. */
    public static synchronized void apply(Context c) {
        if (!active(c)) { cancelAll(c); return; }
        ensureWork(c);
        scan(c);
    }

    static void ensureWork(Context c) {
        WorkManager wm = WorkManager.getInstance(c);
        wm.enqueueUniquePeriodicWork(WORK_SCAN, ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(EventScanWorker.class, 12, TimeUnit.HOURS).build());
        if (Build.VERSION.SDK_INT >= 24) wm.enqueueUniqueWork(WORK_WATCH, ExistingWorkPolicy.KEEP, watchRequest());
    }

    /** Einmal-Arbeit, die startet, sobald sich im Kalender etwas ändert (gebündelt, 1–10 Min.). */
    static OneTimeWorkRequest watchRequest() {
        Constraints.Builder cb = new Constraints.Builder();
        if (Build.VERSION.SDK_INT >= 24) {
            cb.addContentUriTrigger(CalendarContract.Events.CONTENT_URI, true)
              .setTriggerContentUpdateDelay(1, TimeUnit.MINUTES)
              .setTriggerContentMaxDelay(10, TimeUnit.MINUTES);
        }
        return new OneTimeWorkRequest.Builder(EventScanWorker.class)
            .setConstraints(cb.build())
            .setInputData(new Data.Builder().putBoolean("watch", true).build())
            .build();
    }

    public static void cancelAll(Context c) {
        try {
            WorkManager wm = WorkManager.getInstance(c);
            wm.cancelUniqueWork(WORK_SCAN);
            wm.cancelUniqueWork(WORK_WATCH);
        } catch (Exception ignored) {}
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(c));
        prefs(c).edit().putLong("nextAt", 0).apply();
    }

    // ---------- Scan + Alarm ----------
    /** Kalender lesen, fällige Hinweise zeigen, Alarm zum nächsten stellen. */
    static synchronized void scan(Context c) {
        if (!active(c)) { cancelAll(c); return; }
        long now = System.currentTimeMillis();
        List<EventReminderRules.Ev> evs = readUpcoming(c, now);
        if (evs == null) { cancelAll(c); return; }
        Map<String, Long> notified = EventReminderRules.prune(loadNotified(c), now);
        EventReminderRules.Plan plan = EventReminderRules.plan(evs, now, leadMin(c), notified.keySet());
        if (!plan.due.isEmpty()) {
            TimeZone tz = TimeZone.getDefault();
            for (EventReminderRules.Ev e : plan.due) {
                notify(c, e, now, tz);
                notified.put(e.key(), e.begin);
            }
            maybeSpeak(c, plan.due, now, tz);
        }
        saveNotified(c, notified);
        setAlarm(c, plan.nextAt);
    }

    /** Termine von jetzt bis +36 h (nicht abgesagt, sichtbarer Kalender). null = keine Erlaubnis. */
    static List<EventReminderRules.Ev> readUpcoming(Context c, long now) {
        if (!CalendarReader.granted(c)) return null;
        Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, now - 5 * EventReminderRules.MIN);
        ContentUris.appendId(b, now + EventReminderRules.LOOKAHEAD_MS);
        String[] proj = {
            CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.TITLE,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS, CalendarContract.Instances.VISIBLE
        };
        List<EventReminderRules.Ev> out = new ArrayList<>();
        try (Cursor cur = c.getContentResolver().query(b.build(), proj, null, null, CalendarContract.Instances.BEGIN + " ASC")) {
            if (cur == null) return out;
            while (cur.moveToNext() && out.size() < 200) {
                if (cur.getInt(6) == 0) continue;
                if (cur.getInt(5) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue;
                out.add(new EventReminderRules.Ev(cur.getLong(0), cur.getLong(1), cur.getLong(2), cur.getInt(3) == 1, cur.getString(4)));
            }
        } catch (SecurityException e) {
            return null;
        }
        return out;
    }

    private static PendingIntent alarmIntent(Context c) {
        Intent i = new Intent(c, EventReminderReceiver.class).setAction(ACTION_FIRE).setPackage(c.getPackageName());
        return PendingIntent.getBroadcast(c, RC_ALARM, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Genau ein Alarm: genau, wenn „Wecker & Erinnerungen“ erlaubt ist, sonst ungefähr (Android darf verschieben). */
    static void setAlarm(Context c, long at) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = alarmIntent(c);
        if (at <= 0) { am.cancel(pi); prefs(c).edit().putLong("nextAt", 0).apply(); return; }
        try {
            if (exactAllowed(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
        prefs(c).edit().putLong("nextAt", at).apply();
    }

    private static Map<String, Long> loadNotified(Context c) {
        Map<String, Long> m = new HashMap<>();
        try {
            JSONObject o = new JSONObject(prefs(c).getString("notified", "{}"));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) { String k = it.next(); m.put(k, o.optLong(k)); }
        } catch (Exception ignored) {}
        return m;
    }

    private static void saveNotified(Context c, Map<String, Long> m) {
        prefs(c).edit().putString("notified", new JSONObject(m).toString()).apply();
    }

    // ---------- Benachrichtigung + Vorlesen ----------
    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        // Standard-Wichtigkeit (in der Statusleiste sichtbar), aber ohne Ton und Vibration – in Android änderbar
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Termin-Hinweise", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setDescription("Kurzer Hinweis vor Terminen aus Ihrem Kalender (standardmäßig ohne Ton und Vibration)");
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setShowBadge(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
    }

    static int notifId(EventReminderRules.Ev e) { return ID_BASE + Math.floorMod(e.key().hashCode(), 1000); }

    private static PendingIntent openIntent(Context c, EventReminderRules.Ev e) {
        Intent view = null;
        if (e.id > 0) {
            view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, e.id), "vnd.android.cursor.item/event")
                .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, e.begin)
                .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, Math.max(e.end, e.begin))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (view.resolveActivity(c.getPackageManager()) == null) view = null;
        }
        if (view == null) {
            view = new Intent(c, MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        }
        return PendingIntent.getActivity(c, RC_OPEN + notifId(e), view, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean notify(Context c, EventReminderRules.Ev e, long now, TimeZone tz) {
        if (!BriefingNotifier.canNotify(c)) return false;
        ensureChannel(c);
        String title = EventReminderRules.notifyTitle(e, now);
        Notification pub = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_jarvis).setContentTitle(title).setContentText("Entsperren zum Ansehen").build();
        Notification n = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_jarvis)
            .setContentTitle(title)
            .setContentText(EventReminderRules.notifyText(e, now, tz))
            .setSubText("Jarvis")
            .setCategory(NotificationCompat.CATEGORY_EVENT)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub)
            .setContentIntent(openIntent(c, e))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(Math.max(60_000L, e.begin - now + 30 * EventReminderRules.MIN))
            .build();
        try { NotificationManagerCompat.from(c).notify(notifId(e), n); return true; } catch (SecurityException ex) { return false; }
    }

    /** Vorlesen nur zusätzlich: Option an, „Im Hintergrund bereithalten“ an, 7–22 Uhr; Ton/Anruf prüft der Sprecher. */
    static void maybeSpeak(Context c, List<EventReminderRules.Ev> due, long now, TimeZone tz) {
        if (!speakWanted(c) || !BriefingState.backgroundEnabled(c) || !EventReminderRules.speakHour(now, tz)) return;
        long first = Long.MAX_VALUE;
        for (EventReminderRules.Ev e : due) first = Math.min(first, e.begin);
        String text = EventReminderRules.speechText(due, now, tz, BriefingState.speakTitles(c));
        WorkManager.getInstance(c).enqueueUniqueWork(WORK_SPEAK, ExistingWorkPolicy.REPLACE,
            new OneTimeWorkRequest.Builder(EventSpeakWorker.class)
                .setInputData(new Data.Builder().putString("text", text).putLong("until", first).build())
                .build());
    }

    /** Test aus den Einstellungen: Beispiel-Hinweis (+ Vorlesen, falls eingestellt und erlaubt). */
    public static boolean test(Context c) {
        long now = System.currentTimeMillis();
        int lead = leadMin(c);
        EventReminderRules.Ev e = new EventReminderRules.Ev(-1, now + lead * EventReminderRules.MIN, now + (lead + 30) * EventReminderRules.MIN, false, "Beispieltermin (Test)");
        boolean ok = notify(c, e, now, TimeZone.getDefault());
        if (ok) { List<EventReminderRules.Ev> one = new ArrayList<>(); one.add(e); maybeSpeak(c, one, now, TimeZone.getDefault()); }
        return ok;
    }

    /** Für die Einstellungen in der App. */
    public static JSONObject status(Context c) throws Exception {
        JSONObject o = new JSONObject();
        o.put("enabled", enabled(c));
        o.put("leadMin", leadMin(c));
        o.put("calendar", CalendarReader.granted(c) ? "granted" : "denied");
        o.put("notifications", BriefingNotifier.canNotify(c));
        o.put("exact", exactAllowed(c));
        long next = nextAt(c);
        o.put("nextAt", active(c) && next > System.currentTimeMillis() ? next : 0);
        return o;
    }
}
