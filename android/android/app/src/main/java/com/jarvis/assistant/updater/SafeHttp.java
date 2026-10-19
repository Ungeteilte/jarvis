package com.jarvis.assistant.updater;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * HTTPS-GET mit manuellen Weiterleitungen: jede Station muss UpdatePolicy.isAllowedUrl erfüllen.
 */
final class SafeHttp {
    private SafeHttp() {}

    static final String UA = "JarvisAndroidUpdater/1 (+https://github.com/Ungeteilte/jarvis)";

    static HttpURLConnection open(String url, String accept, String etag) throws IOException {
        String current = url;
        for (int hop = 0; hop < 6; hop++) {
            if (!UpdatePolicy.isAllowedUrl(current)) throw new IOException("Adresse nicht erlaubt: " + hostOf(current));
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", UA);
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

    static String readText(HttpURLConnection c, long maxBytes) throws IOException {
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
