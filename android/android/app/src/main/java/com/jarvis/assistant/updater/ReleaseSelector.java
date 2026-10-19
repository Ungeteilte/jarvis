package com.jarvis.assistant.updater;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Wählt aus der GitHub-Releases-Liste das höchste veröffentlichte „vX.Y-android“-Release
 * mit Jarvis.apk (Entwürfe, Vorabversionen und andere Tags werden ignoriert).
 */
public final class ReleaseSelector {
    private ReleaseSelector() {}

    public static ReleaseInfo selectLatest(String releasesJson) {
        JSONArray arr;
        try { arr = new JSONArray(releasesJson); } catch (Exception e) { return null; }
        ReleaseInfo best = null;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject r = arr.optJSONObject(i);
            if (r == null || r.optBoolean("draft") || r.optBoolean("prerelease")) continue;
            String tag = r.optString("tag_name", "");
            UpdateVersion v = UpdateVersion.parseTag(tag);
            if (v == null) continue;
            JSONArray assets = r.optJSONArray("assets");
            if (assets == null) continue;
            String apkUrl = null, digest = null, manifestUrl = null;
            long size = 0;
            for (int a = 0; a < assets.length(); a++) {
                JSONObject as = assets.optJSONObject(a);
                if (as == null) continue;
                String name = as.optString("name", "");
                String url = as.optString("browser_download_url", "");
                if (!UpdatePolicy.isAllowedUrl(url)) continue;
                if (UpdatePolicy.APK_ASSET.equals(name)) {
                    apkUrl = url;
                    size = as.optLong("size", 0);
                    String d = as.optString("digest", "");
                    if (d.startsWith("sha256:")) digest = d.substring(7);
                } else if (UpdatePolicy.MANIFEST_ASSET.equals(name)) {
                    manifestUrl = url;
                }
            }
            if (apkUrl == null) continue;
            if (best == null || v.compareTo(best.version) > 0) {
                best = new ReleaseInfo(tag, v, apkUrl, digest, size, manifestUrl,
                    r.optString("body", ""), r.optString("html_url", ""));
            }
        }
        return best;
    }
}
