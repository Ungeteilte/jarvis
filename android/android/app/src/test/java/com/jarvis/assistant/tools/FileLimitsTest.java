package com.jarvis.assistant.tools;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import org.junit.Test;

public class FileLimitsTest {
    @Test
    public void sizeLimit256KB() {
        assertNull(FileLimits.checkMeta("a.txt", "text/plain", 256 * 1024));
        assertNotNull(FileLimits.checkMeta("a.txt", "text/plain", 256 * 1024 + 1));
        assertNotNull(FileLimits.checkMeta("gross.txt", "text/plain", 1024 * 1024));
        assertNull(FileLimits.checkMeta("a.txt", "text/plain", -1)); // unbekannt → beim Lesen begrenzt
    }

    @Test
    public void onlyTextTypes() {
        assertNull(FileLimits.checkMeta("liste.md", "application/octet-stream", 10));
        assertNull(FileLimits.checkMeta("x", "application/json", 10));
        assertNull(FileLimits.checkMeta("notiz.TXT", null, 10));
        assertNotNull(FileLimits.checkMeta("bild.jpg", "image/jpeg", 10));
        assertNotNull(FileLimits.checkMeta("doc.pdf", "application/pdf", 10));
        assertNotNull(FileLimits.checkMeta("app.apk", "application/vnd.android.package-archive", 10));
        assertNotNull(FileLimits.checkMeta("x.bin", "application/octet-stream", 10));
    }

    @Test
    public void binaryDetected() {
        byte[] png = { (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d };
        assertTrue(FileLimits.looksBinary(png, png.length));
        byte[] txt = "Milch\nEier\tBrot äöü\r\n".getBytes(StandardCharsets.UTF_8);
        assertFalse(FileLimits.looksBinary(txt, txt.length));
    }

    @Test
    public void safeNames() {
        assertEquals("jarvis-notizen-2026-10-21.txt", FileLimits.safeFileName("jarvis-notizen-2026-10-21.txt"));
        assertEquals("passwd.txt", FileLimits.safeFileName("../../etc/passwd"));
        assertEquals("x.json", FileLimits.safeFileName("x.json"));
        assertEquals("jarvis.txt", FileLimits.safeFileName(""));
        assertEquals("evil.sh.txt", FileLimits.safeFileName("evil.sh"));
        assertEquals("text/plain", FileLimits.shareMime("text/html"));
    }

    @Test
    public void cacheCleanupAfterTenMinutes() throws Exception {
        File dir = Files.createTempDirectory("share").toFile();
        File old = new File(dir, "alt.txt");
        File fresh = new File(dir, "neu.txt");
        Files.write(old.toPath(), "a".getBytes(StandardCharsets.UTF_8));
        Files.write(fresh.toPath(), "b".getBytes(StandardCharsets.UTF_8));
        long now = System.currentTimeMillis();
        assertTrue(old.setLastModified(now - FileLimits.CACHE_MAX_AGE_MS - 1000));
        assertTrue(fresh.setLastModified(now - 60_000));
        List<File> gone = FileLimits.expired(dir.listFiles(), now);
        assertEquals(1, gone.size());
        assertEquals("alt.txt", gone.get(0).getName());
        assertEquals(0, FileLimits.expired(null, now).size());
    }
}
