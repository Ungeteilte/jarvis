package com.jarvis.assistant.tools;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;

import java.util.Map;
import org.junit.Test;

/** JUnit für W5: CalendarDraftSpec, DeviceStatusMapper, MediaControl. */
public class W5SpecsTest {
    @Test
    public void calendarDraftExtras() {
        long b = 1792000000000L;
        Map<String, Object> e = CalendarDraftSpec.of("  Zahnarzt\n Dr. Müller ", b, b + 1800000L, " Praxis ").extras();
        assertEquals("Zahnarzt Dr. Müller", e.get(CalendarDraftSpec.EXTRA_TITLE));
        assertEquals(b, e.get(CalendarDraftSpec.EXTRA_BEGIN_TIME));
        assertEquals(b + 1800000L, e.get(CalendarDraftSpec.EXTRA_END_TIME));
        assertEquals("Praxis", e.get(CalendarDraftSpec.EXTRA_EVENT_LOCATION));
        // Schlüssel wie in CalendarContract (Android-Doku)
        assertEquals("beginTime", CalendarDraftSpec.EXTRA_BEGIN_TIME);
        assertEquals("endTime", CalendarDraftSpec.EXTRA_END_TIME);
        assertEquals("title", CalendarDraftSpec.EXTRA_TITLE);
        assertEquals("eventLocation", CalendarDraftSpec.EXTRA_EVENT_LOCATION);
        assertEquals("android.intent.action.INSERT", CalendarDraftSpec.ACTION_INSERT);
    }

    @Test
    public void calendarDraftDefaultsAndRejects() {
        long b = 1792000000000L;
        Map<String, Object> e = CalendarDraftSpec.of("Grillen", b, null, null).extras();
        assertEquals(b + CalendarDraftSpec.DEFAULT_DURATION_MS, e.get(CalendarDraftSpec.EXTRA_END_TIME));
        assertFalse(e.containsKey(CalendarDraftSpec.EXTRA_EVENT_LOCATION));
        assertEquals(b + CalendarDraftSpec.DEFAULT_DURATION_MS, CalendarDraftSpec.of("x", b, b - 5, "").end);
        assertThrows(IllegalArgumentException.class, () -> CalendarDraftSpec.of("  ", b, null, null));
        assertThrows(IllegalArgumentException.class, () -> CalendarDraftSpec.of("x", null, null, null));
        assertEquals(120, CalendarDraftSpec.of("y".repeat(300), b, null, null).title.length());
    }

    @Test
    public void deviceStatusAllFieldsAlwaysPresent() {
        Map<String, Object> m = DeviceStatusMapper.map(true, false, true, 1, 80, true);
        assertEquals("verbunden", m.get("wlan"));
        assertEquals("nicht verbunden", m.get("mobil"));
        assertEquals("an", m.get("bluetooth"));
        assertEquals("aus", m.get("nichtStoeren"));
        assertEquals(80, m.get("akku"));
        assertEquals("ja", m.get("laedt"));
        Map<String, Object> u = DeviceStatusMapper.map(null, null, null, null, null, null);
        assertEquals(6, u.size());
        for (Object v : u.values()) assertEquals("unbekannt", v);
        assertEquals("an", DeviceStatusMapper.map(null, null, null, 2, null, null).get("nichtStoeren"));
        assertEquals("an", DeviceStatusMapper.map(null, null, null, 3, null, null).get("nichtStoeren"));
        assertEquals("unbekannt", DeviceStatusMapper.map(null, null, null, 0, -1, null).get("nichtStoeren"));
        assertEquals("unbekannt", DeviceStatusMapper.map(null, null, null, 0, 150, null).get("akku"));
    }

    @Test
    public void mediaKeysAndVolume() {
        assertEquals(127, MediaControl.keyCode("pause"));
        assertEquals(126, MediaControl.keyCode("weiter"));
        assertEquals(87, MediaControl.keyCode("naechster"));
        assertEquals(88, MediaControl.keyCode("zurueck"));
        assertEquals(-1, MediaControl.keyCode("stop"));
        assertEquals(-1, MediaControl.keyCode(null));
        assertEquals(5, MediaControl.volumeIndex(33, 15));
        assertEquals(15, MediaControl.volumeIndex(150, 15));
        assertEquals(0, MediaControl.volumeIndex(-3, 15));
        assertEquals(0, MediaControl.volumeIndex(50, 0));
        assertEquals(33, MediaControl.percentOf(5, 15));
    }
}
