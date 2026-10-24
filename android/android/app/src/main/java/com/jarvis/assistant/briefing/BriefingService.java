package com.jarvis.assistant.briefing;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * „Jarvis bereit“: kleiner Vordergrund-Dienst (Typ specialUse), der nur auf Bildschirm-aus und
 * Entsperren hört (Manifest-Receiver dafür funktionieren seit Android 8 nicht). Beim ersten
 * passenden Entsperren am Morgen: Kurzfassung als Benachrichtigung, optional laut vorlesen.
 * Kein KI-Aufruf und kein API-Schlüssel im Hintergrund – das volle Briefing gibt es in der App.
 */
public class BriefingService extends Service {
    public static final String ACTION_CHECK_NOW = "com.jarvis.assistant.briefing.CHECK_NOW";
    static final long SPEAK_DELAY_MS = 5000; // Bildschirm muss nach dem Entsperren 5 s an bleiben

    private static volatile boolean running = false;
    public static boolean isRunning() { return running; }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private BroadcastReceiver screenReceiver;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        Notification n = BriefingNotifier.ready(this);
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(BriefingNotifier.ID_READY, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(BriefingNotifier.ID_READY, n);
        } catch (Exception e) {
            // z. B. ForegroundServiceStartNotAllowedException – dann eben nicht
            stopSelf();
            return;
        }
        running = true;
        screenReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context c, Intent i) {
                String a = i.getAction();
                long now = System.currentTimeMillis();
                if (Intent.ACTION_SCREEN_OFF.equals(a)) BriefingState.recordScreenOff(c, now);
                else if (Intent.ACTION_USER_PRESENT.equals(a)) onUnlock(now, false);
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_USER_PRESENT);
        ContextCompat.registerReceiver(this, screenReceiver, f, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running || !BriefingState.backgroundEnabled(this) || !BriefingState.anyEnabled(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        // Nach Neustart/Update: das erste Entsperren ist evtl. schon vorbei → einmal nachprüfen
        if (intent != null && ACTION_CHECK_NOW.equals(intent.getAction()) && isUnlockedAndOn()) {
            onUnlock(System.currentTimeMillis(), true);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (screenReceiver != null) { try { unregisterReceiver(screenReceiver); } catch (Exception ignored) {} }
        worker.shutdownNow();
        super.onDestroy();
    }

    private boolean isUnlockedAndOn() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
        return pm != null && pm.isInteractive() && km != null && !km.isKeyguardLocked();
    }

    /** Entsperrt: erst Regeln prüfen (mit dem Stand VOR dieser Sitzung), dann Sitzung merken. Morgens Briefing, abends Rückblick. */
    private void onUnlock(long now, boolean fromBoot) {
        Context c = this;
        TimeZone tz = TimeZone.getDefault();
        long lastActivity = BriefingState.lastActivity(c);
        BriefingRules.Decision d = BriefingRules.decide(now, tz, lastActivity,
            BriefingState.restEndAt(c), BriefingState.restMs(c), BriefingState.lastBriefedDay(c),
            BriefingState.enabled(c), BriefingState.onboarded(c), BriefingState.gapHours(c), BriefingState.latestHour(c));
        // Sonntags (Wochenrückblick an) ersetzt der Wochenrückblick die Abendzusammenfassung
        final boolean weeklyDay = !d.ok && BriefingRules.weeklyReplacesEvening(now, tz, BriefingState.weeklyEnabled(c));
        BriefingRules.Decision e = d.ok ? null : weeklyDay
            ? BriefingRules.decideWeekly(now, tz, lastActivity, BriefingState.lastBriefingAt(c), BriefingState.lastWeeklyDay(c),
                BriefingState.weeklyEnabled(c), BriefingState.onboarded(c), BriefingState.weeklyHour(c))
            : BriefingRules.decideEvening(now, tz, lastActivity,
                BriefingState.lastBriefingAt(c), BriefingState.lastEveningDay(c),
                BriefingState.eveningEnabled(c), BriefingState.onboarded(c), BriefingState.eveningStartHour(c));
        if (!fromBoot) BriefingState.recordUnlock(c, now);
        BriefingRules.Decision go = d.ok ? d : e;
        if (go == null || !go.ok || go.day.equals(BriefingState.pausedDay(c)) || !busy.compareAndSet(false, true)) return;
        final boolean evening = !d.ok && !weeklyDay;
        final boolean weekly = !d.ok && weeklyDay;
        // sofort beanspruchen – kein doppeltes Briefing/kein doppelter Rückblick
        if (weekly) BriefingState.markWeekly(c, go.day, false);
        else if (evening) BriefingState.markEvening(c, go.day, false);
        else BriefingState.markBackground(c, go.day, false);
        worker.execute(() -> {
            try { if (weekly) runWeekly(now, go.day); else if (evening) runEvening(now, go.day); else runBriefing(now); } finally { busy.set(false); }
        });
    }

    /** Wochenrückblick: nur lokale Zahlen + Kalender der nächsten 7 Tage – kein Netz (schont Akku und Datenbudget). */
    private void runWeekly(long now, String day) {
        Context c = this;
        TimeZone tz = TimeZone.getDefault();
        List<BriefingText.Event> events = null;
        if (BriefingState.eveningContent(c, "calendar") && CalendarReader.granted(c)) {
            List<CalendarReader.Item> items = CalendarReader.read(c, 1, 7, now);
            if (items != null) {
                events = new ArrayList<>();
                for (CalendarReader.Item it : items) events.add(new BriefingText.Event(it.title, it.begin, it.allDay));
            }
        }
        BriefingText.WeekStats ws = BriefingState.eveningContent(c, "chats") ? BriefingState.weekStats(c, day) : null;
        if (ws != null && (!BriefingState.eveningContent(c, "notes") || !BriefingState.eveningContent(c, "timers"))) {
            boolean notes = BriefingState.eveningContent(c, "notes"), timers = BriefingState.eveningContent(c, "timers");
            ws = new BriefingText.WeekStats(ws.chats, ws.activeDays, ws.topics, notes ? ws.notes : 0, ws.memories,
                ws.remindersDone, timers ? ws.timers : 0, ws.nextReminders);
        }
        String text = BriefingText.composeWeekly(now, tz, ws, events, BriefingState.speakTitles(c));
        BriefingNotifier.weekly(c, text);
        if (BriefingState.speakAloud(c)) {
            try { Thread.sleep(SPEAK_DELAY_MS); } catch (InterruptedException ex) { return; }
            if (isUnlockedAndOn() && BriefingSpeaker.speak(c, text)) BriefingState.markWeeklySpoken(c);
        }
    }

    private void runEvening(long now, String day) {
        Context c = this;
        TimeZone tz = TimeZone.getDefault();
        BriefingText.Weather w = null;
        if (BriefingState.eveningContent(c, "weather")) {
            w = BriefingFetcher.weatherTomorrow(c, now, 5000);
            if (w == null) w = BriefingState.cachedWeatherTomorrow(c, now);
        }
        List<BriefingText.NewsItem> news = null;
        if (BriefingState.eveningContent(c, "news")) {
            news = BriefingFetcher.news(c, 5000);
            if (news == null) news = BriefingState.cachedNews(c, now);
        }
        List<BriefingText.Event> events = null;
        if (BriefingState.eveningContent(c, "calendar") && CalendarReader.granted(c)) {
            List<CalendarReader.Item> items = CalendarReader.read(c, 1, now);
            if (items != null) {
                events = new ArrayList<>();
                for (CalendarReader.Item it : items) events.add(new BriefingText.Event(it.title, it.begin, it.allDay));
            }
        }
        BriefingText.DayStats stats = BriefingState.eveningContent(c, "chats") ? BriefingState.todayStats(c, day) : null;
        if (stats != null && (!BriefingState.eveningContent(c, "notes") || !BriefingState.eveningContent(c, "timers"))) {
            stats = new BriefingText.DayStats(stats.chats, stats.topics,
                BriefingState.eveningContent(c, "notes") ? stats.notes : 0, BriefingState.eveningContent(c, "timers") ? stats.timers : 0);
        }
        String text = BriefingText.composeEvening(now, tz, stats, w, events, news, BriefingState.speakTitles(c));
        BriefingNotifier.evening(c, text);
        if (BriefingState.speakAloud(c)) {
            try { Thread.sleep(SPEAK_DELAY_MS); } catch (InterruptedException ex) { return; }
            if (isUnlockedAndOn() && BriefingSpeaker.speak(c, text)) BriefingState.markEveningSpoken(c);
        }
    }

    private void runBriefing(long now) {
        Context c = this;
        TimeZone tz = TimeZone.getDefault();
        BriefingText.Weather w = null;
        if (BriefingState.content(c, "weather")) {
            w = BriefingFetcher.weather(c, now, 5000);
            if (w == null) w = BriefingState.cachedWeather(c, now);
        }
        List<BriefingText.NewsItem> news = null;
        if (BriefingState.content(c, "news")) {
            news = BriefingFetcher.news(c, 5000);
            if (news == null) news = BriefingState.cachedNews(c, now);
        }
        List<BriefingText.Event> events = null;
        if (BriefingState.content(c, "calendar") && CalendarReader.granted(c)) {
            List<CalendarReader.Item> items = CalendarReader.read(c, 0, now);
            if (items != null) {
                events = new ArrayList<>();
                for (CalendarReader.Item it : items) events.add(new BriefingText.Event(it.title, it.begin, it.allDay));
            }
        }
        boolean titles = BriefingState.speakTitles(c);
        String text = BriefingText.compose(now, tz, w, events, news, titles);
        BriefingNotifier.briefing(c, text);
        if (BriefingState.speakAloud(c)) {
            try { Thread.sleep(SPEAK_DELAY_MS); } catch (InterruptedException e) { return; }
            if (isUnlockedAndOn() && BriefingSpeaker.speak(c, text)) BriefingState.markSpoken(c);
        }
    }

    // ---------- Starten/Stoppen ----------
    public static void start(Context c, boolean checkNow) {
        Intent i = new Intent(c, BriefingService.class);
        if (checkNow) i.setAction(ACTION_CHECK_NOW);
        try { ContextCompat.startForegroundService(c, i); } catch (Exception ignored) { /* Start nicht erlaubt – beim nächsten Öffnen erneut */ }
    }

    public static void stop(Context c) {
        try { c.stopService(new Intent(c, BriefingService.class)); } catch (Exception ignored) {}
    }
}
