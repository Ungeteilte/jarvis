package com.jarvis.assistant.tools;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * v0.9 W5 – Kalender-ENTWURF (Intent.ACTION_INSERT auf CalendarContract.Events.CONTENT_URI).
 * Keine Schreibberechtigung: Die Kalender-App öffnet sich vorausgefüllt, du tippst dort „Speichern“.
 * Reines Java (JUnit). Schlüssel = CalendarContract.EXTRA_EVENT_BEGIN_TIME/END_TIME, Events.TITLE/EVENT_LOCATION.
 */
public final class CalendarDraftSpec {
    public static final String ACTION_INSERT = "android.intent.action.INSERT";
    public static final String EVENTS_URI = "content://com.android.calendar/events";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BEGIN_TIME = "beginTime";
    public static final String EXTRA_END_TIME = "endTime";
    public static final String EXTRA_EVENT_LOCATION = "eventLocation";
    public static final long DEFAULT_DURATION_MS = 60 * 60 * 1000L;

    public final String title;
    public final long begin;
    public final long end;
    public final String location;

    private CalendarDraftSpec(String title, long begin, long end, String location) {
        this.title = title;
        this.begin = begin;
        this.end = end;
        this.location = location;
    }

    private static String clean(String s, int max) {
        if (s == null) return "";
        String t = s.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        return t.length() > max ? t.substring(0, max) : t;
    }

    /** @throws IllegalArgumentException bei leerem Titel oder fehlendem Beginn. Ende ≤ Beginn → Beginn + 1 h. */
    public static CalendarDraftSpec of(String title, Long begin, Long end, String location) {
        String t = clean(title, 120);
        if (t.isEmpty()) throw new IllegalArgumentException("Der Termin braucht einen Titel.");
        if (begin == null || begin <= 0) throw new IllegalArgumentException("Der Termin braucht einen Beginn.");
        long e = end == null || end <= begin ? begin + DEFAULT_DURATION_MS : end;
        return new CalendarDraftSpec(t, begin, e, clean(location, 80));
    }

    public Map<String, Object> extras() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(EXTRA_TITLE, title);
        m.put(EXTRA_BEGIN_TIME, begin);
        m.put(EXTRA_END_TIME, end);
        if (!location.isEmpty()) m.put(EXTRA_EVENT_LOCATION, location);
        return m;
    }
}
