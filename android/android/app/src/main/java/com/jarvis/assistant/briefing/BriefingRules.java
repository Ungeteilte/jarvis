package com.jarvis.assistant.briefing;

import java.util.Calendar;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Wann startet das Morgen-Briefing von selbst? Spiegel von js/core/briefing/trigger.js –
 * beide prüfen dieselben Fälle (src/test/resources/briefing-rules.json).
 * Reine Java-Logik ohne Android und ohne java.time (minSdk 23).
 */
public final class BriefingRules {
    private BriefingRules() {}

    public static final long H = 3600000L;
    public static final int DAY_START_HOUR = 3;
    public static final int NIGHT_LOCK_HOUR = 23;
    public static final int EARLY_END_HOUR = 5;
    public static final int RULE_B_MIN_HOUR = 6;
    public static final long REST_MS = 3 * H;

    public static final class Decision {
        public final boolean ok;
        public final String reason;
        public final String day;
        Decision(boolean ok, String reason, String day) { this.ok = ok; this.reason = reason; this.day = day; }
        @Override public String toString() { return ok + "/" + reason + "/" + day; }
    }

    public static int hourOf(long ms, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz, Locale.ROOT);
        c.setTimeInMillis(ms);
        return c.get(Calendar.HOUR_OF_DAY);
    }

    /** „2026-10-20“ – vor 03:00 Uhr Ortszeit noch der Vortag. */
    public static String dayKey(long ms, TimeZone tz) {
        Calendar c = Calendar.getInstance(tz, Locale.ROOT);
        c.setTimeInMillis(ms);
        if (c.get(Calendar.HOUR_OF_DAY) < DAY_START_HOUR) c.add(Calendar.DATE, -1);
        return String.format(Locale.ROOT, "%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    public static int clampGap(int h) { return Math.max(3, Math.min(8, h)); }
    public static int clampEveningStart(int h) { return Math.max(17, Math.min(22, h)); }
    /** Kein Rückblick in der ersten Stunde nach einem Morgen-Briefing. */
    public static final long EVENING_AFTER_BRIEFING_MS = H;

    /**
     * Abendzusammenfassung – Spiegel von shouldEvening in js/core/briefing/evening.js
     * (gemeinsame Fälle: src/test/resources/evening-rules.json).
     * Fenster startHour … 23:00, einmal pro Tag, nicht beim allerersten Start.
     */
    public static Decision decideEvening(long nowMs, TimeZone tz, long lastActivityMs, long lastBriefingAtMs,
                                         String lastEveningDay, boolean enabled, boolean onboarded, int startHour) {
        String day = dayKey(nowMs, tz);
        if (!enabled) return new Decision(false, "disabled", day);
        if (!onboarded) return new Decision(false, "onboarding", day);
        if (day.equals(lastEveningDay)) return new Decision(false, "already", day);
        int h = hourOf(nowMs, tz);
        if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return new Decision(false, "night", day);
        if (h < clampEveningStart(startHour)) return new Decision(false, "early", day);
        if (lastActivityMs <= 0) return new Decision(false, "first-start", day);
        if (nowMs - lastActivityMs < 0) return new Decision(false, "clock", day);
        long sinceBriefing = nowMs - lastBriefingAtMs;
        if (lastBriefingAtMs > 0 && sinceBriefing >= 0 && sinceBriefing < EVENING_AFTER_BRIEFING_MS) return new Decision(false, "recent-briefing", day);
        return new Decision(true, "evening", day);
    }
    public static int clampLatest(int h) { return Math.max(8, Math.min(23, h)); }
    public static int clampWeeklyHour(int h) { return Math.max(9, Math.min(21, h)); }

    /** Ist der Tages-Schlüssel „2026-10-25“ ein Sonntag? (Kalender-Datum, ohne Zeitzone.) */
    public static boolean isSundayKey(String day) {
        try {
            String[] p = day.split("-");
            Calendar c = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            c.clear();
            c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]));
            return c.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY;
        } catch (Exception e) { return false; }
    }

    /** Sonntags ersetzt der Wochenrückblick (wenn an) die Abendzusammenfassung. */
    public static boolean weeklyReplacesEvening(long nowMs, TimeZone tz, boolean weeklyEnabled) {
        return weeklyEnabled && isSundayKey(dayKey(nowMs, tz));
    }

    /**
     * Wochenrückblick – Spiegel von shouldWeekly in js/core/briefing/weekly.js
     * (gemeinsame Fälle: src/test/resources/weekly-rules.json).
     * Nur sonntags, Fenster hour … 23:00, einmal pro Sonntag, nicht beim allerersten Start,
     * nicht in der ersten Stunde nach einem Morgen-Briefing.
     */
    public static Decision decideWeekly(long nowMs, TimeZone tz, long lastActivityMs, long lastBriefingAtMs,
                                        String lastWeeklyDay, boolean enabled, boolean onboarded, int hour) {
        String day = dayKey(nowMs, tz);
        if (!enabled) return new Decision(false, "disabled", day);
        if (!onboarded) return new Decision(false, "onboarding", day);
        if (!isSundayKey(day)) return new Decision(false, "not-sunday", day);
        if (day.equals(lastWeeklyDay)) return new Decision(false, "already", day);
        int h = hourOf(nowMs, tz);
        if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return new Decision(false, "night", day);
        if (h < clampWeeklyHour(hour)) return new Decision(false, "early", day);
        if (lastActivityMs <= 0) return new Decision(false, "first-start", day);
        if (nowMs - lastActivityMs < 0) return new Decision(false, "clock", day);
        long sinceBriefing = nowMs - lastBriefingAtMs;
        if (lastBriefingAtMs > 0 && sinceBriefing >= 0 && sinceBriefing < EVENING_AFTER_BRIEFING_MS) return new Decision(false, "recent-briefing", day);
        return new Decision(true, "weekly", day);
    }

    /**
     * @param lastActivityMs letzte Aktivität vor der aktuellen Sitzung (0 = unbekannt)
     * @param restEndMs/restMs zuletzt beendete Ruhephase ≥ 3 h (0 = keine)
     */
    public static Decision decide(long nowMs, TimeZone tz, long lastActivityMs, long restEndMs, long restMs,
                                  String lastBriefedDay, boolean enabled, boolean onboarded, int gapHours, int latestHour) {
        String day = dayKey(nowMs, tz);
        if (!enabled) return new Decision(false, "disabled", day);
        if (!onboarded) return new Decision(false, "onboarding", day);
        if (day.equals(lastBriefedDay)) return new Decision(false, "already", day);
        int h = hourOf(nowMs, tz);
        if (h >= NIGHT_LOCK_HOUR || h < DAY_START_HOUR) return new Decision(false, "night", day);
        if (h >= clampLatest(latestHour)) return new Decision(false, "late", day);
        if (lastActivityMs <= 0) return new Decision(false, "first-start", day);
        long gap = nowMs - lastActivityMs;
        if (gap < 0) return new Decision(false, "clock", day);
        long need = clampGap(gapHours) * H;
        if (h < EARLY_END_HOUR) return gap * 2 >= need * 3 ? new Decision(true, "gap-early", day) : new Decision(false, "early", day);
        if (gap >= need) return new Decision(true, "gap", day);
        if (h >= RULE_B_MIN_HOUR) {
            int lh = hourOf(lastActivityMs, tz);
            boolean nightUse = lh >= NIGHT_LOCK_HOUR || lh < EARLY_END_HOUR;
            boolean restToday = restEndMs > 0 && restMs >= REST_MS && restEndMs <= nowMs && dayKey(restEndMs, tz).equals(day);
            if ((nightUse && gap >= REST_MS) || restToday) return new Decision(true, "rest", day);
        }
        return new Decision(false, "short-gap", day);
    }

    /** Millisekunden bis zur nächsten Ortszeit hh:mm (für das tägliche Vorladen). */
    public static long delayUntil(long nowMs, TimeZone tz, int hour, int minute) {
        Calendar c = Calendar.getInstance(tz, Locale.ROOT);
        c.setTimeInMillis(nowMs);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= nowMs) c.add(Calendar.DATE, 1);
        return c.getTimeInMillis() - nowMs;
    }
}
