package com.jarvis.assistant.updater;

import android.content.Context;

import java.io.IOException;
import java.net.HttpURLConnection;

/** Fragt die GitHub-Releases ab (ETag, Ratenlimit) und liefert ein neueres Release samt update.json. */
public final class UpdateChecker {
    public static final class Candidate {
        public final ReleaseInfo release;
        public final UpdateManifest manifest;
        Candidate(ReleaseInfo r, UpdateManifest m) { release = r; manifest = m; }
    }

    public static final class RateLimited extends IOException {
        public final long resetAtMs;
        RateLimited(long resetAtMs) { super("GitHub-Abfragelimit erreicht"); this.resetAtMs = resetAtMs; }
    }

    private UpdateChecker() {}

    /** null = aktuell. Wirft IOException bei Netzproblemen, IllegalArgumentException bei kaputtem Manifest. */
    public static Candidate check(Context c) throws IOException {
        long reset = UpdateState.rateLimitReset(c);
        if (reset > System.currentTimeMillis()) throw new RateLimited(reset);

        String etag = UpdateState.etag(c);
        String cached = UpdateState.cachedReleases(c);
        HttpURLConnection conn = SafeHttp.open(UpdatePolicy.RELEASES_API, "application/vnd.github+json",
            cached != null ? etag : null);
        String body;
        try {
            int code = conn.getResponseCode();
            if (code == 304 && cached != null) {
                body = cached; // unverändert – zählt laut GitHub nicht gegen das Limit
            } else if (code == 200) {
                body = SafeHttp.readText(conn, UpdatePolicy.MAX_JSON_BYTES);
                UpdateState.saveReleases(c, conn.getHeaderField("ETag"), body);
            } else if (code == 403 || code == 429) {
                long resetAt = parseReset(conn);
                UpdateState.setRateLimitReset(c, resetAt);
                throw new RateLimited(resetAt);
            } else {
                throw new IOException("GitHub antwortet mit HTTP " + code);
            }
        } finally {
            conn.disconnect();
        }
        UpdateState.setRateLimitReset(c, 0);

        ReleaseInfo rel = ReleaseSelector.selectLatest(body);
        if (rel == null) return null;
        if (rel.manifestUrl == null) throw new IllegalArgumentException("Release ohne update.json");

        HttpURLConnection mc = SafeHttp.open(rel.manifestUrl, "application/octet-stream", null);
        UpdateManifest m;
        try {
            if (mc.getResponseCode() != 200) throw new IOException("update.json: HTTP " + mc.getResponseCode());
            m = UpdateManifest.parse(SafeHttp.readText(mc, 64 * 1024));
        } finally {
            mc.disconnect();
        }
        if (!m.matchesTag(rel.version)) throw new IllegalArgumentException("update.json passt nicht zum Release-Tag");
        if (rel.apkDigestSha256 != null && !HashUtil.hexEquals(rel.apkDigestSha256, m.sha256)) {
            throw new IllegalArgumentException("Prüfsummen von GitHub und update.json unterscheiden sich");
        }
        if (!UpdateVersion.isNewer(m.versionCode, AppInfo.versionCode(c))) return null;
        return new Candidate(rel, m);
    }

    private static long parseReset(HttpURLConnection c) {
        long now = System.currentTimeMillis();
        try {
            String retry = c.getHeaderField("Retry-After");
            if (retry != null) return now + Long.parseLong(retry.trim()) * 1000L;
            String r = c.getHeaderField("X-RateLimit-Reset");
            if (r != null) return Long.parseLong(r.trim()) * 1000L;
        } catch (Exception ignored) {}
        return now + 60 * 60 * 1000L;
    }
}
