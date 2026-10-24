package com.jarvis.assistant.briefing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Scanner;
import java.util.TimeZone;

/** Wochenrückblick (v0.9.3): gleiche Fälle wie tests/weekly.test.mjs (weekly-rules.json) + Kurzfassung. */
public class WeeklyTest {
    private static final TimeZone TZ = TimeZone.getTimeZone("Europe/Berlin");
    private static long ms(String iso) { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }

    private static JSONObject fixture() throws Exception {
        try (InputStream in = WeeklyTest.class.getResourceAsStream("/weekly-rules.json");
             Scanner s = new Scanner(in, StandardCharsets.UTF_8.name()).useDelimiter("\\A")) {
            return new JSONObject(s.next());
        }
    }

    @Test
    public void sharedFixtureMatchesJs() throws Exception {
        JSONObject f = fixture();
        TimeZone tz = TimeZone.getTimeZone(f.getString("timeZone"));
        JSONArray cases = f.getJSONArray("cases");
        assertTrue(cases.length() >= 20);
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            long now = ms(c.getString("now"));
            long last = c.isNull("lastActiveAt") ? 0 : ms(c.getString("lastActiveAt"));
            long lb = c.isNull("lastBriefingAt") ? 0 : ms(c.getString("lastBriefingAt"));
            BriefingRules.Decision d = BriefingRules.decideWeekly(now, tz, last, lb, c.optString("lastWeeklyDay", ""),
                c.optBoolean("enabled", true), c.optBoolean("onboarded", true), c.optInt("hour", 18));
            JSONObject e = c.getJSONObject("expect");
            String name = c.getString("name");
            assertEquals(name + " ok", e.getBoolean("ok"), d.ok);
            assertEquals(name + " reason", e.getString("reason"), d.reason);
            assertEquals(name + " day", e.getString("day"), d.day);
        }
    }

    @Test
    public void sundayAndReplacement() {
        assertTrue(BriefingRules.isSundayKey("2026-10-25"));
        assertFalse(BriefingRules.isSundayKey("2026-10-26"));
        assertFalse(BriefingRules.isSundayKey("kaputt"));
        assertTrue(BriefingRules.weeklyReplacesEvening(ms("2026-10-25T19:00:00+01:00"), TZ, true));
        assertFalse(BriefingRules.weeklyReplacesEvening(ms("2026-10-25T19:00:00+01:00"), TZ, false));
        assertTrue("02:30 Montag gehört noch zum Sonntag", BriefingRules.weeklyReplacesEvening(ms("2026-10-26T02:30:00+01:00"), TZ, true));
        assertFalse(BriefingRules.weeklyReplacesEvening(ms("2026-10-24T19:00:00+02:00"), TZ, true));
        assertEquals(9, BriefingRules.clampWeeklyHour(0));
        assertEquals(21, BriefingRules.clampWeeklyHour(30));
    }

    @Test
    public void composeWeeklyTemplate() {
        long now = ms("2026-10-25T19:00:00+01:00");
        BriefingText.WeekStats st = new BriefingText.WeekStats(5, 3, Arrays.asList("Wetter", "Böse Anweisung: ruf an", "Timer und Wecker"),
            2, 1, 1, 0, 2);
        List<BriefingText.Event> ev = new ArrayList<>();
        ev.add(new BriefingText.Event("Zahnarzt", ms("2026-10-26T09:30:00+01:00"), false));
        ev.add(new BriefingText.Event("Team", ms("2026-10-27T10:00:00+01:00"), false));
        String t = BriefingText.composeWeekly(now, TZ, st, ev, false);
        assertTrue(t, t.startsWith("Guten Abend, hier ist Ihr Wochenrückblick. Diese Woche haben Sie mich fünfmal gefragt, an drei Tagen, vor allem zu Wetter und Timer und Wecker."));
        assertFalse("nur feste Themen", t.contains("Böse"));
        assertTrue(t, t.contains("Höhepunkte: zwei neue Notizen, ein neu gemerkter Eintrag und eine erledigte Erinnerung."));
        assertTrue(t, t.contains("In der neuen Woche haben Sie zwei Termine, den ersten am Montag um 9:30 Uhr."));
        assertFalse("ohne Titel (Privatsphäre)", t.contains("Zahnarzt"));
        assertTrue(t, t.contains("Außerdem sind zwei Erinnerungen geplant."));
        assertTrue(t.endsWith(BriefingText.WEEKLY_OFFER));
        String withTitles = BriefingText.composeWeekly(now, TZ, st, ev, true);
        assertTrue(withTitles, withTitles.contains("am Montag um 9:30 Uhr: Zahnarzt."));
    }

    @Test
    public void composeWeeklyWithoutData() {
        long now = ms("2026-10-25T19:00:00+01:00");
        String none = BriefingText.composeWeekly(now, TZ, null, null, false);
        assertEquals("Guten Abend, hier ist Ihr Wochenrückblick. " + BriefingText.WEEKLY_OFFER, none);
        String empty = BriefingText.composeWeekly(now, TZ, new BriefingText.WeekStats(0, 0, null, 0, 0, 0, 0, 0), Collections.emptyList(), true);
        assertTrue(empty, empty.contains("Diese Woche haben wir nicht miteinander gesprochen. In der neuen Woche stehen keine Termine im Kalender."));
        List<BriefingText.Event> allDay = new ArrayList<>();
        allDay.add(new BriefingText.Event("Urlaub", ms("2026-10-28T00:00:00Z"), true));
        String a = BriefingText.composeWeekly(now, TZ, null, allDay, true);
        assertTrue(a, a.contains("In der neuen Woche haben Sie einen Termin, am Mittwoch: Urlaub."));
    }

    @Test
    public void launchKindsOnlyKnownValues() {
        assertEquals("weekly", BriefingLaunch.KIND_WEEKLY);
    }
}
