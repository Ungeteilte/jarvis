package com.jarvis.assistant.briefing;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/**
 * Zustand des Hintergrund-Briefings in normalen SharedPreferences („jarvis_briefing“).
 * Enthält KEINE Schlüssel/Passwörter: nur Einstellungen, Zeitstempel, gerundete Koordinaten und
 * den Daten-Cache. Liegt im (nach dem ersten Entsperren verfügbaren) Standard-Speicher – nichts
 * hier läuft im Direct-Boot-Modus.
 */
public final class BriefingState {
    private static final String PREFS = "jarvis_briefing";
    public static final long COORDS_MAX_AGE_MS = 72 * BriefingRules.H;
    public static final long COORDS_FRESH_MS = 6 * BriefingRules.H;
    public static final long CACHE_MAX_AGE_MS = 6 * BriefingRules.H;

    private BriefingState() {}

    public static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- Von der App (JS) gespiegelt ----------
    public static void saveSync(Context c, String json) throws Exception {
        JSONObject o = new JSONObject(json); // nur gültiges JSON speichern
        if (json.length() > 16 * 1024) throw new Exception("zu groß");
        prefs(c).edit().putString("sync", o.toString()).apply();
    }

    public static JSONObject sync(Context c) {
        try { return new JSONObject(prefs(c).getString("sync", "{}")); } catch (Exception e) { return new JSONObject(); }
    }

    public static JSONObject config(Context c) {
        JSONObject o = sync(c).optJSONObject("config");
        return o == null ? new JSONObject() : o;
    }

    public static boolean enabled(Context c) { return config(c).optBoolean("enabled", true); }
    public static boolean speakAloud(Context c) { return config(c).optBoolean("speakAloud", false); }
    public static boolean speakTitles(Context c) { return config(c).optBoolean("speakTitles", false); }
    public static int gapHours(Context c) { return BriefingRules.clampGap(config(c).optInt("gapHours", 4)); }
    public static int latestHour(Context c) { return BriefingRules.clampLatest(config(c).optInt("latestHour", 14)); }
    public static boolean content(Context c, String key) {
        JSONObject ct = config(c).optJSONObject("content");
        return ct == null || ct.optBoolean(key, true);
    }
    public static List<String> ressorts(Context c) {
        List<String> out = new ArrayList<>();
        JSONArray a = config(c).optJSONArray("newsRessorts");
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        return out;
    }
    public static boolean onboarded(Context c) { JSONObject s = sync(c); return s.has("onboarded") ? s.optBoolean("onboarded") : s.has("config"); }

    /** Gerundete Koordinaten, wenn jung genug, gleiche Zeitzone und nicht nach einem Zeitzonenwechsel. */
    public static double[] coords(Context c, long nowMs) {
        JSONObject co = sync(c).optJSONObject("coords");
        if (co == null || !co.has("lat") || !co.has("lon")) return null;
        long at = co.optLong("at", 0);
        if (at <= 0 || nowMs - at > COORDS_MAX_AGE_MS || at < 0 || at <= prefs(c).getLong("coordsClearedAt", 0)) return null;
        String tz = co.optString("tz", "");
        if (!tz.isEmpty() && !"null".equals(tz) && !tz.equals(TimeZone.getDefault().getID())) return null;
        double lat = Math.round(co.optDouble("lat") * 100) / 100.0;
        double lon = Math.round(co.optDouble("lon") * 100) / 100.0;
        if (Double.isNaN(lat) || Double.isNaN(lon)) return null;
        return new double[]{lat, lon, nowMs - at > COORDS_FRESH_MS ? 1 : 0};
    }

    /** Zeitzone gewechselt (Reise): gespeicherten Ort und Wetter-Cache verwerfen. */
    public static void onTimezoneChanged(Context c) {
        prefs(c).edit().putLong("coordsClearedAt", System.currentTimeMillis()).remove("cacheWeather").remove("cacheWeatherAt").apply();
    }

    // ---------- Hintergrund-Schalter ----------
    public static boolean backgroundEnabled(Context c) { return prefs(c).getBoolean("bgEnabled", false); }
    public static void setBackgroundEnabled(Context c, boolean on, boolean byNotification) {
        prefs(c).edit().putBoolean("bgEnabled", on).putBoolean("bgOffByNotification", !on && byNotification).apply();
    }
    public static boolean offByNotification(Context c) { return prefs(c).getBoolean("bgOffByNotification", false); }

    // ---------- Bildschirm-/Entsperr-Ereignisse ----------
    /** Letzte Aktivität VOR der aktuellen Sitzung: Ende der letzten echten (entsperrten) Sitzung oder letzte App-Aktivität. */
    public static long lastActivity(Context c) {
        return Math.max(prefs(c).getLong("lastScreenOffAfterUnlock", 0), sync(c).optLong("lastActiveAt", 0));
    }

    public static void recordUnlock(Context c, long nowMs) {
        SharedPreferences p = prefs(c);
        long last = lastActivity(c);
        SharedPreferences.Editor e = p.edit().putBoolean("unlockedSession", true).putLong("lastUnlockAt", nowMs);
        if (last > 0 && nowMs - last >= BriefingRules.REST_MS) e.putLong("restEndAt", nowMs).putLong("restMs", nowMs - last);
        e.apply();
    }

    /** Nur ein Ausschalten NACH echtem Entsperren zählt (Bildschirm-an durch Benachrichtigungen nicht). */
    public static void recordScreenOff(Context c, long nowMs) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("unlockedSession", false)) {
            p.edit().putLong("lastScreenOffAfterUnlock", nowMs).putBoolean("unlockedSession", false).apply();
        }
    }

    public static long restEndAt(Context c) { return prefs(c).getLong("restEndAt", 0); }
    public static long restMs(Context c) { return prefs(c).getLong("restMs", 0); }

    // ---------- Briefing-Tag ----------
    public static String lastBriefedDay(Context c) {
        String js = sync(c).optString("lastBriefingDay", "");
        String bg = prefs(c).getString("bgDay", "");
        return js.compareTo(bg) >= 0 ? js : bg;
    }
    public static void markBackground(Context c, String day, boolean spoken) {
        prefs(c).edit().putString("bgDay", day).putBoolean("bgSpoken", spoken).putLong("bgAt", System.currentTimeMillis()).apply();
    }
    public static void markSpoken(Context c) { prefs(c).edit().putBoolean("bgSpoken", true).apply(); }
    public static String pausedDay(Context c) { return prefs(c).getString("pausedDay", ""); }
    public static void pauseDay(Context c, String day) { prefs(c).edit().putString("pausedDay", day).apply(); }

    // ---------- Daten-Cache (Vorladen) ----------
    public static void saveWeather(Context c, BriefingText.Weather w) {
        prefs(c).edit().putString("cacheWeather", w.toJson().toString()).putLong("cacheWeatherAt", System.currentTimeMillis()).apply();
    }
    public static BriefingText.Weather cachedWeather(Context c, long nowMs) {
        long at = prefs(c).getLong("cacheWeatherAt", 0);
        if (at <= 0 || nowMs - at > CACHE_MAX_AGE_MS) return null;
        try { return BriefingText.Weather.fromJson(new JSONObject(prefs(c).getString("cacheWeather", "{}"))); } catch (Exception e) { return null; }
    }
    public static void saveNews(Context c, List<BriefingText.NewsItem> items) {
        JSONArray a = new JSONArray();
        try { for (BriefingText.NewsItem n : items) a.put(new JSONObject().put("t", n.title).put("s", n.summary).put("at", n.at)); } catch (Exception ignored) {}
        prefs(c).edit().putString("cacheNews", a.toString()).putLong("cacheNewsAt", System.currentTimeMillis()).apply();
    }
    public static List<BriefingText.NewsItem> cachedNews(Context c, long nowMs) {
        long at = prefs(c).getLong("cacheNewsAt", 0);
        if (at <= 0 || nowMs - at > CACHE_MAX_AGE_MS) return null;
        List<BriefingText.NewsItem> out = new ArrayList<>();
        try {
            JSONArray a = new JSONArray(prefs(c).getString("cacheNews", "[]"));
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                out.add(new BriefingText.NewsItem(BriefingText.clean(o.optString("t"), 120), BriefingText.clean(o.optString("s"), 220), o.optLong("at")));
            }
        } catch (Exception e) { return null; }
        return out;
    }

    // ---------- Einmal-Schlüssel für den Start aus der Benachrichtigung ----------
    private static final SecureRandom RNG = new SecureRandom();
    public static String newNonce(Context c) {
        byte[] b = new byte[16];
        RNG.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        prefs(c).edit().putString("nonce", sb.toString()).putLong("nonceAt", System.currentTimeMillis()).apply();
        return sb.toString();
    }
    /** Prüft und verbraucht den Schlüssel (höchstens 12 h alt, nur einmal gültig). */
    public static boolean consumeNonce(Context c, String nonce) {
        SharedPreferences p = prefs(c);
        String want = p.getString("nonce", null);
        long at = p.getLong("nonceAt", 0);
        boolean ok = want != null && nonce != null && want.length() == 32 && constantEquals(want, nonce)
            && System.currentTimeMillis() - at < 12 * BriefingRules.H;
        if (ok) p.edit().remove("nonce").remove("nonceAt").apply();
        return ok;
    }
    private static boolean constantEquals(String a, String b) {
        if (a.length() != b.length()) return false;
        int r = 0;
        for (int i = 0; i < a.length(); i++) r |= a.charAt(i) ^ b.charAt(i);
        return r == 0;
    }

    /** Für die App: Aktivität/Ruhephasen + was der Hintergrund heute getan hat. */
    public static JSONObject toJson(Context c) {
        SharedPreferences p = prefs(c);
        JSONObject o = new JSONObject();
        try {
            o.put("lastActivityAt", p.getLong("lastScreenOffAfterUnlock", 0));
            o.put("lastLongRestEndAt", p.getLong("restEndAt", 0));
            o.put("lastLongRestMs", p.getLong("restMs", 0));
            o.put("bgDay", p.getString("bgDay", ""));
            o.put("bgSpoken", p.getBoolean("bgSpoken", false));
            o.put("backgroundEnabled", backgroundEnabled(c));
            o.put("bgOffByNotification", offByNotification(c));
        } catch (Exception ignored) {}
        return o;
    }
}
