package com.jarvis.assistant.tools;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * v0.9 W5 – Gerätestatus in ein festes Schema übersetzen (reines Java, per JUnit testbar).
 * {wlan, mobil, bluetooth, nichtStoeren, akku, laedt}; fehlt ein Wert (null), steht dort „unbekannt“.
 * Keine fremden Texte (kein WLAN-Name, keine Gerätenamen) → kein Taint nötig.
 */
public final class DeviceStatusMapper {
    private DeviceStatusMapper() {}

    public static final String UNBEKANNT = "unbekannt";
    // NotificationManager.INTERRUPTION_FILTER_* (fest, damit JUnit ohne Android läuft)
    public static final int FILTER_UNKNOWN = 0;
    public static final int FILTER_ALL = 1;

    public static Map<String, Object> map(Boolean wifi, Boolean cellular, Boolean bluetooth, Integer interruptionFilter,
                                          Integer batteryPercent, Boolean charging) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("wlan", wifi == null ? UNBEKANNT : wifi ? "verbunden" : "nicht verbunden");
        m.put("mobil", cellular == null ? UNBEKANNT : cellular ? "verbunden" : "nicht verbunden");
        m.put("bluetooth", bluetooth == null ? UNBEKANNT : bluetooth ? "an" : "aus");
        String dnd;
        if (interruptionFilter == null || interruptionFilter == FILTER_UNKNOWN || interruptionFilter < 0 || interruptionFilter > 4) dnd = UNBEKANNT;
        else dnd = interruptionFilter == FILTER_ALL ? "aus" : "an";
        m.put("nichtStoeren", dnd);
        m.put("akku", batteryPercent == null || batteryPercent < 0 || batteryPercent > 100 ? UNBEKANNT : batteryPercent);
        m.put("laedt", charging == null ? UNBEKANNT : charging ? "ja" : "nein");
        return m;
    }
}
