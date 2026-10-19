package com.jarvis.assistant.updater;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.Build;

import java.io.File;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;

/** Prüft ein geladenes APK: Paketname, versionCode, Signatur (inkl. Rotations-Historie). */
final class ApkVerifier {
    private ApkVerifier() {}

    @SuppressWarnings("deprecation")
    static void verify(Context c, File apk, long expectedCode, String expectedCertSha256) {
        PackageManager pm = c.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) throw new IllegalArgumentException("APK ist beschädigt oder unlesbar");
        if (!UpdatePolicy.PACKAGE_NAME.equals(archive.packageName)) throw new IllegalArgumentException("Falscher Paketname");
        long code = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        if (code != expectedCode) throw new IllegalArgumentException("versionCode passt nicht zu update.json");
        if (code <= AppInfo.versionCode(c)) throw new IllegalArgumentException("APK ist nicht neuer als die installierte Version");

        PackageInfo installed;
        try { installed = pm.getPackageInfo(c.getPackageName(), flags); }
        catch (Exception e) { throw new IllegalArgumentException("Installierte Signatur nicht lesbar"); }

        Set<String> archiveCurrent = new HashSet<>(), archiveAll = new HashSet<>();
        Set<String> installedAll = new HashSet<>();
        collect(archive, archiveCurrent, archiveAll);
        collect(installed, new HashSet<>(), installedAll);
        if (archiveCurrent.isEmpty()) throw new IllegalArgumentException("APK ist nicht signiert");

        // Neues APK muss die installierte Signatur kennen (gleich oder in der Rotations-Historie)
        boolean linked = false;
        for (String s : installedAll) if (archiveAll.contains(s)) { linked = true; break; }
        if (!linked) throw new IllegalArgumentException("Signatur passt nicht zur installierten App");
        if (expectedCertSha256 != null) {
            boolean ok = false;
            for (String s : archiveCurrent) if (HashUtil.hexEquals(s, expectedCertSha256)) { ok = true; break; }
            if (!ok) throw new IllegalArgumentException("Signaturzertifikat passt nicht zu update.json");
        }
    }

    @SuppressWarnings("deprecation")
    private static void collect(PackageInfo pi, Set<String> current, Set<String> all) {
        if (Build.VERSION.SDK_INT >= 28 && pi.signingInfo != null) {
            SigningInfo si = pi.signingInfo;
            Signature[] cur = si.getApkContentsSigners();
            if (cur != null) for (Signature s : cur) { current.add(sha(s)); all.add(sha(s)); }
            if (!si.hasMultipleSigners()) {
                Signature[] hist = si.getSigningCertificateHistory();
                if (hist != null) for (Signature s : hist) all.add(sha(s));
            }
        } else if (pi.signatures != null) {
            for (Signature s : pi.signatures) { current.add(sha(s)); all.add(sha(s)); }
        }
    }

    private static String sha(Signature s) {
        try { return HashUtil.toHex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())); }
        catch (Exception e) { return ""; }
    }
}
