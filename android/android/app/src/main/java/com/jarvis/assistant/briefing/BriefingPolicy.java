package com.jarvis.assistant.briefing;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Feste Netz-Regeln des Briefings: nur HTTPS, nur Open-Meteo-Forecast und tagesschau-RSS. */
public final class BriefingPolicy {
    private BriefingPolicy() {}

    public static final long MAX_FEED_BYTES = 300L * 1024;
    public static final long MAX_WEATHER_BYTES = 64L * 1024;
    public static final String NEWS_ALL = "https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml";
    public static final Map<String, String> RESSORTS = new LinkedHashMap<>();
    public static final Map<String, String> LABELS = new LinkedHashMap<>();
    static {
        String[][] r = {
            {"inland", "Inland"}, {"ausland", "Ausland"}, {"wirtschaft", "Wirtschaft"}, {"sport", "Sport"}, {"wissen", "Wissen"}
        };
        for (String[] x : r) {
            RESSORTS.put(x[0], "https://www.tagesschau.de/" + x[0] + "/index~rss2.xml");
            LABELS.put(x[0], x[1]);
        }
    }

    public static boolean isAllowedUrl(String url) {
        if (url == null) return false;
        URI u;
        try { u = new URI(url); } catch (Exception e) { return false; }
        if (!"https".equalsIgnoreCase(u.getScheme())) return false;
        if (u.getUserInfo() != null || u.getFragment() != null) return false;
        if (u.getPort() != -1 && u.getPort() != 443) return false;
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        String path = u.getRawPath() == null ? "" : u.getRawPath();
        if (path.contains("..") || path.contains("%")) return false;
        switch (host) {
            case "api.open-meteo.com":
                return "/v1/forecast".equals(path) && u.getRawQuery() != null && u.getRawQuery().matches("[A-Za-z0-9_.,=&%-]+");
            case "www.tagesschau.de":
                return u.getRawQuery() == null && path.matches("/[a-z0-9/-]+~rss2\\.xml");
            default:
                return false;
        }
    }

    public static String weatherUrl(double lat, double lon) {
        return String.format(Locale.ROOT,
            "https://api.open-meteo.com/v1/forecast?latitude=%.2f&longitude=%.2f"
                + "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m"
                + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum"
                + "&timezone=auto&forecast_days=2", lat, lon);
    }

    /** Leere Liste = alle Meldungen. Unbekannte Ressorts werden ignoriert. */
    public static List<String> feedUrls(List<String> ressorts) {
        List<String> out = new ArrayList<>();
        if (ressorts != null) for (String r : ressorts) { String u = RESSORTS.get(r); if (u != null && !out.contains(u)) out.add(u); }
        if (out.isEmpty()) out.add(NEWS_ALL);
        return out;
    }
}
