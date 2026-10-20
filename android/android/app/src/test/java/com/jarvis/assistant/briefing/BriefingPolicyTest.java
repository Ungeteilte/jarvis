package com.jarvis.assistant.briefing;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class BriefingPolicyTest {
    @Test
    public void allowsOnlyTheTwoDataHosts() {
        assertTrue(BriefingPolicy.isAllowedUrl(BriefingPolicy.weatherUrl(52.52, 13.41)));
        assertTrue(BriefingPolicy.isAllowedUrl(BriefingPolicy.NEWS_ALL));
        for (String u : BriefingPolicy.RESSORTS.values()) assertTrue(u, BriefingPolicy.isAllowedUrl(u));
        String[] bad = {
            "http://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml",
            "https://tagesschau.de/infoservices/alle-meldungen-100~rss2.xml",
            "https://www.tagesschau.de.evil.com/x~rss2.xml",
            "https://user@www.tagesschau.de/x~rss2.xml",
            "https://www.tagesschau.de:8443/x~rss2.xml",
            "https://www.tagesschau.de/api2u/homepage/",
            "https://www.tagesschau.de/../x~rss2.xml",
            "https://www.tagesschau.de/x~rss2.xml?a=1",
            "https://api.open-meteo.com/v1/archive?latitude=1",
            "https://api.open-meteo.com/v1/forecast",
            "https://github.com/Ungeteilte/jarvis/releases/latest/download/update.json",
            "javascript:alert(1)", null, ""
        };
        for (String u : bad) assertFalse(String.valueOf(u), BriefingPolicy.isAllowedUrl(u));
    }

    @Test
    public void weatherUrlRoundsCoordinates() {
        String u = BriefingPolicy.weatherUrl(52.520008, 13.404954);
        assertTrue(u, u.contains("latitude=52.52&longitude=13.40&"));
        assertTrue(u.contains("timezone=auto"));
    }

    @Test
    public void feedUrlsByRessort() {
        assertEquals(Collections.singletonList(BriefingPolicy.NEWS_ALL), BriefingPolicy.feedUrls(Collections.<String>emptyList()));
        assertEquals(Collections.singletonList(BriefingPolicy.NEWS_ALL), BriefingPolicy.feedUrls(Arrays.asList("quatsch")));
        List<String> two = BriefingPolicy.feedUrls(Arrays.asList("sport", "wirtschaft", "sport"));
        assertEquals(2, two.size());
        assertEquals("https://www.tagesschau.de/sport/index~rss2.xml", two.get(0));
        assertEquals("https://www.tagesschau.de/wirtschaft/index~rss2.xml", two.get(1));
    }
}
