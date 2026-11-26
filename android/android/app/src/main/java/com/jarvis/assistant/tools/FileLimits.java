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

    // ---------- v0.12: Foto, PDF, kurzes Video. Ablehnen, nie verkleinern. ----------

    public static final int MAX_IMAGE_BYTES = 4 * 1024 * 1024;
    public static final int MAX_PDF_BYTES = 4 * 1024 * 1024;
    public static final int MAX_VIDEO_BYTES = 8 * 1024 * 1024;
    public static final int MAX_VIDEO_SECONDS = 45;
    public static final String[] MEDIA_PICK_MIMES = {
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
        "application/pdf", "video/mp4", "video/webm", "video/quicktime"
    };

    public static final String MEDIA_TYPE_MSG =
        "Ich verstehe nur Fotos (JPEG, PNG, WebP, GIF oder HEIC), PDFs und kurze Videos (MP4, WebM oder MOV). Andere Dateien lese ich nicht.";
    public static final String MEDIA_MISMATCH_MSG =
        "Dateiname und Dateityp passen nicht zusammen. Ich schicke die Datei nicht.";
    public static final String MEDIA_EMPTY_MSG = "Die Datei ist leer.";
    public static final String MEDIA_UNKNOWN_VIDEO_MSG =
        "Ich kann die Länge dieses Videos nicht feststellen. Bitte ein kurzes MP4, WebM oder MOV (höchstens 45 Sekunden und 8 MB). Ich kürze es nicht.";

    public static String formatSize(long n) {
        if (n < 1024) return n + " Bytes";
        if (n < 10L * 1024 * 1024) return Math.round(n / 1024.0) + " KB";
        return String.format(Locale.GERMAN, "%.1f MB", n / (1024.0 * 1024.0));
    }

    public static int maxMediaBytes(String kind) {
        if ("image".equals(kind)) return MAX_IMAGE_BYTES;
        if ("pdf".equals(kind)) return MAX_PDF_BYTES;
        if ("video".equals(kind)) return MAX_VIDEO_BYTES;
        return 0;
    }

    private static String extOf(String name) {
        return extension(name);
    }

    /** "image", "pdf", "video" oder null. mime leer oder octet-stream → Endung. Widerspruch → null und mismatch=true über checkMedia. */
    public static String mediaKind(String name, String mime) {
        String kind = kindFromMime(mime);
        String fromExt = kindFromExt(extOf(name));
        if (kind != null && fromExt != null && !kind.equals(fromExt)) return null;
        if (kind != null) return kind;
        return fromExt;
    }

    public static boolean mediaMismatch(String name, String mime) {
        String kind = kindFromMime(mime);
        String fromExt = kindFromExt(extOf(name));
        return kind != null && fromExt != null && !kind.equals(fromExt);
    }

    private static String kindFromExt(String ext) {
        if (ext == null) return null;
        switch (ext) {
            case "jpg": case "jpeg": case "png": case "webp": case "gif": case "heic": case "heif": return "image";
            case "pdf": return "pdf";
            case "mp4": case "webm": case "mov": return "video";
            default: return null;
        }
    }

    private static String kindFromMime(String mime) {
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT).split(";")[0].trim();
        if ("image/jpg".equals(m) || "image/pjpeg".equals(m)) m = "image/jpeg";
        switch (m) {
            case "image/jpeg": case "image/png": case "image/webp": case "image/gif":
            case "image/heic": case "image/heif": return "image";
            case "application/pdf": return "pdf";
            case "video/mp4": case "video/webm": case "video/quicktime": return "video";
            default: return null;
        }
    }

    public static String tooBigMessage(String kind, long size) {
        String shown = formatSize(size);
        if ("video".equals(kind)) return "Die Datei ist zu groß (" + shown + "). Videos dürfen höchstens 8 MB haben. Ich verkleinere nichts.";
        return "Die Datei ist zu groß (" + shown + "). Fotos und PDFs dürfen höchstens 4 MB haben. Ich verkleinere nichts.";
    }

    /**
     * @param durationMs Videolänge in Millisekunden, &lt; 0 wenn unbekannt. Bei Foto/PDF ignoriert.
     * @return null oder deutsche Ablehnung. size &lt; 0 = noch unbekannt (der Aufrufer begrenzt das Lesen).
     */
    public static String checkMedia(String name, String mime, long size, long durationMs) {
        if (mediaMismatch(name, mime)) return MEDIA_MISMATCH_MSG;
        String kind = mediaKind(name, mime);
        if (kind == null) return MEDIA_TYPE_MSG;
        if (size == 0) return MEDIA_EMPTY_MSG;
        if (size > maxMediaBytes(kind)) return tooBigMessage(kind, size);
        if ("video".equals(kind)) {
            if (durationMs <= 0) return MEDIA_UNKNOWN_VIDEO_MSG;
            if (durationMs > MAX_VIDEO_SECONDS * 1000L) {
                long secs = (durationMs + 999) / 1000;
                return "Das Video ist zu lang (" + secs + " Sekunden). Ich nehme nur Videos bis 45 Sekunden und 8 MB. Ich kürze es nicht.";
            }
        }
        return null;
    }

    /** Dateien, die älter als 10 Minuten sind (zum Löschen aus cache/share/). */
    public static List<File> expired(File[] files, long nowMs) {
        List<File> out = new ArrayList<>();
        if (files == null) return out;
        for (File f : files) if (f != null && nowMs - f.lastModified() >= CACHE_MAX_AGE_MS) out.add(f);
        return out;
    }
}
