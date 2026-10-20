package com.jarvis.assistant.alarm;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.util.Map;
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
}
