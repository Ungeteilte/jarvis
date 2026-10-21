package com.jarvis.assistant.tools;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * v0.9 W2 – Grenzen für Dateien (reines Java, per JUnit testbar).
 *
 * Einlesen: nur Textdateien (MIME-Liste oder Endung), höchstens 256 KB, keine Binärdaten.
 * Teilen: Dateien liegen nur kurz in cache/share/ und werden nach 10 Minuten gelöscht.
 * Keine dauerhaften URI-Rechte (takePersistableUriPermission wird nie aufgerufen).
 */
public final class FileLimits {
    private FileLimits() {}

    public static final int MAX_BYTES = 256 * 1024;
    /** Export/Teilen: Obergrenze für den Text, den JS übergibt (Schutz vor Speicherfressern). */
    public static final int MAX_EXPORT_CHARS = 2 * 1024 * 1024;
    public static final long CACHE_MAX_AGE_MS = 10 * 60 * 1000L;
    public static final List<String> MIMES = Arrays.asList("text/plain", "text/markdown", "text/x-markdown", "application/json");
    public static final List<String> EXTENSIONS = Arrays.asList("txt", "md", "markdown", "json");
    /** Typen im Auswahl-Dialog; .md-Dateien melden manche Apps als octet-stream → danach Endung prüfen. */
    public static final String[] PICK_MIMES = { "text/*", "application/json", "application/octet-stream" };

    static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Prüft Name/Typ/Größe vor dem Lesen. size < 0 = unbekannt (wird beim Lesen begrenzt). @return null oder Meldung. */
    public static String checkMeta(String name, String mime, long size) {
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        boolean typeOk = MIMES.contains(m) || EXTENSIONS.contains(extension(name));
        if (!typeOk) return "Ich lese nur Textdateien .txt, .md oder .json – keine Bilder, PDFs oder Programme.";
        if (size > MAX_BYTES) return "Die Datei ist zu groß. Ich lese höchstens 256 KB.";
        return null;
    }

    /** NUL-Byte oder viele Steuerzeichen in den ersten 4 KB → Binärdatei. */
    public static boolean looksBinary(byte[] data, int len) {
        int n = Math.min(len, 4096);
        int ctrl = 0;
        for (int i = 0; i < n; i++) {
            int b = data[i] & 0xff;
            if (b == 0) return true;
            if (b < 9 || (b > 13 && b < 32)) ctrl++;
        }
        return n > 0 && ctrl * 50 > n;
    }

    /** Sicherer Dateiname: kein Pfad, nur harmlose Zeichen, Endung .txt oder .json. */
    public static String safeFileName(String name) {
        String base = name == null ? "" : name;
        int slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
        if (slash >= 0) base = base.substring(slash + 1);
        base = base.replaceAll("[^A-Za-z0-9äöüÄÖÜß._ -]", "").replaceAll("^\\.+", "").trim();
        if (base.length() > 80) base = base.substring(0, 80);
        String ext = extension(base);
        if (!ext.equals("txt") && !ext.equals("json")) base = (base.isEmpty() ? "jarvis" : base) + ".txt";
        return base;
    }

    /** Nur diese Typen werden gespeichert/geteilt. */
    public static String shareMime(String mime) {
        return "application/json".equals(mime) ? "application/json" : "text/plain";
    }

    /** Dateien, die älter als 10 Minuten sind (zum Löschen aus cache/share/). */
    public static List<File> expired(File[] files, long nowMs) {
        List<File> out = new ArrayList<>();
        if (files == null) return out;
        for (File f : files) if (f != null && nowMs - f.lastModified() >= CACHE_MAX_AGE_MS) out.add(f);
        return out;
    }
}
