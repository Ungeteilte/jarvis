package com.jarvis.assistant.updater;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/** Rückmeldung der PackageInstaller-Session (nicht exportiert). */
public class InstallResultReceiver extends BroadcastReceiver {
    public static final String ACTION = "com.jarvis.assistant.action.INSTALL_RESULT";

    @Override
    @SuppressWarnings("deprecation")
    public void onReceive(Context context, Intent intent) {
        if (!ACTION.equals(intent.getAction())) return;
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION: {
                Intent confirm = Build.VERSION.SDK_INT >= 33
                    ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                    : intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) {
                    confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { context.startActivity(confirm); } catch (Exception e) {
                        UpdateState.setStatus(context, UpdateState.READY, "Installationsdialog konnte nicht geöffnet werden – bitte erneut versuchen.");
                    }
                }
                break;
            }
            case PackageInstaller.STATUS_SUCCESS:
                // Wird meist nicht mehr erreicht, da die App ersetzt und neu gestartet wird
                UpdateState.setStatus(context, UpdateState.UP_TO_DATE, "Update installiert.");
                break;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                UpdateState.setStatus(context, UpdateState.READY, "Installation abgebrochen – „Jetzt installieren“ erneut tippen.");
                break;
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
                UpdateState.setStatus(context, UpdateState.ERROR, "Update passt nicht zur installierten App (Signatur).");
                break;
            case PackageInstaller.STATUS_FAILURE_BLOCKED:
                UpdateState.setStatus(context, UpdateState.ERROR, "Installation blockiert (z. B. Samsung Auto Blocker oder Play Protect).");
                break;
            case PackageInstaller.STATUS_FAILURE_STORAGE:
                UpdateState.setStatus(context, UpdateState.ERROR, "Zu wenig Speicherplatz für das Update.");
                break;
            default:
                String msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                UpdateState.setStatus(context, UpdateState.ERROR, "Installation fehlgeschlagen" + (msg != null ? ": " + msg : "."));
        }
    }
}
