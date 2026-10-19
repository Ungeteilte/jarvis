package com.jarvis.assistant.updater;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Installation über eine PackageInstaller-Session. Android zeigt IMMER seinen eigenen
 * Bestätigungsdialog („Installieren“) – stilles Installieren ist ohne Device-Owner nicht möglich.
 */
public final class UpdateInstaller {
    public static final String RESULT_NEEDS_PERMISSION = "needs-permission";
    public static final String RESULT_NOT_READY = "not-ready";
    public static final String RESULT_STARTED = "started";
    public static final String RESULT_FALLBACK = "fallback";
    public static final String RESULT_ERROR = "error";

    private UpdateInstaller() {}

    public static File readyApk(Context c) {
        String p = UpdateState.apkPath(c);
        if (p == null) return null;
        File f = new File(p);
        File dir = UpdateDownloader.dir(c);
        if (!f.exists() || !dir.equals(f.getParentFile())) return null;
        if (UpdateState.availableCode(c) <= AppInfo.versionCode(c)) return null;
        return f;
    }

    /** Startet die Installation aus der sichtbaren App (Android 14: kein Start aus dem Hintergrund). */
    public static String install(Activity activity) {
        Context c = activity.getApplicationContext();
        File apk = readyApk(c);
        if (apk == null) return RESULT_NOT_READY;
        if (Build.VERSION.SDK_INT >= 26 && !c.getPackageManager().canRequestPackageInstalls()) {
            // Erstes Mal: „Unbekannte Apps installieren“ für Jarvis erlauben
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + c.getPackageName()));
            try { activity.startActivity(i); } catch (ActivityNotFoundException ignored) {}
            UpdateState.setStatus(c, UpdateState.READY,
                "Bitte „Unbekannte Apps installieren“ für Jarvis erlauben und dann erneut „Jetzt installieren“ tippen.");
            return RESULT_NEEDS_PERMISSION;
        }
        try {
            // Datei kurz vor der Installation erneut prüfen (Cache könnte verändert sein)
            UpdateState.setStatus(c, UpdateState.INSTALLING, "Installation wird vorbereitet …");
            ApkVerifier.verify(c, apk, UpdateState.availableCode(c), null);
            installWithSession(c, apk);
            UpdateNotifier.cancel(c);
            return RESULT_STARTED;
        } catch (IllegalArgumentException e) {
            UpdateState.setStatus(c, UpdateState.ERROR, e.getMessage());
            return RESULT_ERROR;
        } catch (Exception e) {
            // Fallback: klassischer Installer über FileProvider
            try {
                Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", apk);
                Intent view = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                activity.startActivity(view);
                UpdateState.setStatus(c, UpdateState.INSTALLING, "Bitte im Android-Dialog „Installieren“ tippen.");
                return RESULT_FALLBACK;
            } catch (Exception e2) {
                UpdateState.setStatus(c, UpdateState.ERROR, "Installation konnte nicht gestartet werden.");
                return RESULT_ERROR;
            }
        }
    }

    private static void installWithSession(Context c, File apk) throws Exception {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        params.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        int id = pi.createSession(params);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("Jarvis.apk", 0, apk.length())) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent cb = new Intent(c, InstallResultReceiver.class).setAction(InstallResultReceiver.ACTION);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent sender = PendingIntent.getBroadcast(c, id, cb, flags);
            s.commit(sender.getIntentSender());
        } catch (Exception e) {
            try { pi.abandonSession(id); } catch (Exception ignored) {}
            throw e;
        }
        UpdateState.setStatus(c, UpdateState.INSTALLING, "Bitte im Android-Dialog „Installieren“ tippen.");
    }
}
