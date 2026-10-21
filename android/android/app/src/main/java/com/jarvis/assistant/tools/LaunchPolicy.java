package com.jarvis.assistant.tools;

import java.util.Collection;
import java.util.regex.Pattern;

/**
 * v0.9 W1 – Regel fürs App-Starten (reines Java, per JUnit testbar).
 *
 * Jarvis startet nur ein konkretes Paket, das gerade in der Launcher-Liste steht
 * (queryIntentActivities MAIN/LAUNCHER). Keine Text-Suche mehr in Java, kein QUERY_ALL_PACKAGES,
 * kein Start von Systemdiensten ohne Launcher-Eintrag, nie Jarvis selbst.
 */
public final class LaunchPolicy {
    private LaunchPolicy() {}

    /** Paketnamen nach Android-Regel: mind. zwei Segmente, Buchstabe vorn, nur [A-Za-z0-9_]. */
    private static final Pattern PKG = Pattern.compile("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$");
    public static final int MAX_PKG_LEN = 255;

    public static boolean isValidPackageName(String pkg) {
        return pkg != null && pkg.length() <= MAX_PKG_LEN && PKG.matcher(pkg).matches();
    }

    /**
     * Prüft einen Startwunsch.
     * @return null, wenn gestartet werden darf; sonst eine deutsche Fehlermeldung (ohne Klammern).
     */
    public static String check(String pkg, Collection<String> launchable, String ownPackage) {
        if (pkg == null || pkg.trim().isEmpty()) return "Welche App soll ich öffnen? Es fehlt der Name.";
        if (!isValidPackageName(pkg)) return "Das ist kein gültiger App-Name.";
        if (pkg.equals(ownPackage)) return "Jarvis ist schon offen.";
        if (launchable == null || !launchable.contains(pkg)) return "Diese App ist nicht installiert oder lässt sich nicht starten.";
        return null;
    }
}
