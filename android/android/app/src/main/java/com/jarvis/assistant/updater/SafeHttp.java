package com.jarvis.assistant.updater;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * HTTPS-GET mit manuellen Weiterleitungen: jede Station muss die Erlaubnis-Regel erfüllen
 * (Updater: UpdatePolicy.isAllowedUrl; Morgen-Briefing: eigene Regel über die öffentliche Variante).
 */
public final class SafeHttp {
    private SafeHttp() {}

    static final String UA = "JarvisAndroidUpdater/1 (+https://github.com/Ungeteilte/jarvis)";

    /** Erlaubnis-Regel für jede Station (eigenes Interface statt java.util.function – minSdk 23). */
    public interface UrlRule { boolean allowed(String url); }

    /** Updater: unverändertes Verhalten (UpdatePolicy, 15 s / 30 s). */
    static HttpURLConnection open(String url, String accept, String etag) throws IOException {
        return open(url, accept, etag, UpdatePolicy::isAllowedUrl, UA, 15000, 30000);
    }

    /** Allgemeine Variante mit eigener Regel, eigenem User-Agent und eigenen Zeitlimits. */
    public static HttpURLConnection open(String url, String accept, String etag, UrlRule rule, String userAgent,
                                         int connectTimeoutMs, int readTimeoutMs) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            if (!rule.allowed(current)) throw new IOException("Adresse nicht erlaubt: " + hostOf(current));
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(connectTimeoutMs);
            c.setReadTimeout(readTimeoutMs);
            c.setRequestProperty("User-Agent", userAgent);
            if (accept != null) c.setRequestProperty("Accept", accept);
            if (etag != null && hop == 0) c.setRequestProperty("If-None-Match", etag);
            int code = c.getResponseCode();
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Weiterleitung ohne Ziel");
                current = new URL(new URL(current), loc).toString();
                continue;
            }
            return c;
        }
        throw new IOException("Zu viele Weiterleitungen");
    }

    public static String readText(HttpURLConnection c, long maxBytes) throws IOException {
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n; long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > maxBytes) throw new IOException("Antwort zu groß");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }

    private static String hostOf(String u) {
        try { return new URL(u).getHost(); } catch (Exception e) { return "?"; }
    }
}
