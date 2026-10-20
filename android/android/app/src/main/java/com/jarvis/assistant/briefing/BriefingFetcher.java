package com.jarvis.assistant.briefing;

import android.content.Context;

import com.jarvis.assistant.updater.SafeHttp;

import java.net.HttpURLConnection;
import java.util.ArrayList;
import java.util.List;

/** Lädt Wetter und Nachrichten (nur erlaubte HTTPS-Adressen, Größen-/Zeitlimit) und füllt den Cache. */
public final class BriefingFetcher {
    private BriefingFetcher() {}

    static final String UA = "JarvisAndroidBriefing/1 (+https://github.com/Ungeteilte/jarvis)";

    static String get(String url, long maxBytes, int timeoutMs) throws Exception {
        HttpURLConnection c = SafeHttp.open(url, null, null, BriefingPolicy::isAllowedUrl, UA, timeoutMs, timeoutMs);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            if (c.getContentLength() > maxBytes) throw new Exception("Antwort zu groß");
            return SafeHttp.readText(c, maxBytes);
        } finally {
            c.disconnect();
        }
    }

    /** Wetter frisch laden (gespeicherter Ort aus der App) → Cache. null wenn kein Ort/kein Netz. */
    public static BriefingText.Weather weather(Context ctx, long nowMs, int timeoutMs) {
        double[] co = BriefingState.coords(ctx, nowMs);
        if (co == null) return null;
        try {
            BriefingText.Weather w = BriefingText.parseWeather(get(BriefingPolicy.weatherUrl(co[0], co[1]), BriefingPolicy.MAX_WEATHER_BYTES, timeoutMs));
            w.stale = co[2] > 0;
            BriefingState.saveWeather(ctx, w);
            return w;
        } catch (Exception e) {
            return null;
        }
    }

    public static List<BriefingText.NewsItem> news(Context ctx, int timeoutMs) {
        List<String> ressorts = BriefingState.ressorts(ctx);
        List<List<BriefingText.NewsItem>> lists = new ArrayList<>();
        for (String u : BriefingPolicy.feedUrls(ressorts)) {
            try { lists.add(BriefingText.parseRss(get(u, BriefingPolicy.MAX_FEED_BYTES, timeoutMs), 30)); } catch (Exception ignored) {}
        }
        if (lists.isEmpty()) return null;
        List<BriefingText.NewsItem> items = BriefingText.merge(lists, Math.min(5, Math.max(3, ressorts.size())));
        BriefingState.saveNews(ctx, items);
        return items;
    }
}
