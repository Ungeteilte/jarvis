package com.jarvis.assistant.briefing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Scanner;
import java.util.TimeZone;

/** Gleiche Fälle wie tests/briefing.test.mjs (tests/fixtures/briefing-rules.json). */
public class BriefingRulesTest {
    private static long ms(String iso) { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }

    private static JSONObject fixture() throws Exception {
        try (InputStream in = BriefingRulesTest.class.getResourceAsStream("/briefing-rules.json");
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
            JSONObject rest = c.optJSONObject("lastLongRest");
            long restEnd = rest == null ? 0 : ms(rest.getString("endAt"));
            long restMs = rest == null ? 0 : rest.getLong("ms");
            BriefingRules.Decision d = BriefingRules.decide(now, tz, last, restEnd, restMs,
                c.optString("lastBriefingDay", ""), c.optBoolean("enabled", true), c.optBoolean("onboarded", true),
                c.optInt("gapHours", 4), c.optInt("latestHour", 14));
            JSONObject e = c.getJSONObject("expect");
            String name = c.getString("name");
            assertEquals(name + " ok", e.getBoolean("ok"), d.ok);
            assertEquals(name + " reason", e.getString("reason"), d.reason);
            assertEquals(name + " day", e.getString("day"), d.day);
        }
    }

    @Test
    public void dayStartsAtThree() {
        TimeZone tz = TimeZone.getTimeZone("Europe/Berlin");
        assertEquals("2026-10-19", BriefingRules.dayKey(ms("2026-10-20T02:59:00+02:00"), tz));
        assertEquals("2026-10-20", BriefingRules.dayKey(ms("2026-10-20T03:00:00+02:00"), tz));
    }

    @Test
    public void clampsSettings() {
        assertEquals(3, BriefingRules.clampGap(1));
        assertEquals(8, BriefingRules.clampGap(12));
        assertEquals(8, BriefingRules.clampLatest(5));
        assertEquals(23, BriefingRules.clampLatest(24));
        assertEquals(14, BriefingRules.clampLatest(14));
    }

    @Test
    public void prefetchDelayIsNextLocal0430() {
        TimeZone tz = TimeZone.getTimeZone("Europe/Berlin");
        long now = ms("2026-10-19T22:00:00+02:00");
        assertEquals(ms("2026-10-20T04:30:00+02:00") - now, BriefingRules.delayUntil(now, tz, 4, 30));
        long early = ms("2026-10-20T04:00:00+02:00");
        assertEquals(30 * 60000L, BriefingRules.delayUntil(early, tz, 4, 30));
    }
}
