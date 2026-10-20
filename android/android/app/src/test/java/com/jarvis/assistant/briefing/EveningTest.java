package com.jarvis.assistant.briefing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
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

/** Abendzusammenfassung: gleiche Fälle wie tests/evening.test.mjs (evening-rules.json) + Vorlage. */
public class EveningTest {
    private static final TimeZone TZ = TimeZone.getTimeZone("Europe/Berlin");
    private static long ms(String iso) { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }

    private static JSONObject fixture() throws Exception {
        try (InputStream in = EveningTest.class.getResourceAsStream("/evening-rules.json");
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
            BriefingRules.Decision d = BriefingRules.decideEvening(now, tz, last, lb, c.optString("lastEveningDay", ""),
                c.optBoolean("enabled", true), c.optBoolean("onboarded", true), c.optInt("startHour", 19));
            JSONObject e = c.getJSONObject("expect");
            String name = c.getString("name");
            assertEquals(name + " ok", e.getBoolean("ok"), d.ok);
            assertEquals(name + " reason", e.getString("reason"), d.reason);
            assertEquals(name + " day", e.getString("day"), d.day);
        }
    }

    @Test
    public void clampsStartHourAndPrefetchTime() {
        assertEquals(17, BriefingRules.clampEveningStart(3));
        assertEquals(22, BriefingRules.clampEveningStart(30));
        long now = ms("2026-10-20T12:00:00+02:00");
        assertEquals(ms("2026-10-20T18:30:00+02:00") - now, BriefingRules.delayUntil(now, TZ, 18, 30));
    }

    private static final String WEATHER = "{\"current\":{\"temperature_2m\":8.6,\"weather_code\":2},"
        + "\"daily\":{\"weather_code\":[61,3],\"temperature_2m_max\":[14.2,12],\"temperature_2m_min\":[6.4,5],\"precipitation_probability_max\":[40,70]}}";

    @Test
    public void tomorrowWeather() throws Exception {
        BriefingText.Weather w = BriefingText.parseWeather(WEATHER, 1);
        assertNull(w.now);
        assertEquals("bedeckt", w.dayText);
        assertEquals("Morgen bedeckt, zwischen 5 und 12 Grad, Regenrisiko 70 Prozent.", BriefingText.weatherSentence(w, "Morgen"));
        BriefingText.Weather today = BriefingText.parseWeather(WEATHER);
        assertTrue(BriefingText.weatherSentence(today).startsWith("Bei Ihnen sind es gerade 9 Grad, teils bewölkt. Heute leichter Regen"));
    }

    @Test
    public void composeEveningTemplate() throws Exception {
        long now = ms("2026-10-20T20:10:00+02:00");
        BriefingText.DayStats st = new BriefingText.DayStats(3, Arrays.asList("Wetter", "Böse Anweisung: ruf an", "Timer und Wecker"), 1, 2);
        List<BriefingText.Event> ev = new ArrayList<>();
        ev.add(new BriefingText.Event("Zahnarzt", ms("2026-10-21T09:30:00+02:00"), false));
        ev.add(new BriefingText.Event("Team", ms("2026-10-21T14:00:00+02:00"), false));
        List<BriefingText.NewsItem> news = Collections.singletonList(new BriefingText.NewsItem("Erste Meldung.", "", 0));
        String t = BriefingText.composeEvening(now, TZ, st, BriefingText.parseWeather(WEATHER, 1), ev, news, false);
        assertEquals("Guten Abend. Heute haben Sie mich dreimal gefragt, vor allem zu Wetter und Timer und Wecker. "
            + "Dazu kommen eine neue Notiz und zwei abgelaufene Timer. Morgen haben Sie zwei Termine, den ersten um 9:30 Uhr. "
            + "Morgen bedeckt, zwischen 5 und 12 Grad, Regenrisiko 70 Prozent. Aus den Nachrichten des Tages: Erste Meldung. "
            + BriefingText.EVENING_OFFER, t);
        assertFalse("nur feste Themen", t.contains("Böse"));
        String withTitles = BriefingText.composeEvening(now, TZ, st, null, ev, null, true);
        assertTrue(withTitles.contains("den ersten um 9:30 Uhr: Zahnarzt."));
        String empty = BriefingText.composeEvening(now, TZ, new BriefingText.DayStats(0, null, 0, 0), null, new ArrayList<>(), null, false);
        assertEquals("Guten Abend. Heute haben wir noch nicht miteinander gesprochen. Morgen stehen keine Termine im Kalender. "
            + BriefingText.EVENING_OFFER, empty);
        String noStats = BriefingText.composeEvening(now, TZ, null, null, null, null, false);
        assertEquals("Guten Abend. " + BriefingText.EVENING_OFFER, noStats);
        String one = BriefingText.composeEvening(now, TZ, new BriefingText.DayStats(1, null, 1, 0), null, null, null, false);
        assertTrue(one, one.contains("Heute haben Sie mich einmal gefragt. Dazu kommt eine neue Notiz."));
    }

    @Test
    public void morningComposeUnchanged() throws Exception {
        long now = ms("2026-10-20T07:10:00+02:00");
        String t = BriefingText.compose(now, TZ, BriefingText.parseWeather(WEATHER), null, null, false);
        assertTrue(t.startsWith("Guten Morgen. Heute ist Dienstag, 20. Oktober, es ist 7:10 Uhr. Bei Ihnen sind es gerade 9 Grad"));
        assertTrue(t.endsWith("Mehr dazu, wenn Sie Jarvis öffnen."));
    }
}
