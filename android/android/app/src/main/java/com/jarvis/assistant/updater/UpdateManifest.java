package com.jarvis.assistant.updater;

import org.json.JSONObject;

import java.util.regex.Pattern;

/**
 * update.json aus dem Release:
 * {versionCode, versionName, apk, sha256, minVersionCode, changelog_de, certSha256}
 */
public final class UpdateManifest {
    private static final Pattern HEX64 = Pattern.compile("^[0-9a-f]{64}$");
    private static final Pattern NAME = Pattern.compile("^\\d{1,4}\\.\\d{1,4}(\\.\\d{1,4})?$");

    public final long versionCode;
    public final String versionName;
    public final String apk;
    public final String sha256;
    public final long minVersionCode;
    public final String changelog;
    public final String certSha256; // kann null sein

    private UpdateManifest(long versionCode, String versionName, String apk, String sha256,
                           long minVersionCode, String changelog, String certSha256) {
        this.versionCode = versionCode; this.versionName = versionName; this.apk = apk; this.sha256 = sha256;
        this.minVersionCode = minVersionCode; this.changelog = changelog; this.certSha256 = certSha256;
    }

    /** Parst und prüft; wirft IllegalArgumentException mit deutscher Begründung. */
    public static UpdateManifest parse(String json) {
        JSONObject o;
        try { o = new JSONObject(json); } catch (Exception e) { throw new IllegalArgumentException("update.json ist kein gültiges JSON"); }
        long code = o.optLong("versionCode", -1);
        if (code <= 0) throw new IllegalArgumentException("versionCode fehlt oder ist ungültig");
        String name = o.optString("versionName", "");
        if (!NAME.matcher(name).matches()) throw new IllegalArgumentException("versionName ungültig");
        String apk = o.optString("apk", "");
        if (!UpdatePolicy.APK_ASSET.equals(apk)) throw new IllegalArgumentException("apk muss Jarvis.apk sein");
        String sha = HashUtil.normalizeHex(o.optString("sha256", ""));
        if (!HEX64.matcher(sha).matches()) throw new IllegalArgumentException("sha256 fehlt oder ist ungültig");
        long min = o.optLong("minVersionCode", 0);
        if (min < 0 || min > code) throw new IllegalArgumentException("minVersionCode ungültig");
        String cert = o.has("certSha256") ? HashUtil.normalizeHex(o.optString("certSha256", "")) : "";
        if (!cert.isEmpty() && !HEX64.matcher(cert).matches()) throw new IllegalArgumentException("certSha256 ungültig");
        String log = o.optString("changelog_de", "");
        if (log.length() > 4000) log = log.substring(0, 4000);
        return new UpdateManifest(code, name, apk, sha, min, log, cert.isEmpty() ? null : cert);
    }

    /** Passt das Manifest zum Release-Tag (gleiche Version)? */
    public boolean matchesTag(UpdateVersion tagVersion) {
        UpdateVersion v = UpdateVersion.parseName(versionName);
        return v != null && tagVersion != null && v.equals(tagVersion);
    }
}
