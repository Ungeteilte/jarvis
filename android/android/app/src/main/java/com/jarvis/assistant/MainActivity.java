package com.jarvis.assistant;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.jarvis.assistant.briefing.BriefingLaunch;
import com.jarvis.assistant.briefing.BriefingScheduler;
import com.jarvis.assistant.updater.UpdateEngine;
import com.jarvis.assistant.updater.UpdateInstaller;
import com.jarvis.assistant.updater.UpdateNotifier;
import com.jarvis.assistant.updater.UpdateScheduler;
import com.jarvis.assistant.updater.UpdateState;

public class MainActivity extends BridgeActivity {
    private boolean installAfterPermission = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JarvisNativePlugin.class);
        super.onCreate(savedInstanceState);
        try {
            UpdateEngine.reconcile(this);
            UpdateScheduler.ensureScheduled(this); // KEEP: bestehenden Plan behalten
        } catch (Exception ignored) { /* Updater darf den Start nie verhindern */ }
        try { BriefingScheduler.ensure(this); } catch (Exception ignored) { /* Briefing ebenso nicht */ }
        maybeAskNotifications();
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Zurück aus „Unbekannte Apps installieren“: Installation automatisch fortsetzen
        if (installAfterPermission && (Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls())) {
            installAfterPermission = false;
            getWindow().getDecorView().postDelayed(() -> UpdateInstaller.install(this), 400);
        }
    }

    public void installAfterPermission() { installAfterPermission = true; }

    private void handleIntent(Intent intent) {
        if (intent != null && BriefingLaunch.ACTION.equals(intent.getAction())) {
            BriefingLaunch.handle(this, intent);
            intent.setAction(Intent.ACTION_MAIN);
            intent.removeExtra(BriefingLaunch.EXTRA_NONCE);
            return;
        }
        if (intent == null || !UpdateNotifier.ACTION_INSTALL.equals(intent.getAction())) return;
        intent.setAction(Intent.ACTION_MAIN);
        getWindow().getDecorView().postDelayed(() -> {
            String r = UpdateInstaller.install(this);
            if (UpdateInstaller.RESULT_NEEDS_PERMISSION.equals(r)) installAfterPermission = true;
        }, 600);
    }

    /** Android 13+: einmalig nach Benachrichtigungen fragen, wenn Auto-Updates an sind. */
    private void maybeAskNotifications() {
        if (Build.VERSION.SDK_INT < 33 || !UpdateState.enabled(this) || UpdateState.askedNotifications(this)) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        UpdateState.setAskedNotifications(this);
        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4712);
    }
}
