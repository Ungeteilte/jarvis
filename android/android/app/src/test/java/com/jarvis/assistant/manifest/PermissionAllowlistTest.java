package com.jarvis.assistant.manifest;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

/**
 * v0.9: Berechtigungen nur nach Liste. Geprüft werden das eigene Manifest und das zusammengeführte
 * (inkl. Bibliotheken) – genau wie später die APK im Release-Skript (aapt dump permissions).
 */
public class PermissionAllowlistTest {
    private static final String NS = "http://schemas.android.com/apk/res/android";
    private static final String[] FORBIDDEN = {
        "android.permission.QUERY_ALL_PACKAGES", "android.permission.MANAGE_EXTERNAL_STORAGE",
        "android.permission.SEND_SMS", "android.permission.CALL_PHONE", "android.permission.READ_CONTACTS",
        "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", "android.permission.READ_SMS",
        "android.permission.WRITE_CALENDAR", "android.permission.SYSTEM_ALERT_WINDOW"
    };

    private static TreeSet<String> allowlist() throws Exception {
        TreeSet<String> s = new TreeSet<>();
        InputStream in = PermissionAllowlistTest.class.getClassLoader().getResourceAsStream("permissions-allowlist.txt");
        assertNotNull("permissions-allowlist.txt fehlt", in);
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty() && !line.startsWith("#")) s.add(line);
            }
        }
        return s;
    }

    private static Document parse(File f) throws Exception {
        DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
        dbf.setNamespaceAware(true);
        return dbf.newDocumentBuilder().parse(f);
    }

    private static TreeSet<String> usesPermissions(Document d) {
        TreeSet<String> s = new TreeSet<>();
        for (String tag : new String[] {"uses-permission", "uses-permission-sdk-23"}) {
            NodeList l = d.getElementsByTagName(tag);
            for (int i = 0; i < l.getLength(); i++) s.add(((Element) l.item(i)).getAttributeNS(NS, "name"));
        }
        return s;
    }

    /**
     * Zusammengeführtes Debug-Manifest aus dem Gradle-Build. testDebugUnitTest hält genau dieses aktuell;
     * ein älteres Release-Zwischenergebnis könnte veraltet sein – die Release-APK prüft das Release-Skript (aapt).
     */
    private static List<File> mergedManifests() {
        List<File> out = new ArrayList<>();
        File root = new File("build/intermediates");
        collect(root, out, 0);
        return out;
    }

    private static void collect(File dir, List<File> out, int depth) {
        File[] kids = dir.listFiles();
        if (kids == null || depth > 6) return;
        for (File k : kids) {
            if (k.isDirectory()) collect(k, out, depth + 1);
            else if (k.getName().equals("AndroidManifest.xml") && k.getPath().contains("merged_manifest" + File.separator + "debug" + File.separator)) out.add(k);
        }
    }

    @Test
    public void sourceManifestOnlyAllowed() throws Exception {
        TreeSet<String> allowed = allowlist();
        TreeSet<String> used = usesPermissions(parse(new File("src/main/AndroidManifest.xml")));
        for (String p : used) assertTrue("Nicht erlaubte Berechtigung im Manifest: " + p, allowed.contains(p));
        for (String p : FORBIDDEN) assertFalse("Verboten: " + p, used.contains(p));
    }

    @Test
    public void mergedManifestExactlyAllowlist() throws Exception {
        List<File> merged = mergedManifests();
        if (merged.isEmpty()) fail("Kein zusammengeführtes Manifest unter build/intermediates gefunden");
        TreeSet<String> allowed = allowlist();
        for (File f : merged) {
            TreeSet<String> used = usesPermissions(parse(f));
            for (String p : FORBIDDEN) assertFalse("Verboten (" + f + "): " + p, used.contains(p));
            assertEquals("Berechtigungen weichen von permissions-allowlist.txt ab (" + f + ")", allowed, used);
        }
    }

    @Test
    public void noNotificationListenerAndSafeListenEntryPoints() throws Exception {
        for (File f : mergedManifests()) {
            Document d = parse(f);
            NodeList actions = d.getElementsByTagName("action");
            for (int i = 0; i < actions.getLength(); i++) {
                String a = ((Element) actions.item(i)).getAttributeNS(NS, "name");
                assertFalse("Kein NotificationListener in v0.9", "android.service.notification.NotificationListenerService".equals(a));
            }
            NodeList services = d.getElementsByTagName("service");
            boolean tile = false;
            for (int i = 0; i < services.getLength(); i++) {
                Element s = (Element) services.item(i);
                String perm = s.getAttributeNS(NS, "permission");
                assertFalse("Kein NotificationListener in v0.9", "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE".equals(perm));
                if (s.getAttributeNS(NS, "name").endsWith(".listen.ListenTileService")) {
                    tile = true;
                    assertEquals("Kachel nur für das System", "android.permission.BIND_QUICK_SETTINGS_TILE", perm);
                }
            }
            assertTrue("Kachel „Jarvis fragen“ fehlt", tile);
            // jarvis://zuhoeren bewusst ohne BROWSABLE (Webseiten sollen es nicht auslösen)
            NodeList data = d.getElementsByTagName("data");
            for (int i = 0; i < data.getLength(); i++) {
                Element e = (Element) data.item(i);
                if (!"jarvis".equals(e.getAttributeNS(NS, "scheme"))) continue;
                Element filter = (Element) e.getParentNode();
                NodeList cats = filter.getElementsByTagName("category");
                for (int j = 0; j < cats.getLength(); j++) {
                    assertFalse("jarvis:// darf nicht BROWSABLE sein",
                        "android.intent.category.BROWSABLE".equals(((Element) cats.item(j)).getAttributeNS(NS, "name")));
                }
            }
        }
    }
}
