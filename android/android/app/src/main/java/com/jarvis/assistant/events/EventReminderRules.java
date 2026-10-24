package com.jarvis.assistant.events;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/**
 * v0.9.4 Termin-Hinweise – reine Regeln (ohne Android, JUnit-testbar).
 * Aus der Terminliste der nächsten Stunden: welche Hinweise sind jetzt fällig, wann ist der nächste?
 * Ganztägige Termine bleiben still. Bereits gemeldete Termine (Schlüssel eventId:begin) nie doppelt.
 */
public final class EventReminderRules {
    private EventReminderRules() {}

    public static final long MIN = 60_000L;
    public static final long H = 60 * MIN;
    public static final int[] LEAD_OPTIONS = {5, 10, 15, 30, 60};
    public static final int DEFAULT_LEAD = 15;
    /** So weit voraus wird der Kalender gelesen (deckt die Lücke bis zum nächsten 12-h-Scan sicher ab). */
    public static final long LOOKAHEAD_MS = 36 * H;
    /** Gemeldete Schlüssel so lange merken (danach liegt der Termin sicher in der Vergangenheit). */
    public static final long KEEP_NOTIFIED_MS = 48 * H;
    /** Toleranz: ein Alarm, der ein paar Sekunden zu früh kommt, zählt schon. */
    public static final long EARLY_TOLERANCE_MS = 30_000L;
    /** Vorlesen nur tagsüber (Ortszeit, [7, 22)). */
    public static final int SPEAK_FROM_HOUR = 7, SPEAK_UNTIL_HOUR = 22;

    public static final class Ev {
        public final long id, begin, end; public final boolean allDay; public final String title;
        public Ev(long id, long begin, long end, boolean allDay, String title) {
            this.id = id; this.begin = begin; this.end = end; this.allDay = allDay; this.title = title == null ? "" : title;
        }
        public String key() { return id + ":" + begin; }
    }

    public static final class Plan {
        public final List<Ev> due; public final long nextAt;
        Plan(List<Ev> due, long nextAt) { this.due = due; this.nextAt = nextAt; }
    }

    /** Nächstliegende erlaubte Vorlaufzeit (wie js/core/event-reminders.js clampLead). */
    public static int clampLead(int v) {
        if (v <= 0) return DEFAULT_LEAD;
        int best = LEAD_OPTIONS[0];
        for (int o : LEAD_OPTIONS) if (Math.abs(o - v) < Math.abs(best - v)) best = o;
        return best;
    }

    /**
     * Fällig: nicht ganztägig, noch nicht gemeldet, beginnt in der Zukunft und die Hinweis-Zeit
     * (Beginn − Vorlauf) ist erreicht – auch nachträglich (z. B. Termin kurzfristig eingetragen oder Handy war aus).
     * nextAt: frühester künftiger Hinweis (0 = keiner im Fenster).
     */
    public static Plan plan(List<Ev> events, long now, int leadMin, Set<String> notified) {
        long lead = clampLead(leadMin) * MIN;
        List<Ev> due = new ArrayList<>();
        long next = 0;
        if (events != null) for (Ev e : events) {
            if (e == null || e.allDay || e.begin <= now) continue;
            if (notified != null && notified.contains(e.key())) continue;
            long fire = e.begin - lead;
            if (fire <= now + EARLY_TOLERANCE_MS) due.add(e);
            else if (next == 0 || fire < next) next = fire;
        }
        return new Plan(due, next);
    }

    /** Gemeldete Schlüssel (key → Beginn) ohne die längst vergangenen. */
    public static Map<String, Long> prune(Map<String, Long> notified, long now) {
        Map<String, Long> out = new HashMap<>();
        if (notified != null) for (Map.Entry<String, Long> en : notified.entrySet()) {
            if (en.getValue() != null && en.getValue() > now - KEEP_NOTIFIED_MS) out.put(en.getKey(), en.getValue());
        }
        return out;
    }

    public static boolean speakHour(long now, TimeZone tz) {
        Calendar cal = Calendar.getInstance(tz, Locale.ROOT);
        cal.setTimeInMillis(now);
        int h = cal.get(Calendar.HOUR_OF_DAY);
        return h >= SPEAK_FROM_HOUR && h < SPEAK_UNTIL_HOUR;
    }

    public static String clock(long ms, TimeZone tz) {
        Calendar cal = Calendar.getInstance(tz, Locale.ROOT);
        cal.setTimeInMillis(ms);
        return String.format(Locale.ROOT, "%d:%02d", cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE));
    }

    /** Minuten bis zum Beginn (aufgerundet, mindestens 1). */
    public static int minutesUntil(long begin, long now) {
        return (int) Math.max(1, (begin - now + MIN - 1) / MIN);
    }

    private static String inMinutes(int m) { return m == 1 ? "in einer Minute" : "in " + m + " Minuten"; }

    private static String safeTitle(String t) {
        String s = t == null ? "" : t.replaceAll("[\\p{Cntrl}\\u2028\\u2029]", " ").replaceAll("\\s+", " ").trim();
        if (s.length() > 80) s = s.substring(0, 79).trim() + "…";
        return s;
    }

    /** Titel der Benachrichtigung (ohne Termintitel – der steht im Text, damit die Sperrbildschirm-Variante ihn weglassen kann). */
    public static String notifyTitle(Ev e, long now) {
        return "Termin " + inMinutes(minutesUntil(e.begin, now));
    }

    /** Text der Benachrichtigung: Titel + Uhrzeit. Ohne Titel → neutral. */
    public static String notifyText(Ev e, long now, TimeZone tz) {
        String t = safeTitle(e.title);
        String at = "um " + clock(e.begin, tz) + " Uhr";
        return t.isEmpty() ? "Ihr nächster Termin beginnt " + at + "." : "„" + t + "“ beginnt " + at + ".";
    }

    /** Vorlese-Satz. Termintitel nur, wenn „Termintitel vorlesen“ an ist (wie beim Briefing). */
    public static String speechText(List<Ev> due, long now, TimeZone tz, boolean withTitles) {
        if (due == null || due.isEmpty()) return "";
        if (due.size() == 1) {
            Ev e = due.get(0);
            String t = withTitles ? safeTitle(e.title) : "";
            String when = inMinutes(minutesUntil(e.begin, now)) + ", um " + clock(e.begin, tz) + " Uhr";
            return t.isEmpty() ? "Kurzer Hinweis: Ihr nächster Termin beginnt " + when + "."
                : "Kurzer Hinweis: " + when + " beginnt Ihr Termin „" + t + "“.";
        }
        long first = Long.MAX_VALUE;
        for (Ev e : due) first = Math.min(first, e.begin);
        return "Kurzer Hinweis: Sie haben " + due.size() + " Termine, der erste beginnt " + inMinutes(minutesUntil(first, now)) + ".";
    }
}
