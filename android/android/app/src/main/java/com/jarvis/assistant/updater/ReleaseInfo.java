package com.jarvis.assistant.updater;

/** Ein ausgewähltes Android-Release. */
public final class ReleaseInfo {
    public final String tag;
    public final UpdateVersion version;
    public final String apkUrl;
    public final String apkDigestSha256; // aus GitHub-Asset „digest“, kann null sein
    public final long apkSize;
    public final String manifestUrl;     // update.json, kann null sein
    public final String body;
    public final String htmlUrl;

    public ReleaseInfo(String tag, UpdateVersion version, String apkUrl, String apkDigestSha256, long apkSize,
                       String manifestUrl, String body, String htmlUrl) {
        this.tag = tag; this.version = version; this.apkUrl = apkUrl; this.apkDigestSha256 = apkDigestSha256;
        this.apkSize = apkSize; this.manifestUrl = manifestUrl; this.body = body; this.htmlUrl = htmlUrl;
    }
}
