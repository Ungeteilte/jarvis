package com.jarvis.assistant.updater;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.security.MessageDigest;

/** Lädt das APK nach cacheDir/updates/ und prüft SHA-256, Paket, Version und Signatur. */
final class UpdateDownloader {
    private UpdateDownloader() {}

    static File dir(Context c) {
        File d = new File(c.getCacheDir(), "updates");
        //noinspection ResultOfMethodCallIgnored
        d.mkdirs();
        return d;
    }

    static File download(Context c, UpdateChecker.Candidate cand) throws Exception {
        File dir = dir(c);
        File target = new File(dir, "Jarvis-" + cand.manifest.versionCode + ".apk");
        // Schon geladen und gültig?
        if (target.exists() && HashUtil.hexEquals(HashUtil.sha256(target), cand.manifest.sha256)) {
            ApkVerifier.verify(c, target, cand.manifest.versionCode, cand.manifest.certSha256);
            return target;
        }
        cleanup(c, null);
        File part = new File(dir, target.getName() + ".part");
        HttpURLConnection conn = SafeHttp.open(cand.release.apkUrl, "application/octet-stream", null);
        try {
            if (conn.getResponseCode() != 200) throw new IOException("Download: HTTP " + conn.getResponseCode());
            long len = conn.getContentLengthLong();
            if (len > UpdatePolicy.MAX_APK_BYTES) throw new IOException("APK zu groß");
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                long total = 0; int n; int lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    total += n;
                    if (total > UpdatePolicy.MAX_APK_BYTES) throw new IOException("APK zu groß");
                    md.update(buf, 0, n);
                    out.write(buf, 0, n);
                    if (len > 0) {
                        int pct = (int) (total * 100 / len);
                        if (pct >= lastPct + 5) { lastPct = pct; UpdateState.setProgress(c, pct); }
                    }
                }
            }
            String got = HashUtil.toHex(md.digest());
            if (!HashUtil.hexEquals(got, cand.manifest.sha256)) {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
                throw new IllegalArgumentException("Prüfsumme (SHA-256) stimmt nicht – Download verworfen");
            }
        } finally {
            conn.disconnect();
        }
        if (!part.renameTo(target)) throw new IOException("Datei konnte nicht gespeichert werden");
        try {
            ApkVerifier.verify(c, target, cand.manifest.versionCode, cand.manifest.certSha256);
        } catch (RuntimeException e) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw e;
        }
        return target;
    }

    /** Löscht alte Update-Dateien (außer keep). */
    static void cleanup(Context c, File keep) {
        File[] files = dir(c).listFiles();
        if (files == null) return;
        for (File f : files) {
            if (keep != null && f.equals(keep)) continue;
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
    }
}
