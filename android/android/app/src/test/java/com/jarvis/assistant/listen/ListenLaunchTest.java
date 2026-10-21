package com.jarvis.assistant.listen;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.junit.Test;

public class ListenLaunchTest {
    private static final Set<String> LAUNCHER = new HashSet<>(Collections.singletonList(ListenLaunch.CATEGORY_LAUNCHER));

    @Test
    public void listenTriggers() {
        assertEquals(ListenLaunch.Kind.LISTEN, ListenLaunch.classify(ListenLaunch.ACTION_LISTEN, null, null, false, null));
        assertEquals(ListenLaunch.Kind.LISTEN, ListenLaunch.classify(ListenLaunch.ACTION_VIEW, "jarvis", "zuhoeren", false, null));
        assertEquals(ListenLaunch.Kind.LISTEN, ListenLaunch.classify(ListenLaunch.ACTION_MAIN, null, null, true, LAUNCHER));
        assertEquals(ListenLaunch.Kind.NONE, ListenLaunch.classify(ListenLaunch.ACTION_VIEW, "jarvis", "andereshost", false, null));
        assertEquals(ListenLaunch.Kind.NONE, ListenLaunch.classify(ListenLaunch.ACTION_VIEW, "https", "zuhoeren", false, null));
    }

    @Test
    public void normalStartIsOpenedNotListen() {
        assertEquals(ListenLaunch.Kind.OPENED, ListenLaunch.classify(ListenLaunch.ACTION_MAIN, null, null, false, LAUNCHER));
        assertEquals(ListenLaunch.Kind.NONE, ListenLaunch.classify(ListenLaunch.ACTION_MAIN, null, null, false, null));
        assertEquals(ListenLaunch.Kind.NONE, ListenLaunch.classify("com.jarvis.assistant.action.MORNING_BRIEFING", null, null, false, null));
    }

    @Test
    public void consumeOnce() {
        ListenLaunch.consume();
        ListenLaunch.record(ListenLaunch.Kind.LISTEN);
        assertArrayEquals(new boolean[] {true, false}, ListenLaunch.consume());
        assertArrayEquals(new boolean[] {false, false}, ListenLaunch.consume());
        ListenLaunch.record(ListenLaunch.Kind.OPENED);
        assertArrayEquals(new boolean[] {false, true}, ListenLaunch.consume());
    }
}
