package com.jarvis.assistant.briefing;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reine Text-Logik des Hintergrund-Briefings (ohne Android): Bereinigen, RSS/Wetter lesen,
 * Kurzfassung nach Vorlage. Fremde Texte werden wie in js/core/briefing/sanitize.js behandelt.
 */
public final class BriefingText {
    private BriefingText() {}

    private static final Pattern CONTROL = Pattern.compile("[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2069\\uFEFF]");
    private static final Pattern URLS = Pattern.compile("(?i)\\b(?:https?|ftp|file|javascript|data|intent|content|tel|sms|mailto):\\S*");
    private static final Pattern WWW = Pattern.compile("(?i)\\bwww\\.\\S+");

    public static String clean(String s, int max) {
        if (s == null) return "";
        String t = CONTROL.matcher(s).replaceAll(" ");
        t = URLS.matcher(t).replaceAll("");
        t = WWW.matcher(t).replaceAll("");
        t = t.replaceAll("[<>{}`\\\\\\[\\]|]", " ").replaceAll("\\s+", " ").trim();
        if (t.length() > max) {
            t = t.substring(0, Math.max(1, max - 1)).replaceAll("\\s+\\S*$", "") + "…";
        }
        return t;
    }

    // ---------- RSS ----------
    public static final class NewsItem {
        public final String title; public final String summary; public final long at;
        public NewsItem(String title, String summary, long at) { this.title = title; this.summary = summary; this.at = at; }
    }

    private static final Pattern ITEM = Pattern.compile("(?is)<item(?:\\s[^>]*)?>(.*?)</item>");

    private static String tag(String block, String name) {
        Matcher m = Pattern.compile("(?is)<" + name + "(?:\\s[^>]*)?>(.*?)</" + name + ">").matcher(block);
        if (!m.find()) return "";
        String v = m.group(1).trim();
        if (v.startsWith("<![CDATA[") && v.endsWith("]]>")) v = v.substring(9, v.length() - 3);
        v = v.replaceAll("<[^>]*>", " ");
        return decode(v);
    }

    static String decode(String s) {
        Matcher m = Pattern.compile("&(#x[0-9a-fA-F]+|#\\d+|[a-zA-Z]+);").matcher(s);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String e = m.group(1);
            String r;
            if (e.startsWith("#")) {
                int n;
                try { n = e.length() > 1 && (e.charAt(1) == 'x' || e.charAt(1) == 'X') ? Integer.parseInt(e.substring(2), 16) : Integer.parseInt(e.substring(1)); }
                catch (Exception ex) { n = 32; }
                r = n > 31 && n < 0x110000 ? new String(Character.toChars(n)) : " ";
            } else {
                switch (e.toLowerCase(Locale.ROOT)) {
                    case "amp": r = "&"; break; case "lt": r = "<"; break; case "gt": r = ">"; break;
                    case "quot": r = "\""; break; case "apos": r = "'"; break; default: r = " ";
                }
            }
            m.appendReplacement(sb, Matcher.quoteReplacement(r));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    public static List<NewsItem> parseRss(String xml, int maxItems) {
        List<NewsItem> out = new ArrayList<>();
        if (xml == null) return out;
        Matcher m = ITEM.matcher(xml);
        SimpleDateFormat rfc = new SimpleDateFormat("EEE, d MMM yyyy HH:mm:ss Z", Locale.ENGLISH);
        while (m.find() && out.size() < maxItems) {
            String title = clean(tag(m.group(1), "title"), 120);
            if (title.isEmpty()) continue;
            long at = 0;
            try { Date d = rfc.parse(tag(m.group(1), "pubDate").trim()); if (d != null) at = d.getTime(); } catch (Exception ignored) {}
            out.add(new NewsItem(title, clean(tag(m.group(1), "description"), 220), at));
        }
        return out;
    }

    /** Mehrere Feeds mischen: neueste zuerst, reihum, ohne Dubletten. */
    public static List<NewsItem> merge(List<List<NewsItem>> lists, int max) {
        List<List<NewsItem>> sorted = new ArrayList<>();
        for (List<NewsItem> l : lists) {
            List<NewsItem> c = new ArrayList<>(l);
            Collections.sort(c, (a, b) -> Long.compare(b.at, a.at));
            sorted.add(c);
        }
        Set<String> seen = new HashSet<>();
        List<NewsItem> out = new ArrayList<>();
        for (int round = 0; out.size() < max; round++) {
            boolean any = false;
            for (List<NewsItem> l : sorted) {
                if (l.size() <= round) continue;
                any = true;
                NewsItem it = l.get(round);
                if (seen.add(it.title.toLowerCase(Locale.ROOT))) out.add(it);
                if (out.size() >= max) break;
            }
            if (!any) break;
        }
        return out;
    }

    // ---------- Wetter ----------
    public static final Map<Integer, String> WMO = new HashMap<>();
    static {
        Object[][] w = {
            {0, "klar"}, {1, "überwiegend klar"}, {2, "teils bewölkt"}, {3, "bedeckt"}, {45, "neblig"}, {48, "neblig mit Reif"},
            {51, "leichter Nieselregen"}, {53, "Nieselregen"}, {55, "starker Nieselregen"}, {56, "gefrierender Nieselregen"}, {57, "gefrierender Nieselregen"},
            {61, "leichter Regen"}, {63, "Regen"}, {65, "starker Regen"}, {66, "gefrierender Regen"}, {67, "gefrierender Regen"},
            {71, "leichter Schneefall"}, {73, "Schneefall"}, {75, "starker Schneefall"}, {77, "Schneegriesel"},
            {80, "leichte Regenschauer"}, {81, "Regenschauer"}, {82, "heftige Regenschauer"}, {85, "Schneeschauer"}, {86, "starke Schneeschauer"},
            {95, "Gewitter"}, {96, "Gewitter mit Hagel"}, {99, "schweres Gewitter mit Hagel"}
        };
        for (Object[] x : w) WMO.put((Integer) x[0], (String) x[1]);
    }

    public static final class Weather {
        public Double now, min, max, rainChance; public String nowText, dayText; public boolean stale;
        public JSONObject toJson() {
            JSONObject o = new JSONObject();
            try {
                o.put("now", now); o.put("min", min); o.put("max", max); o.put("rainChance", rainChance);
                o.put("nowText", nowText); o.put("dayText", dayText); o.put("stale", stale);
            } catch (Exception ignored) {}
            return o;
        }
        public static Weather fromJson(JSONObject o) {
            if (o == null) return null;
            Weather w = new Weather();
            w.now = opt(o, "now"); w.min = opt(o, "min"); w.max = opt(o, "max"); w.rainChance = opt(o, "rainChance");
            w.nowText = o.optString("nowText", null); w.dayText = o.optString("dayText", null); w.stale = o.optBoolean("stale");
            if ("null".equals(w.nowText)) w.nowText = null;
            if ("null".equals(w.dayText)) w.dayText = null;
            return w;
        }
    }

    private static Double opt(JSONObject o, String k) {
        if (o == null || !o.has(k) || o.isNull(k)) return null;
        double d = o.optDouble(k, Double.NaN);
        return Double.isNaN(d) ? null : d;
    }
    private static Double at(JSONObject o, String k, int i) {
        JSONArray a = o == null ? null : o.optJSONArray(k);
        if (a == null || a.length() <= i || a.isNull(i)) return null;
        double d = a.optDouble(i, Double.NaN);
        return Double.isNaN(d) ? null : d;
    }

    /** Open-Meteo-JSON → Wetter heute. Wirft bei Unsinn. */
    public static Weather parseWeather(String json) throws Exception { return parseWeather(json, 0); }

    /** dayIndex 0 = heute (mit aktuellem Wert), 1 = morgen (nur Tageswerte). */
    public static Weather parseWeather(String json, int dayIndex) throws Exception {
        int i = dayIndex == 1 ? 1 : 0;
        JSONObject j = new JSONObject(json);
        JSONObject daily = j.getJSONObject("daily");
        JSONObject cur = i == 0 ? j.optJSONObject("current") : null;
        Weather w = new Weather();
        w.now = opt(cur, "temperature_2m");
        Double cc = opt(cur, "weather_code");
        w.nowText = cc == null ? null : WMO.get(cc.intValue());
        w.max = at(daily, "temperature_2m_max", i);
        w.min = at(daily, "temperature_2m_min", i);
        w.rainChance = at(daily, "precipitation_probability_max", i);
        Double dc = at(daily, "weather_code", i);
        w.dayText = dc == null ? null : WMO.get(dc.intValue());
        if (w.now == null && w.max == null && w.min == null) throw new Exception("Keine Wetterwerte");
        return w;
    }

    public static String weatherSentence(Weather w) { return weatherSentence(w, "Heute"); }

    /** lead = „Heute“ oder „Morgen“ (dann ohne aktuellen Wert). */
    public static String weatherSentence(Weather w, String lead) {
        if (w == null) return "";
        boolean today = "Heute".equals(lead);
        StringBuilder sb = new StringBuilder();
        String where = w.stale ? "An Ihrem zuletzt bekannten Ort" : "Bei Ihnen";
        if (today && w.now != null) {
            sb.append(where).append(" sind es gerade ").append(Math.round(w.now)).append(" Grad");
            if (w.nowText != null) sb.append(", ").append(w.nowText);
            sb.append(". ");
        }
        String range = w.min != null && w.max != null ? "zwischen " + Math.round(w.min) + " und " + Math.round(w.max) + " Grad"
            : w.max != null ? "bis " + Math.round(w.max) + " Grad" : "";
        StringBuilder d = new StringBuilder(lead);
        if (w.dayText != null) d.append(" ").append(w.dayText).append(range.isEmpty() ? "" : ",");
        if (!range.isEmpty()) d.append(" ").append(range);
        if (w.rainChance != null && w.rainChance >= 30) d.append(", Regenrisiko ").append(Math.round(w.rainChance)).append(" Prozent");
        if (d.length() > lead.length()) sb.append(d).append(".");
        return sb.toString().trim();
    }

    // ---------- Kurzfassung ----------
    public static final class Event {
        public final String title; public final long begin; public final boolean allDay;
        public Event(String title, long begin, boolean allDay) { this.title = clean(title, 120); this.begin = begin; this.allDay = allDay; }
    }

    private static final String[] NUM = {"keine", "einen", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"};

    public static String clock(long ms, TimeZone tz) {
        SimpleDateFormat f = new SimpleDateFormat("H:mm", Locale.GERMANY);
        f.setTimeZone(tz);
        return f.format(new Date(ms));
    }

    /**
     * Kurzes Briefing für Benachrichtigung und Vorlesen.
     * titles=false: Termine nur mit Anzahl und erster Uhrzeit (Privatsphäre).
     * events=null: Kalender nicht verfügbar/aus; news=null: keine Nachrichten.
     */
    public static String compose(long nowMs, TimeZone tz, Weather w, List<Event> events, List<NewsItem> news, boolean titles) {
        StringBuilder sb = new StringBuilder();
        SimpleDateFormat df = new SimpleDateFormat("EEEE, d. MMMM", Locale.GERMANY);
        df.setTimeZone(tz);
        sb.append("Guten Morgen. Heute ist ").append(df.format(new Date(nowMs))).append(", es ist ").append(clock(nowMs, tz)).append(" Uhr. ");
        if (w != null) sb.append(weatherSentence(w)).append(" ");
        if (events != null) {
            if (events.isEmpty()) sb.append("Im Kalender steht heute nichts. ");
            else {
                Event first = null;
                for (Event e : events) if (!e.allDay) { first = e; break; }
                int n = events.size();
                sb.append("Sie haben heute ").append(n == 1 ? "einen Termin" : (n < NUM.length ? NUM[n] : String.valueOf(n)) + " Termine");
                if (first != null) {
                    sb.append(n == 1 ? ", um " : ", der erste um ").append(clock(first.begin, tz)).append(" Uhr");
                    if (titles && !first.title.isEmpty()) sb.append(": ").append(first.title);
                } else if (titles && !events.get(0).title.isEmpty()) {
                    sb.append(": ").append(events.get(0).title);
                }
                sb.append(". ");
            }
        }
        if (news != null && !news.isEmpty()) {
            sb.append("Aus den Nachrichten: ").append(stripEnd(news.get(0).title)).append(".");
            if (news.size() > 1) {
                sb.append(" Außerdem: ");
                for (int i = 1; i < Math.min(3, news.size()); i++) {
                    if (i > 1) sb.append("; ");
                    sb.append(stripEnd(news.get(i).title));
                }
                sb.append(".");
            }
            sb.append(" ");
        }
        sb.append("Mehr dazu, wenn Sie Jarvis öffnen.");
        return sb.toString().replaceAll("\\s+", " ").replace("..", ".").trim();
    }

    // ---------- Abendzusammenfassung ----------
    /** Feste Themen-Etiketten aus js/core/briefing/evening.js – nur diese werden übernommen. */
    public static final Set<String> TOPICS = new HashSet<>(java.util.Arrays.asList(
        "Wetter", "Termine", "Nachrichten", "Timer und Wecker", "Notizen", "Anrufe und Nachrichten an Kontakte",
        "Navigation", "Musik und Videos", "Handy-Einstellungen", "Uhrzeit und Datum", "Briefing", "allgemeine Fragen"));

    public static final class DayStats {
        public final int chats, notes, timers; public final List<String> topics;
        public DayStats(int chats, List<String> topics, int notes, int timers) {
            this.chats = Math.max(0, chats); this.notes = Math.max(0, notes); this.timers = Math.max(0, timers);
            List<String> t = new ArrayList<>();
            if (topics != null) for (String s : topics) if (s != null && TOPICS.contains(s) && !t.contains(s) && t.size() < 3) t.add(s);
            this.topics = t;
        }
    }

    public static final String EVENING_OFFER = "Soll ich Ihnen einen Wecker für morgen stellen? Öffnen Sie dazu einfach Jarvis.";
    private static final String[] TIMES = {"keinmal", "einmal", "zweimal", "dreimal", "viermal", "fünfmal", "sechsmal", "siebenmal", "achtmal", "neunmal", "zehnmal", "elfmal", "zwölfmal"};

    private static String joinDe(List<String> l) {
        if (l.isEmpty()) return "";
        if (l.size() == 1) return l.get(0);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < l.size() - 1; i++) { if (i > 0) sb.append(", "); sb.append(l.get(i)); }
        return sb.append(" und ").append(l.get(l.size() - 1)).toString();
    }

    /**
     * Kurzer Tagesrückblick für Benachrichtigung und Vorlesen (ohne KI).
     * stats=null: keine Zahlen von der App; tomorrow/events/news=null: nicht verfügbar/aus.
     * titles=false: Termine nur mit Anzahl und erster Uhrzeit.
     */
    public static String composeEvening(long nowMs, TimeZone tz, DayStats stats, Weather tomorrow, List<Event> events,
                                        List<NewsItem> news, boolean titles) {
        StringBuilder sb = new StringBuilder("Guten Abend. ");
        if (stats != null) {
            if (stats.chats == 0) sb.append("Heute haben wir noch nicht miteinander gesprochen. ");
            else {
                sb.append("Heute haben Sie mich ").append(stats.chats < TIMES.length ? TIMES[stats.chats] : stats.chats + "-mal").append(" gefragt");
                if (!stats.topics.isEmpty()) sb.append(", vor allem zu ").append(joinDe(stats.topics));
                sb.append(". ");
            }
            List<String> extra = new ArrayList<>();
            if (stats.notes > 0) extra.add(stats.notes == 1 ? "eine neue Notiz" : (stats.notes < NUM.length ? NUM[stats.notes] : String.valueOf(stats.notes)) + " neue Notizen");
            if (stats.timers > 0) extra.add(stats.timers == 1 ? "ein abgelaufener Timer" : (stats.timers < NUM.length ? NUM[stats.timers] : String.valueOf(stats.timers)) + " abgelaufene Timer");
            if (!extra.isEmpty()) {
                boolean single = extra.size() == 1 && (stats.notes == 1 || stats.timers == 1);
                sb.append(single ? "Dazu kommt " : "Dazu kommen ").append(joinDe(extra)).append(". ");
            }
        }
        if (events != null) {
            if (events.isEmpty()) sb.append("Morgen stehen keine Termine im Kalender. ");
            else {
                Event first = null;
                for (Event e : events) if (!e.allDay) { first = e; break; }
                int n = events.size();
                sb.append("Morgen haben Sie ").append(n == 1 ? "einen Termin" : (n < NUM.length ? NUM[n] : String.valueOf(n)) + " Termine");
                if (first != null) {
                    sb.append(n == 1 ? ", um " : ", den ersten um ").append(clock(first.begin, tz)).append(" Uhr");
                    if (titles && !first.title.isEmpty()) sb.append(": ").append(first.title);
                } else if (titles && !events.get(0).title.isEmpty()) {
                    sb.append(": ").append(events.get(0).title);
                }
                sb.append(". ");
            }
        }
        if (tomorrow != null) sb.append(weatherSentence(tomorrow, "Morgen")).append(" ");
        if (news != null && !news.isEmpty()) sb.append("Aus den Nachrichten des Tages: ").append(stripEnd(news.get(0).title)).append(". ");
        sb.append(EVENING_OFFER);
        return sb.toString().replaceAll("\\s+", " ").replace("..", ".").trim();
    }

    // ---------- Wochenrückblick (v0.9.3) ----------
    public static final class WeekStats {
        public final int chats, activeDays, notes, memories, remindersDone, timers, nextReminders; public final List<String> topics;
        public WeekStats(int chats, int activeDays, List<String> topics, int notes, int memories, int remindersDone, int timers, int nextReminders) {
            this.chats = Math.max(0, chats); this.activeDays = Math.max(0, Math.min(7, activeDays)); this.notes = Math.max(0, notes);
            this.memories = Math.max(0, memories); this.remindersDone = Math.max(0, remindersDone); this.timers = Math.max(0, timers);
            this.nextReminders = Math.max(0, nextReminders);
            List<String> t = new ArrayList<>();
            if (topics != null) for (String s : topics) if (s != null && TOPICS.contains(s) && !t.contains(s) && t.size() < 3) t.add(s);
            this.topics = t;
        }
    }

    public static final String WEEKLY_OFFER = "Soll ich Ihnen für die neue Woche eine Erinnerung stellen oder mir etwas merken? Öffnen Sie dazu einfach Jarvis.";
    private static final String[] NUM_N = {"keine", "eine", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"};
    private static String nf(int n) { return n < NUM_N.length ? NUM_N[n] : String.valueOf(n); }
    private static String nm(int n) { return n < NUM.length ? NUM[n] : String.valueOf(n); }

    /**
     * Kurzer Wochenrückblick für Benachrichtigung und Vorlesen (ohne KI, ohne Netz).
     * stats=null: keine Zahlen von der App; events=null: Kalender nicht verfügbar/aus (nächste 7 Tage ab morgen).
     * titles=false: Termine nur mit Anzahl und erstem Termin (Wochentag + Uhrzeit).
     */
    public static String composeWeekly(long nowMs, TimeZone tz, WeekStats stats, List<Event> events, boolean titles) {
        StringBuilder sb = new StringBuilder("Guten Abend, hier ist Ihr Wochenrückblick. ");
        if (stats != null) {
            if (stats.chats == 0) sb.append("Diese Woche haben wir nicht miteinander gesprochen. ");
            else {
                sb.append("Diese Woche haben Sie mich ").append(stats.chats < TIMES.length ? TIMES[stats.chats] : stats.chats + "-mal").append(" gefragt");
                if (stats.activeDays > 1) sb.append(", an ").append(nf(stats.activeDays)).append(" Tagen");
                if (!stats.topics.isEmpty()) sb.append(", vor allem zu ").append(joinDe(stats.topics));
                sb.append(". ");
            }
            List<String> extra = new ArrayList<>();
            if (stats.notes > 0) extra.add(stats.notes == 1 ? "eine neue Notiz" : nm(stats.notes) + " neue Notizen");
            if (stats.memories > 0) extra.add(stats.memories == 1 ? "ein neu gemerkter Eintrag" : nm(stats.memories) + " neu gemerkte Einträge");
            if (stats.remindersDone > 0) extra.add(stats.remindersDone == 1 ? "eine erledigte Erinnerung" : nm(stats.remindersDone) + " erledigte Erinnerungen");
            if (stats.timers > 0) extra.add(stats.timers == 1 ? "ein abgelaufener Timer" : nm(stats.timers) + " abgelaufene Timer");
            if (!extra.isEmpty()) sb.append("Höhepunkte: ").append(joinDe(extra)).append(". ");
        }
        sb.append(weekAheadSentence(tz, events, titles));
        if (stats != null && stats.nextReminders > 0) {
            sb.append(stats.nextReminders == 1 ? "Außerdem ist eine Erinnerung geplant. " : "Außerdem sind " + nm(stats.nextReminders) + " Erinnerungen geplant. ");
        }
        sb.append(WEEKLY_OFFER);
        return sb.toString().replaceAll("\\s+", " ").replace("..", ".").trim();
    }

    /** „In der neuen Woche haben Sie fünf Termine, den ersten am Montag um 9:00 Uhr.“ (events=null → leer). */
    public static String weekAheadSentence(TimeZone tz, List<Event> events, boolean titles) {
        if (events == null) return "";
        if (events.isEmpty()) return "In der neuen Woche stehen keine Termine im Kalender. ";
        int n = events.size();
        Event first = events.get(0);
        SimpleDateFormat wd = new SimpleDateFormat("EEEE", Locale.GERMANY);
        wd.setTimeZone(first.allDay ? TimeZone.getTimeZone("UTC") : tz);
        StringBuilder sb = new StringBuilder("In der neuen Woche haben Sie ").append(n == 1 ? "einen Termin" : nm(n) + " Termine");
        sb.append(n == 1 ? ", am " : ", den ersten am ").append(wd.format(new Date(first.begin)));
        if (!first.allDay) sb.append(" um ").append(clock(first.begin, tz)).append(" Uhr");
        if (titles && !first.title.isEmpty()) sb.append(": ").append(first.title);
        return sb.append(". ").toString();
    }

    private static String stripEnd(String t) { return t.replaceAll("[.!?…]+$", ""); }
}
