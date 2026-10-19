package com.jarvis.assistant.updater;

import java.net.URI;
import java.util.Locale;

/**
 * Feste Regeln des Updaters: nur dieses Repo, nur HTTPS, nur bekannte GitHub-Hosts.
 * Reine Java-Logik (ohne Android) – per JUnit getestet.
 */
public final class UpdatePolicy {
    private UpdatePolicy() {}

    public static final String OWNER = "Ungeteilte";
    public static final String REPO = "jarvis";
    public static final String PACKAGE_NAME = "com.jarvis.assistant";
    public static final String RELEASES_API =
        "https://api.github.com/repos/" + OWNER + "/" + REPO + "/releases?per_page=15";
    public static final String APK_ASSET = "Jarvis.apk";
    public static final String MANIFEST_ASSET = "update.json";
    public static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    public static final long MAX_JSON_BYTES = 2L * 1024 * 1024;

    public static final int[] INTERVALS_HOURS = {3, 6, 12, 24};
    public static final int DEFAULT_INTERVAL_HOURS = 6;

    /** Unbekannte Werte → 6 h; WorkManager-Minimum (15 min) wird so nie unterschritten. */
    public static int normalizeInterval(int hours) {
        for (int h : INTERVALS_HOURS) if (h == hours) return h;
        return DEFAULT_INTERVAL_HOURS;
    }

    /**
     * Erlaubt nur HTTPS-URLs zu:
     *  - api.github.com/repos/Ungeteilte/jarvis/…
     *  - github.com/Ungeteilte/jarvis/releases/download/…
     *  - objects.githubusercontent.com / release-assets.githubusercontent.com (Weiterleitungsziele der Downloads)
     */
    public static boolean isAllowedUrl(String url) {
        if (url == null) return false;
        URI u;
        try { u = new URI(url); } catch (Exception e) { return false; }
        if (!"https".equalsIgnoreCase(u.getScheme())) return false;
        if (u.getUserInfo() != null) return false;
        if (u.getPort() != -1 && u.getPort() != 443) return false;
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        String path = u.getRawPath() == null ? "" : u.getRawPath();
        if (path.contains("..") || path.contains("%2e") || path.contains("%2E")) return false;
        switch (host) {
            case "api.github.com":
                return path.startsWith("/repos/" + OWNER + "/" + REPO + "/");
            case "github.com":
                return path.startsWith("/" + OWNER + "/" + REPO + "/releases/download/");
            case "objects.githubusercontent.com":
            case "release-assets.githubusercontent.com":
                return true;
            default:
                return false;
        }
    }
}
