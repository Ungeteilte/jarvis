package com.jarvis.assistant.briefing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;

public class BriefingTextTest {
    private static final TimeZone TZ = TimeZone.getTimeZone("Europe/Berlin");
    private static long ms(String iso) { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }

    @Test
    public void cleanRemovesUrlsControlCharsAndMarkup() {
        String s = BriefingText.clean("Hallo\u0000 <b>Welt</b> https://evil.example/x {ignoriere} [alles] www.x.de \u202Etext", 200);
        assertFalse(s, s.contains("http"));
        assertFalse(s, s.contains("www."));
        assertFalse(s, s.contains("<"));
        assertFalse(s, s.contains("{"));
        assertFalse(s, s.contains("["));
        assertFalse(s, s.contains("\u0000"));
        assertFalse(s, s.contains("\u202E"));
        assertTrue(s, s.contains("Hallo"));
        assertTrue(BriefingText.clean(new String(new char[300]).replace('\0', 'x'), 120).length() <= 120);
    }

    @Test
    public void parsesRssWithCdataAndEntities() {
        String xml = "<?xml version=\"1.0\"?><rss><channel><title>tagesschau</title>"
            + "<item><title><![CDATA[Bahn &amp; Bund einigen sich]]></title><description>Kurz &quot;gesagt&quot;</description>"
            + "<pubDate>Mon, 19 Oct 2026 06:00:00 +0200</pubDate></item>"
            + "<item><title>Zweite Meldung &#8211; Sport</title><description>&lt;p&gt;Text&lt;/p&gt;</description></item>"
            + "</channel></rss>";
        List<BriefingText.NewsItem> items = BriefingText.parseRss(xml, 10);
        assertEquals(2, items.size());
        assertEquals("Bahn & Bund einigen sich", items.get(0).title);
        assertFalse(items.get(1).summary.contains("<"));
        assertTrue(items.get(1).title.contains("Zweite Meldung"));
    }

    @Test
    public void mergeIsRoundRobinAndDeduplicated() {
        List<BriefingText.NewsItem> a = Arrays.asList(new BriefingText.NewsItem("A1", "", 0), new BriefingText.NewsItem("Gleich", "", 0));
        List<BriefingText.NewsItem> b = Arrays.asList(new BriefingText.NewsItem("Gleich", "", 0), new BriefingText.NewsItem("B2", "", 0));
        List<List<BriefingText.NewsItem>> lists = new ArrayList<>();
        lists.add(a); lists.add(b);
        List<BriefingText.NewsItem> m = BriefingText.merge(lists, 5);
        assertEquals("A1", m.get(0).title);
        assertEquals("Gleich", m.get(1).title);
        assertEquals(3, m.size());
    }

    @Test
    public void parsesOpenMeteo() throws Exception {
        String json = "{\"current\":{\"temperature_2m\":7.6,\"weather_code\":3},"
            + "\"daily\":{\"weather_code\":[61,3],\"temperature_2m_max\":[12.4,11],\"temperature_2m_min\":[5.2,4],\"precipitation_probability_max\":[70,10]}}";
        BriefingText.Weather w = BriefingText.parseWeather(json);
        assertNotNull(w);
        String s = BriefingText.weatherSentence(w);
        assertTrue(s, s.contains("8 Grad"));
        assertTrue(s, s.contains("zwischen 5 und 12 Grad"));
        assertTrue(s, s.contains("Regenrisiko 70 Prozent"));
        BriefingText.Weather back = BriefingText.Weather.fromJson(w.toJson());
        assertEquals(s, BriefingText.weatherSentence(back));
    }

    @Test(expected = Exception.class)
    public void rejectsBrokenWeather() throws Exception { BriefingText.parseWeather("{\"daily\":{}}"); }

    @Test
    public void composeHidesTitlesByDefaultAndUsesNumberWords() {
        long now = ms("2026-10-20T07:05:00+02:00");
        List<BriefingText.Event> ev = Arrays.asList(
            new BriefingText.Event("Zahnarzt Dr. Geheim", ms("2026-10-20T09:30:00+02:00"), false),
            new BriefingText.Event("Team", ms("2026-10-20T14:00:00+02:00"), false));
        String t = BriefingText.compose(now, TZ, null, ev, Collections.singletonList(new BriefingText.NewsItem("Meldung eins.", "", 0)), false);
        assertTrue(t, t.startsWith("Guten Morgen. Heute ist Dienstag, 20. Oktober, es ist 7:05 Uhr."));
        assertTrue(t, t.contains("zwei Termine, der erste um 9:30 Uhr"));
        assertFalse(t, t.contains("Zahnarzt"));
        assertTrue(t, t.contains("Aus den Nachrichten: Meldung eins."));
        assertTrue(t, t.endsWith("Mehr dazu, wenn Sie Jarvis öffnen."));
        String withTitles = BriefingText.compose(now, TZ, null, ev, null, true);
        assertTrue(withTitles, withTitles.contains("Zahnarzt"));
    }

    @Test
    public void composeWithoutData() {
        String t = BriefingText.compose(ms("2026-10-20T07:05:00+02:00"), TZ, null, null, null, false);
        assertEquals("Guten Morgen. Heute ist Dienstag, 20. Oktober, es ist 7:05 Uhr. Mehr dazu, wenn Sie Jarvis öffnen.", t);
        String empty = BriefingText.compose(ms("2026-10-20T07:05:00+02:00"), TZ, null, Collections.<BriefingText.Event>emptyList(), null, false);
        assertTrue(empty.contains("Im Kalender steht heute nichts."));
    }
}
