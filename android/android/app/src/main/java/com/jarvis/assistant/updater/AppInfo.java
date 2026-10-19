package com.jarvis.assistant.updater;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;

final class AppInfo {
    private AppInfo() {}

    static PackageInfo info(Context c) {
        try { return c.getPackageManager().getPackageInfo(c.getPackageName(), 0); }
        catch (Exception e) { return null; }
    }

    @SuppressWarnings("deprecation")
    static long versionCode(Context c) {
        PackageInfo pi = info(c);
        if (pi == null) return 0;
        return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    static String versionName(Context c) {
        PackageInfo pi = info(c);
        return pi == null || pi.versionName == null ? "" : pi.versionName;
    }
}
