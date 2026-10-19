package com.jarvis.assistant.updater;

import static org.junit.Assert.*;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

public class UpdateLogicTest {
    private static final String SHA = "a3f1c0ffee00000000000000000000000000000000000000000000000000beef";

    // ---------- Version ----------
    @Test public void parsesAndroidTags() {
        assertEquals(new UpdateVersion(0, 3, 0), UpdateVersion.parseTag("v0.3-android"));
        assertEquals(new UpdateVersion(1, 2, 3), UpdateVersion.parseTag("v1.2.3-android"));
        assertNull(UpdateVersion.parseTag("v0.3"));
        assertNull(UpdateVersion.parseTag("0.3-android"));
        assertNull(UpdateVersion.parseTag("v0.3-android-beta"));
        assertNull(UpdateVersion.parseTag("v0.x-android"));
        assertNull(UpdateVersion.parseTag(null));
        assertEquals(new UpdateVersion(0, 3, 0), UpdateVersion.parseName("0.3"));
        assertEquals(new UpdateVersion(0, 3, 1), UpdateVersion.parseName("v0.3.1"));
    }

    @Test public void comparesNumericallyNotLexically() {
        assertTrue(UpdateVersion.parseTag("v0.10-android").compareTo(UpdateVersion.parseTag("v0.9-android")) > 0);
        assertTrue(UpdateVersion.parseTag("v1.0-android").compareTo(UpdateVersion.parseTag("v0.99.9-android")) > 0);
        assertEquals(0, UpdateVersion.parseTag("v0.3-android").compareTo(UpdateVersion.parseTag("v0.3.0-android")));
        assertTrue(UpdateVersion.isNewer(3, 2));
        assertFalse(UpdateVersion.isNewer(2, 2));
        assertFalse(UpdateVersion.isNewer(1, 2));
        assertFalse(UpdateVersion.isNewer(0, 0));
    }

    // ---------- Release-Auswahl ----------
    private static JSONObject release(String tag, boolean draft, boolean pre, boolean withApk) throws Exception {
        JSONObject r = new JSONObject().put("tag_name", tag).put("draft", draft).put("prerelease", pre)
            .put("body", "Notizen " + tag).put("html_url", "https://github.com/Ungeteilte/jarvis/releases/tag/" + tag);
        JSONArray assets = new JSONArray();
        String base = "https://github.com/Ungeteilte/jarvis/releases/download/" + tag + "/";
        if (withApk) assets.put(new JSONObject().put("name", "Jarvis.apk").put("browser_download_url", base + "Jarvis.apk")
            .put("size", 123).put("digest", "sha256:" + SHA));
        assets.put(new JSONObject().put("name", "update.json").put("browser_download_url", base + "update.json"));
        return r.put("assets", assets);
    }

    @Test public void selectsHighestPublishedAndroidRelease() throws Exception {
        JSONArray list = new JSONArray()
            .put(release("v0.9-android", false, false, true))
            .put(release("v0.10-android", false, false, true))
            .put(release("v0.11-android", true, false, true))   // Entwurf
            .put(release("v0.12-android", false, true, true))   // Vorabversion
            .put(release("v2.0", false, false, true))           // kein Android-Tag
            .put(release("v0.13-android", false, false, false)); // ohne APK
        ReleaseInfo r = ReleaseSelector.selectLatest(list.toString());
        assertNotNull(r);
        assertEquals("v0.10-android", r.tag);
        assertEquals(SHA, r.apkDigestSha256);
        assertTrue(r.manifestUrl.endsWith("/v0.10-android/update.json"));
        assertEquals(123, r.apkSize);
    }

    @Test public void ignoresForeignAssetUrlsAndBadJson() throws Exception {
        JSONObject r = release("v0.5-android", false, false, false);
        r.getJSONArray("assets").put(new JSONObject().put("name", "Jarvis.apk")
            .put("browser_download_url", "https://evil.example.com/Jarvis.apk"));
        assertNull(ReleaseSelector.selectLatest(new JSONArray().put(r).toString()));
        assertNull(ReleaseSelector.selectLatest("{kaputt"));
        assertNull(ReleaseSelector.selectLatest("[]"));
    }

    // ---------- update.json ----------
    private static JSONObject manifest() throws Exception {
        return new JSONObject().put("versionCode", 3).put("versionName", "0.3").put("apk", "Jarvis.apk")
            .put("sha256", SHA.toUpperCase()).put("minVersionCode", 1).put("changelog_de", "Neu: Updates")
            .put("certSha256", "EC:27:4E:C7:56:9D:A5:1C:9B:99:7E:7D:E6:07:72:4D:2B:ED:17:BD:64:F0:D1:4E:9A:35:57:45:79:A6:42:BB");
    }

    @Test public void parsesValidManifest() throws Exception {
        UpdateManifest m = UpdateManifest.parse(manifest().toString());
        assertEquals(3, m.versionCode);
        assertEquals(SHA, m.sha256);
        assertEquals("ec274ec7569da51c9b997e7de607724d2bed17bd64f0d14e9a35574579a642bb", m.certSha256);
        assertTrue(m.matchesTag(UpdateVersion.parseTag("v0.3-android")));
        assertFalse(m.matchesTag(UpdateVersion.parseTag("v0.4-android")));
    }

    private static void assertInvalid(JSONObject o) {
        try { UpdateManifest.parse(o.toString()); fail("ungültig erwartet: " + o); }
        catch (IllegalArgumentException expected) { /* ok */ }
    }

    @Test public void rejectsInvalidManifests() throws Exception {
        assertInvalid(manifest().put("versionCode", 0));
        assertInvalid(manifest().put("versionName", "drei"));
        assertInvalid(manifest().put("apk", "../evil.apk"));
        assertInvalid(manifest().put("sha256", "1234"));
        assertInvalid(manifest().put("minVersionCode", 9));
        assertInvalid(manifest().put("certSha256", "zz"));
        JSONObject noSha = manifest(); noSha.remove("sha256"); assertInvalid(noSha);
        try { UpdateManifest.parse("nicht json"); fail(); } catch (IllegalArgumentException expected) {}
        JSONObject noCert = manifest(); noCert.remove("certSha256");
        assertNull(UpdateManifest.parse(noCert.toString()).certSha256);
    }

    // ---------- Host-Allowlist ----------
    @Test public void allowsOnlyRepoAndGithubHostsOverHttps() {
        assertTrue(UpdatePolicy.isAllowedUrl(UpdatePolicy.RELEASES_API));
        assertTrue(UpdatePolicy.isAllowedUrl("https://github.com/Ungeteilte/jarvis/releases/download/v0.3-android/Jarvis.apk"));
        assertTrue(UpdatePolicy.isAllowedUrl("https://objects.githubusercontent.com/github-production-release-asset/1?X-Amz=1"));
        assertTrue(UpdatePolicy.isAllowedUrl("https://release-assets.githubusercontent.com/github-production-release-asset/1"));
        assertFalse(UpdatePolicy.isAllowedUrl("http://github.com/Ungeteilte/jarvis/releases/download/v0.3-android/Jarvis.apk"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://github.com/Fremder/jarvis/releases/download/v1/Jarvis.apk"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://github.com/Ungeteilte/jarvis/archive/main.zip"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://api.github.com/repos/Other/jarvis/releases"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://github.com.evil.com/Ungeteilte/jarvis/releases/download/x"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://user@github.com/Ungeteilte/jarvis/releases/download/x"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://github.com:8443/Ungeteilte/jarvis/releases/download/x"));
        assertFalse(UpdatePolicy.isAllowedUrl("https://github.com/Ungeteilte/jarvis/releases/download/../../x"));
        assertFalse(UpdatePolicy.isAllowedUrl("file:///sdcard/Jarvis.apk"));
        assertFalse(UpdatePolicy.isAllowedUrl("nicht eine url"));
        assertFalse(UpdatePolicy.isAllowedUrl(null));
    }

    @Test public void intervalsAreNormalized() {
        assertEquals(3, UpdatePolicy.normalizeInterval(3));
        assertEquals(24, UpdatePolicy.normalizeInterval(24));
        assertEquals(6, UpdatePolicy.normalizeInterval(0));
        assertEquals(6, UpdatePolicy.normalizeInterval(1));
        assertEquals(6, UpdatePolicy.normalizeInterval(999));
    }

    // ---------- Hash ----------
    @Test public void hashesAndComparesSafely() throws Exception {
        String h = HashUtil.sha256("abc".getBytes(StandardCharsets.UTF_8));
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", h);
        assertEquals(h, HashUtil.sha256(new ByteArrayInputStream("abc".getBytes(StandardCharsets.UTF_8))));
        assertTrue(HashUtil.hexEquals(h, h.toUpperCase()));
        assertTrue(HashUtil.hexEquals("sha256:" + h, h));
        assertTrue(HashUtil.hexEquals("AB:CD", "abcd"));
        assertFalse(HashUtil.hexEquals(h, h.substring(1) + "0"));
        assertFalse(HashUtil.hexEquals("", ""));
        assertFalse(HashUtil.hexEquals(null, h));
    }
}
