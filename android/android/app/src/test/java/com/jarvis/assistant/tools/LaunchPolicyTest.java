package com.jarvis.assistant.tools;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class LaunchPolicyTest {
    private static final List<String> LIST = Arrays.asList("com.instagram.android", "com.samsung.android.app.notes");
    private static final String OWN = "com.jarvis.assistant";

    @Test
    public void onlyPackagesFromLauncherList() {
        assertNull(LaunchPolicy.check("com.instagram.android", LIST, OWN));
        // Systemdienst ohne Launcher-Eintrag / nicht installiert
        assertNotNull(LaunchPolicy.check("com.android.systemui", LIST, OWN));
        assertNotNull(LaunchPolicy.check("com.instagram.android", null, OWN));
    }

    @Test
    public void emptyOrInvalidRejected() {
        assertEquals("Welche App soll ich öffnen? Es fehlt der Name.", LaunchPolicy.check("", LIST, OWN));
        assertNotNull(LaunchPolicy.check(null, LIST, OWN));
        assertNotNull(LaunchPolicy.check("   ", LIST, OWN));
        assertNotNull(LaunchPolicy.check("Instagram", LIST, OWN)); // Anzeigename statt Paket → nie Text-Suche
        assertFalse(LaunchPolicy.isValidPackageName("com..x"));
        assertFalse(LaunchPolicy.isValidPackageName("1com.x"));
        assertFalse(LaunchPolicy.isValidPackageName("com.x;rm"));
        assertTrue(LaunchPolicy.isValidPackageName("com.sec.android.app.popupcalculator"));
    }

    @Test
    public void neverJarvisItself() {
        assertNotNull(LaunchPolicy.check(OWN, Arrays.asList(OWN), OWN));
    }

    @Test
    public void messagesHaveNoParentheses() {
        for (String m : new String[] { LaunchPolicy.check("", LIST, OWN), LaunchPolicy.check("a.b", LIST, OWN), LaunchPolicy.check("x", LIST, OWN) }) {
            assertFalse(m, m.contains("(") || m.contains(")"));
        }
    }
}
