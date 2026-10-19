package com.jarvis.assistant.updater;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public final class HashUtil {
    private HashUtil() {}

    /** Kleinbuchstaben, ohne Doppelpunkte/Leerzeichen/„sha256:“-Präfix. */
    public static String normalizeHex(String s) {
        if (s == null) return "";
        String t = s.trim().toLowerCase(Locale.ROOT);
        if (t.startsWith("sha256:")) t = t.substring(7);
        return t.replace(":", "").replace(" ", "");
    }

    /** Vergleich in konstanter Zeit nach Normalisierung. Leere Werte sind nie gleich. */
    public static boolean hexEquals(String a, String b) {
        String x = normalizeHex(a), y = normalizeHex(b);
        if (x.isEmpty() || y.isEmpty()) return false;
        return MessageDigest.isEqual(x.getBytes(), y.getBytes());
    }

    public static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b));
        return sb.toString();
    }

    public static String sha256(byte[] data) throws Exception {
        return toHex(MessageDigest.getInstance("SHA-256").digest(data));
    }

    public static String sha256(InputStream in) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        return toHex(md.digest());
    }

    public static String sha256(File f) throws Exception {
        try (InputStream in = new FileInputStream(f)) { return sha256(in); }
    }
}
