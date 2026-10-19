package com.jarvis.assistant.updater;

import android.content.Context;
import android.net.ConnectivityManager;

import java.io.File;
import java.io.IOException;

/** Ein Durchlauf: prüfen → (ggf. WLAN abwarten) → laden → prüfen → benachrichtigen. */
public final class UpdateEngine {
    public enum Outcome { UP_TO_DATE, READY, WAITING_WIFI, RETRY, FAILED }

    private UpdateEngine() {}

    public static synchronized Outcome run(Context ctx, boolean allowMetered) {
        Context c = ctx.getApplicationContext();
        UpdateState.setStatus(c, UpdateState.CHECKING, "Suche nach Updates …");
        UpdateChecker.Candidate cand;
        try {
            cand = UpdateChecker.check(c);
        } catch (UpdateChecker.RateLimited e) {
            UpdateState.markChecked(c);
            UpdateState.setStatus(c, UpdateState.RATE_LIMITED, "GitHub-Abfragelimit erreicht – später erneut.");
            return Outcome.FAILED;
        } catch (IllegalArgumentException e) {
            UpdateState.markChecked(c);
            UpdateState.setStatus(c, UpdateState.ERROR, "Update ungültig: " + e.getMessage());
            return Outcome.FAILED;
        } catch (IOException e) {
            UpdateState.setStatus(c, UpdateState.ERROR, "Keine Verbindung zu GitHub.");
            return Outcome.RETRY;
        }
        UpdateState.markChecked(c);
        if (cand == null) {
            UpdateDownloader.cleanup(c, null);
            UpdateState.setApk(c, null);
            UpdateState.setStatus(c, UpdateState.UP_TO_DATE, "Aktuell (v" + AppInfo.versionName(c) + ")");
            return Outcome.UP_TO_DATE;
        }
        String log = cand.manifest.changelog.isEmpty() ? cand.release.body : cand.manifest.changelog;
        UpdateState.setAvailable(c, cand.manifest.versionCode, cand.manifest.versionName, log, cand.release.tag);

        if (UpdateState.wifiOnly(c) && !allowMetered && isMetered(c)) {
            UpdateState.setStatus(c, UpdateState.WAITING_WIFI,
                "v" + cand.manifest.versionName + " verfügbar – Download wartet auf WLAN.");
            UpdateScheduler.enqueueWifiDownload(c);
            return Outcome.WAITING_WIFI;
        }
        UpdateState.setProgress(c, 0);
        UpdateState.setStatus(c, UpdateState.DOWNLOADING, "Lade v" + cand.manifest.versionName + " …");
        try {
            File apk = UpdateDownloader.download(c, cand);
            UpdateState.setApk(c, apk.getAbsolutePath());
            UpdateState.setProgress(c, 100);
            UpdateState.setStatus(c, UpdateState.READY, "v" + cand.manifest.versionName + " bereit zur Installation.");
            if (UpdateState.notifiedCode(c) != cand.manifest.versionCode) {
                UpdateNotifier.notifyReady(c, cand.manifest.versionName);
                UpdateState.setNotifiedCode(c, cand.manifest.versionCode);
            }
            return Outcome.READY;
        } catch (IllegalArgumentException e) {
            UpdateState.setStatus(c, UpdateState.ERROR, e.getMessage());
            return Outcome.FAILED;
        } catch (Exception e) {
            UpdateState.setStatus(c, UpdateState.ERROR, "Download fehlgeschlagen – neuer Versuch später.");
            return Outcome.RETRY;
        }
    }

    /** Beim App-Start: nach erfolgreichem Update veraltete Zustände/Dateien aufräumen. */
    public static void reconcile(Context ctx) {
        Context c = ctx.getApplicationContext();
        if (UpdateState.availableCode(c) > 0 && UpdateState.availableCode(c) <= AppInfo.versionCode(c)) {
            UpdateDownloader.cleanup(c, null);
            UpdateState.setApk(c, null);
            UpdateState.setStatus(c, UpdateState.UP_TO_DATE, "Aktuell (v" + AppInfo.versionName(c) + ")");
        }
    }

    static boolean isMetered(Context c) {
        ConnectivityManager cm = (ConnectivityManager) c.getSystemService(Context.CONNECTIVITY_SERVICE);
        return cm == null || cm.isActiveNetworkMetered();
    }
}
