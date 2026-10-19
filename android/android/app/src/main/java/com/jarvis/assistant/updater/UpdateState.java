package com.jarvis.assistant.updater;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/** Persistenter Updater-Zustand (SharedPreferences – der Worker läuft ohne WebView). */
public final class UpdateState {
    private static final String PREFS = "jarvis_updater";

    // Status-Werte (auch an die Web-UI gemeldet)
    public static final String IDLE = "idle";
    public static final String CHECKING = "checking";
    public static final String UP_TO_DATE = "up-to-date";
    public static final String AVAILABLE = "available";        // gefunden, noch nicht geladen
    public static final String WAITING_WIFI = "waiting-wifi";
    public static final String DOWNLOADING = "downloading";
    public static final String READY = "ready";                // geladen + geprüft
    public static final String INSTALLING = "installing";
    public static final String ERROR = "error";
    public static final String RATE_LIMITED = "rate-limited";

    private UpdateState() {}

    public static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean enabled(Context c) { return prefs(c).getBoolean("enabled", true); }
    public static int intervalHours(Context c) {
        return UpdatePolicy.normalizeInterval(prefs(c).getInt("intervalH", UpdatePolicy.DEFAULT_INTERVAL_HOURS));
    }
    public static boolean wifiOnly(Context c) { return prefs(c).getBoolean("wifiOnly", false); }

    public static void setConfig(Context c, boolean enabled, int intervalH, boolean wifiOnly) {
        prefs(c).edit()
            .putBoolean("enabled", enabled)
            .putInt("intervalH", UpdatePolicy.normalizeInterval(intervalH))
            .putBoolean("wifiOnly", wifiOnly)
            .apply();
    }

    public static void setStatus(Context c, String status, String message) {
        prefs(c).edit().putString("status", status).putString("message", message == null ? "" : message).apply();
        UpdateEvents.emit(c);
    }

    public static void setProgress(Context c, int percent) {
        prefs(c).edit().putInt("progress", percent).apply();
        UpdateEvents.emit(c);
    }

    public static void setAvailable(Context c, long code, String name, String changelog, String tag) {
        prefs(c).edit()
            .putLong("availCode", code).putString("availName", name)
            .putString("changelog", changelog == null ? "" : changelog).putString("availTag", tag)
            .apply();
    }

    public static void setApk(Context c, String path) { prefs(c).edit().putString("apkPath", path).apply(); }
    public static String apkPath(Context c) { return prefs(c).getString("apkPath", null); }
    public static long availableCode(Context c) { return prefs(c).getLong("availCode", 0); }
    public static String availableName(Context c) { return prefs(c).getString("availName", ""); }

    public static void markChecked(Context c) { prefs(c).edit().putLong("lastCheck", System.currentTimeMillis()).apply(); }

    public static String etag(Context c) { return prefs(c).getString("etag", null); }
    public static String cachedReleases(Context c) { return prefs(c).getString("releasesBody", null); }
    public static void saveReleases(Context c, String etag, String body) {
        prefs(c).edit().putString("etag", etag).putString("releasesBody", body).apply();
    }

    public static long rateLimitReset(Context c) { return prefs(c).getLong("rateReset", 0); }
    public static void setRateLimitReset(Context c, long epochMs) { prefs(c).edit().putLong("rateReset", epochMs).apply(); }

    public static long notifiedCode(Context c) { return prefs(c).getLong("notifiedCode", 0); }
    public static void setNotifiedCode(Context c, long code) { prefs(c).edit().putLong("notifiedCode", code).apply(); }

    public static boolean askedNotifications(Context c) { return prefs(c).getBoolean("askedNotif", false); }
    public static void setAskedNotifications(Context c) { prefs(c).edit().putBoolean("askedNotif", true).apply(); }

    /** Alles für die Web-UI. */
    public static JSONObject toJson(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", enabled(c));
            o.put("intervalHours", intervalHours(c));
            o.put("wifiOnly", wifiOnly(c));
            o.put("status", p.getString("status", IDLE));
            o.put("message", p.getString("message", ""));
            o.put("progress", p.getInt("progress", 0));
            o.put("lastCheck", p.getLong("lastCheck", 0));
            o.put("installedVersionName", AppInfo.versionName(c));
            o.put("installedVersionCode", AppInfo.versionCode(c));
            long avail = availableCode(c);
            boolean newer = avail > AppInfo.versionCode(c);
            o.put("availableVersionCode", newer ? avail : 0);
            o.put("availableVersionName", newer ? availableName(c) : "");
            o.put("changelog", newer ? p.getString("changelog", "") : "");
            String apk = apkPath(c);
            o.put("ready", newer && apk != null && new java.io.File(apk).exists());
            o.put("intervals", new org.json.JSONArray(new int[]{3, 6, 12, 24}));
        } catch (Exception ignored) {}
        return o;
    }
}
