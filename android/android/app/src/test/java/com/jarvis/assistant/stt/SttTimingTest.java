package com.jarvis.assistant.stt;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SttTimingTest {
    @Test
    public void defaultsFromJsArePassedThrough() {
        assertEquals(1200, SttTiming.silenceMs(1200));
        assertEquals(900, SttTiming.possiblySilenceMs(900, 1200));
    }

    @Test
    public void invalidOrMissingMeansRecognizerDefault() {
        assertEquals(0, SttTiming.silenceMs(0));
        assertEquals(0, SttTiming.silenceMs(-5));
        assertEquals(0, SttTiming.possiblySilenceMs(0, 1200));
    }

    @Test
    public void clampedAgainstCutOffsAndLongOpenMic() {
        assertEquals(SttTiming.MIN_SILENCE_MS, SttTiming.silenceMs(100));
        assertEquals(SttTiming.MAX_SILENCE_MS, SttTiming.silenceMs(60000));
        assertEquals(1000, SttTiming.possiblySilenceMs(2500, 1000)); // nie länger als „sicher fertig“
    }
}
