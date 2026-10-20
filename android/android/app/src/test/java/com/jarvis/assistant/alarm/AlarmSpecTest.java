package com.jarvis.assistant.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.Test;

public class AlarmSpecTest {
    @Test
    public void extrasHaveTimeMessageAndSkipUi() {
        Map<String, Object> e = AlarmSpec.of(6, 45, "  Stream\n vorbereiten ").extras();
        assertEquals(6, e.get(AlarmSpec.EXTRA_HOUR));
        assertEquals(45, e.get(AlarmSpec.EXTRA_MINUTES));
        assertEquals("Stream vorbereiten", e.get(AlarmSpec.EXTRA_MESSAGE));
        // Kern des Fehlers: ohne SKIP_UI übernimmt die Samsung-Uhr den Bildschirm und speichert nicht von selbst
        assertEquals(Boolean.TRUE, e.get(AlarmSpec.EXTRA_SKIP_UI));
        assertEquals("android.intent.action.SET_ALARM", AlarmSpec.ACTION_SET_ALARM);
    }

    @Test
    public void defaultAndLimitedMessage() {
        assertEquals("Jarvis Wecker", AlarmSpec.of(7, 0, null).message);
        assertEquals("Jarvis Wecker", AlarmSpec.of(7, 0, "   ").message);
        assertEquals(60, AlarmSpec.of(7, 0, "x".repeat(100)).message.length());
    }

    @Test
    public void rejectsMissingOrInvalidTime() {
        assertThrows(IllegalArgumentException.class, () -> AlarmSpec.of(null, 0, "x"));
        assertThrows(IllegalArgumentException.class, () -> AlarmSpec.of(7, null, "x"));
        assertThrows(IllegalArgumentException.class, () -> AlarmSpec.of(24, 0, "x"));
        assertThrows(IllegalArgumentException.class, () -> AlarmSpec.of(7, 60, "x"));
        assertThrows(IllegalArgumentException.class, () -> AlarmSpec.of(-1, 0, "x"));
        assertEquals(23, AlarmSpec.of(23, 59, "x").hour);
    }

    @Test
    public void fallbackOpensClockWithPrefilledTime() {
        Map<String, Object> e = AlarmSpec.of(4, 0, null).extras(false);
        assertEquals(4, e.get(AlarmSpec.EXTRA_HOUR));
        assertEquals(0, e.get(AlarmSpec.EXTRA_MINUTES));
        assertEquals(Boolean.FALSE, e.get(AlarmSpec.EXTRA_SKIP_UI));
        assertEquals(Boolean.TRUE, AlarmSpec.of(4, 0, null).extras().get(AlarmSpec.EXTRA_SKIP_UI));
    }

    /** v0.8-Fehler: falscher Berechtigungsname → SecurityException. Prüft Quell- und (falls gebaut) Merged-Manifest. */
    @Test
    public void manifestDeclaresRealSetAlarmPermission() throws IOException {
        String perm = "<uses-permission android:name=\"" + AlarmSpec.PERMISSION + "\"";
        String wrong = "android:name=\"android.permission.SET_ALARM\"";
        String src = new String(Files.readAllBytes(Paths.get("src/main/AndroidManifest.xml")), StandardCharsets.UTF_8);
        assertTrue("Quell-Manifest ohne " + AlarmSpec.PERMISSION, src.contains(perm));
        assertFalse("Falscher Berechtigungsname im Quell-Manifest", src.contains(wrong));
        Path inter = Paths.get("build/intermediates");
        if (!Files.isDirectory(inter)) return;
        List<Path> merged;
        try (Stream<Path> w = Files.walk(inter)) {
            merged = w.filter(p -> p.getFileName().toString().equals("AndroidManifest.xml")
                    && p.toString().contains("merged_manifest")).collect(Collectors.toList());
        }
        long srcTime = Files.getLastModifiedTime(Paths.get("src/main/AndroidManifest.xml")).toMillis();
        for (Path p : merged) {
            // Nur aktuelle Merged-Manifeste prüfen (ältere stammen von früheren Builds, z. B. einem alten Release)
            if (Files.getLastModifiedTime(p).toMillis() < srcTime) continue;
            String m = new String(Files.readAllBytes(p), StandardCharsets.UTF_8);
            if (!m.contains("package=\"com.jarvis.assistant\"") && !m.contains("com.jarvis.assistant")) continue;
            assertTrue("Merged-Manifest ohne " + AlarmSpec.PERMISSION + ": " + p, m.contains(AlarmSpec.PERMISSION));
            assertFalse("Falscher Berechtigungsname im Merged-Manifest: " + p, m.contains(wrong));
        }
    }
}
