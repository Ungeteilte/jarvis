package com.jarvis.assistant.alarm;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reine Logik für „Wecker stellen“ (ohne Android-Klassen, daher per JUnit testbar).
 *
 * Fehler bis v0.7: Der Wecker wurde mit EXTRA_SKIP_UI=false an die Uhr-App gegeben. Die Samsung-Uhr
 * öffnete dann ihren Bearbeiten-Bildschirm im Vordergrund (Jarvis „verschwand“), und gespeichert wurde
 * nur, wenn man dort selbst auf „Speichern“ tippte. Jetzt: SKIP_UI=true (Wecker wird im Hintergrund
 * gestellt), Stunde/Minute sind Pflicht (kein stiller Standard 7:00), Beschriftung wird begrenzt.
 *
 * Fehler in v0.8: Im Manifest stand „android.permission.SET_ALARM“ statt der echten Berechtigung
 * {@link #PERMISSION}; die Uhr-App lehnte den Intent mit SecurityException ab. Lehnt eine Uhr-App das
 * Stellen im Hintergrund trotzdem ab, öffnet Jarvis sie ersatzweise mit vorausgefüllter Uhrzeit
 * ({@link #extras(boolean)} mit skipUi=false) und sagt ehrlich, dass dort „Speichern“ nötig ist.
 */
public final class AlarmSpec {
    // Gleiche Werte wie android.provider.AlarmClock (hier als Text, damit der Test ohne Android läuft).
    // JarvisNativePlugin setzt die Extras mit den echten AlarmClock-Konstanten.
    public static final String ACTION_SET_ALARM = "android.intent.action.SET_ALARM";
    public static final String EXTRA_HOUR = "android.intent.extra.alarm.HOUR";
    public static final String EXTRA_MINUTES = "android.intent.extra.alarm.MINUTES";
    public static final String EXTRA_MESSAGE = "android.intent.extra.alarm.MESSAGE";
    public static final String EXTRA_SKIP_UI = "android.intent.extra.alarm.SKIP_UI";
    /** Berechtigung, mit der Uhr-Apps ACTION_SET_ALARM schützen (muss im Manifest stehen). */
    public static final String PERMISSION = "com.android.alarm.permission.SET_ALARM";
    public static final int MAX_MESSAGE = 60;
    public static final String DEFAULT_MESSAGE = "Jarvis Wecker";

    public final int hour;
    public final int minute;
    public final String message;

    private AlarmSpec(int hour, int minute, String message) {
        this.hour = hour;
        this.minute = minute;
        this.message = message;
    }

    /** Prüft die Eingaben. Wirft IllegalArgumentException mit deutscher Meldung bei ungültiger Uhrzeit. */
    public static AlarmSpec of(Integer hour, Integer minute, String message) {
        if (hour == null || minute == null) throw new IllegalArgumentException("Uhrzeit fehlt.");
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) throw new IllegalArgumentException("Ungültige Uhrzeit.");
        String m = message == null ? "" : message.replaceAll("[\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (m.isEmpty()) m = DEFAULT_MESSAGE;
        if (m.length() > MAX_MESSAGE) m = m.substring(0, MAX_MESSAGE).trim();
        return new AlarmSpec(hour, minute, m);
    }

    /** Extras für den normalen Weg: SKIP_UI=true, Jarvis bleibt im Vordergrund. */
    public Map<String, Object> extras() {
        return extras(true);
    }

    /**
     * Extras für ACTION_SET_ALARM. skipUi=true: im Hintergrund stellen (normaler Weg).
     * skipUi=false: Ersatzweg – Uhr-App öffnet sich mit vorausgefüllter Zeit, der Nutzer tippt „Speichern“.
     */
    public Map<String, Object> extras(boolean skipUi) {
        Map<String, Object> e = new LinkedHashMap<>();
        e.put(EXTRA_HOUR, hour);
        e.put(EXTRA_MINUTES, minute);
        e.put(EXTRA_MESSAGE, message);
        e.put(EXTRA_SKIP_UI, skipUi);
        return e;
    }
}
