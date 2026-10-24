package com.jarvis.assistant.briefing;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** Termine eines Tages (oder mehrerer Tage, Wochenrückblick) aus dem Gerätekalender (READ_CALENDAR, nur lesend). */
public final class CalendarReader {
    private CalendarReader() {}

    public static final class Item {
        public final String title, location; public final long begin, end; public final boolean allDay;
        Item(String title, String location, long begin, long end, boolean allDay) {
            this.title = BriefingText.clean(title, 120); this.location = BriefingText.clean(location, 60);
            this.begin = begin; this.end = end; this.allDay = allDay;
        }
    }

    public static boolean granted(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED;
    }

    /** dayOffset 0 = heute, 1 = morgen (Ortszeit). Ohne Erlaubnis → null. */
    public static List<Item> read(Context c, int dayOffset, long nowMs) { return read(c, dayOffset, 1, nowMs); }

    /** days aufeinanderfolgende Tage ab dayOffset (1…7), höchstens 20 Termine. Ohne Erlaubnis → null. */
    public static List<Item> read(Context c, int dayOffset, int days, long nowMs) {
        if (!granted(c)) return null;
        int span = Math.max(1, Math.min(7, days));
        TimeZone tz = TimeZone.getDefault();
        Calendar cal = Calendar.getInstance(tz, Locale.ROOT);
        cal.setTimeInMillis(nowMs);
        cal.add(Calendar.DATE, dayOffset);
        cal.set(Calendar.HOUR_OF_DAY, 0); cal.set(Calendar.MINUTE, 0); cal.set(Calendar.SECOND, 0); cal.set(Calendar.MILLISECOND, 0);
        long start = cal.getTimeInMillis();
        String dayUtc = String.format(Locale.ROOT, "%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
        cal.add(Calendar.DATE, span - 1);
        String lastDayUtc = String.format(Locale.ROOT, "%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH));
        cal.add(Calendar.DATE, 1);
        long end = cal.getTimeInMillis();

        // Ganztägige Termine liegen in UTC – deshalb etwas weiter abfragen und danach filtern
        Uri.Builder b = CalendarContract.Instances.CONTENT_URI.buildUpon();
        ContentUris.appendId(b, start - 14 * BriefingRules.H);
        ContentUris.appendId(b, end + 14 * BriefingRules.H);
        String[] proj = {
            CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.SELF_ATTENDEE_STATUS, CalendarContract.Instances.VISIBLE
        };
        List<Item> out = new ArrayList<>();
        Calendar utc = Calendar.getInstance(TimeZone.getTimeZone("UTC"), Locale.ROOT);
        try (Cursor cur = c.getContentResolver().query(b.build(), proj, null, null, CalendarContract.Instances.BEGIN + " ASC")) {
            if (cur == null) return out;
            while (cur.moveToNext() && out.size() < 20) {
                if (cur.getInt(6) == 0) continue; // ausgeblendeter Kalender
                if (cur.getInt(5) == CalendarContract.Attendees.ATTENDEE_STATUS_DECLINED) continue;
                long bgn = cur.getLong(1), en = cur.getLong(2);
                boolean allDay = cur.getInt(3) == 1;
                if (allDay) {
                    utc.setTimeInMillis(bgn);
                    String d = String.format(Locale.ROOT, "%04d-%02d-%02d", utc.get(Calendar.YEAR), utc.get(Calendar.MONTH) + 1, utc.get(Calendar.DAY_OF_MONTH));
                    if (d.compareTo(dayUtc) < 0 || d.compareTo(lastDayUtc) > 0) continue;
                } else if (!(bgn < end && Math.max(en, bgn) >= start)) {
                    continue;
                }
                out.add(new Item(cur.getString(0), cur.getString(4), bgn, en, allDay));
            }
        } catch (SecurityException e) {
            return null;
        }
        return out;
    }
}
