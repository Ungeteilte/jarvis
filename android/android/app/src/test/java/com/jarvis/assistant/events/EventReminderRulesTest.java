package com.jarvis.assistant.events;

import static org.junit.Assert.*;

import org.junit.Test;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

public class EventReminderRulesTest {
    private static final TimeZone BERLIN = TimeZone.getTimeZone("Europe/Berlin");
    private static long t(String iso) { return OffsetDateTime.parse(iso).toInstant().toEpochMilli(); }
    private static EventReminderRules.Ev ev(long id, String begin, boolean allDay, String title) {
        long b = t(begin);
        return new EventReminderRules.Ev(id, b, b + EventReminderRules.H, allDay, title);
    }

    @Test
    public void clampLeadMatchesJs() {
        // gleiche Werte wie tests/event-reminders.test.mjs (clampLead)
        assertEquals(15, EventReminderRules.clampLead(0));
        assertEquals(15, EventReminderRules.clampLead(-3));
        assertEquals(5, EventReminderRules.clampLead(1));
        assertEquals(10, EventReminderRules.clampLead(9));
        assertEquals(15, EventReminderRules.clampLead(14));
        assertEquals(30, EventReminderRules.clampLead(25));
        assertEquals(60, EventReminderRules.clampLead(240));
    }

    @Test
    public void planDueAndNext() {
        long now = t("2026-10-21T14:00:00+02:00");
        List<EventReminderRules.Ev> evs = Arrays.asList(
            ev(1, "2026-10-21T14:10:00+02:00", false, "Zahnarzt"),     // in 10 Min → fällig (Vorlauf 15)
            ev(2, "2026-10-21T16:00:00+02:00", false, "Meeting"),      // Hinweis 15:45 → nächster Alarm
            ev(3, "2026-10-21T13:30:00+02:00", false, "Vorbei"),       // schon begonnen → nie
            ev(4, "2026-10-22T00:00:00+00:00", true, "Geburtstag"),    // ganztägig → still
            ev(5, "2026-10-21T18:00:00+02:00", false, "Abendessen"));
        EventReminderRules.Plan p = EventReminderRules.plan(evs, now, 15, new HashSet<>());
        assertEquals(1, p.due.size());
        assertEquals(1, p.due.get(0).id);
        assertEquals(t("2026-10-21T15:45:00+02:00"), p.nextAt);
    }

    @Test
    public void noDoubleNotifyAndTolerance() {
        long now = t("2026-10-21T15:44:40+02:00"); // Alarm 20 s zu früh → zählt
        List<EventReminderRules.Ev> evs = new ArrayList<>(Arrays.asList(ev(2, "2026-10-21T16:00:00+02:00", false, "Meeting")));
        EventReminderRules.Plan p = EventReminderRules.plan(evs, now, 15, new HashSet<>());
        assertEquals(1, p.due.size());
        assertEquals(0, p.nextAt);
        HashSet<String> done = new HashSet<>(Arrays.asList(evs.get(0).key()));
        EventReminderRules.Plan p2 = EventReminderRules.plan(evs, now + 1000, 15, done);
        assertTrue(p2.due.isEmpty());
        // gleiche Serie, andere Instanz (anderer Beginn) → eigener Schlüssel
        evs.add(ev(2, "2026-10-22T16:00:00+02:00", false, "Meeting"));
        EventReminderRules.Plan p3 = EventReminderRules.plan(evs, now + 1000, 15, done);
        assertTrue(p3.due.isEmpty());
        assertEquals(t("2026-10-22T15:45:00+02:00"), p3.nextAt);
        // 40 s zu früh → noch nicht fällig, Alarm bleibt
        EventReminderRules.Plan p4 = EventReminderRules.plan(evs.subList(0, 1), t("2026-10-21T15:44:20+02:00"), 15, new HashSet<>());
        assertTrue(p4.due.isEmpty());
        assertEquals(t("2026-10-21T15:45:00+02:00"), p4.nextAt);
    }

    @Test
    public void leadAndDstAndPrune() {
        // Zeitumstellung (25.10.2026, 3 → 2 Uhr): Termin 02:30 MEZ, Vorlauf 60 → Hinweis 01:30 MEZ = 02:30 MESZ (absolute Zeit)
        long begin = t("2026-10-25T02:30:00+01:00");
        List<EventReminderRules.Ev> evs = Arrays.asList(new EventReminderRules.Ev(9, begin, begin + EventReminderRules.H, false, "Nachtschicht"));
        EventReminderRules.Plan p = EventReminderRules.plan(evs, t("2026-10-25T00:00:00+02:00"), 60, null);
        assertEquals(begin - EventReminderRules.H, p.nextAt);
        Map<String, Long> m = new HashMap<>();
        long now = t("2026-10-21T12:00:00+02:00");
        m.put("1:a", now - 49 * EventReminderRules.H);
        m.put("2:b", now - 2 * EventReminderRules.H);
        Map<String, Long> kept = EventReminderRules.prune(m, now);
        assertEquals(1, kept.size());
        assertTrue(kept.containsKey("2:b"));
    }

    @Test
    public void textsAndSpeech() {
        long now = t("2026-10-21T14:00:00+02:00");
        EventReminderRules.Ev e = ev(1, "2026-10-21T14:15:00+02:00", false, "Zahnarzt\nDr. Weiß");
        assertEquals("Termin in 15 Minuten", EventReminderRules.notifyTitle(e, now));
        assertEquals("„Zahnarzt Dr. Weiß“ beginnt um 14:15 Uhr.", EventReminderRules.notifyText(e, now, BERLIN));
        EventReminderRules.Ev untitled = ev(2, "2026-10-21T14:15:00+02:00", false, "  ");
        assertEquals("Ihr nächster Termin beginnt um 14:15 Uhr.", EventReminderRules.notifyText(untitled, now, BERLIN));
        // Ohne „Termintitel vorlesen“ kein Titel in der Sprache
        String plain = EventReminderRules.speechText(Arrays.asList(e), now, BERLIN, false);
        assertEquals("Kurzer Hinweis: Ihr nächster Termin beginnt in 15 Minuten, um 14:15 Uhr.", plain);
        assertFalse(plain.contains("Zahnarzt"));
        assertTrue(EventReminderRules.speechText(Arrays.asList(e), now, BERLIN, true).contains("„Zahnarzt Dr. Weiß“"));
        String two = EventReminderRules.speechText(Arrays.asList(e, ev(3, "2026-10-21T14:10:00+02:00", false, "X")), now, BERLIN, true);
        assertEquals("Kurzer Hinweis: Sie haben 2 Termine, der erste beginnt in 10 Minuten.", two);
        assertEquals("Termin in einer Minute", EventReminderRules.notifyTitle(e, e.begin - 20_000));
        assertEquals("", EventReminderRules.speechText(new ArrayList<>(), now, BERLIN, true));
        // Vorlesen nur 7–22 Uhr
        assertFalse(EventReminderRules.speakHour(t("2026-10-21T06:59:00+02:00"), BERLIN));
        assertTrue(EventReminderRules.speakHour(t("2026-10-21T07:00:00+02:00"), BERLIN));
        assertTrue(EventReminderRules.speakHour(t("2026-10-21T21:59:00+02:00"), BERLIN));
        assertFalse(EventReminderRules.speakHour(t("2026-10-21T22:00:00+02:00"), BERLIN));
    }
}
