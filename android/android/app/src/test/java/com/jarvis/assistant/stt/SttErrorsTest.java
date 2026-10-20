package com.jarvis.assistant.stt;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.speech.SpeechRecognizer;

import org.junit.Test;

public class SttErrorsTest {
    @Test
    public void classifiesRecognizerErrors() {
        assertEquals(SttErrors.SILENCE, SttErrors.classify(SpeechRecognizer.ERROR_NO_MATCH));
        assertEquals(SttErrors.SILENCE, SttErrors.classify(SpeechRecognizer.ERROR_SPEECH_TIMEOUT));
        assertEquals(SttErrors.BUSY, SttErrors.classify(SpeechRecognizer.ERROR_RECOGNIZER_BUSY));
        assertEquals(SttErrors.FATAL, SttErrors.classify(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS));
        assertEquals(SttErrors.FATAL, SttErrors.classify(12));
        assertEquals(SttErrors.FATAL, SttErrors.classify(13));
        for (int c : new int[]{SpeechRecognizer.ERROR_CLIENT, SpeechRecognizer.ERROR_AUDIO, SpeechRecognizer.ERROR_NETWORK,
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER, 10, 11, 99}) {
            assertEquals("code " + c, SttErrors.RETRY, SttErrors.classify(c));
        }
        assertEquals("no-match", SttErrors.name(7));
        assertEquals("error-99", SttErrors.name(99));
    }

    @Test
    public void muteNeverTouchesPlayingMusicOrSilentStreams() {
        assertTrue(SttErrors.shouldMuteStream(false, true, false, 5));   // System-Ton: ja
        assertTrue(SttErrors.shouldMuteStream(true, false, false, 5));   // Medien, nichts läuft: ja
        assertFalse(SttErrors.shouldMuteStream(true, true, false, 5));   // Musik läuft: nie
        assertFalse(SttErrors.shouldMuteStream(false, false, true, 5));  // schon stumm: nicht anfassen
        assertFalse(SttErrors.shouldMuteStream(false, false, false, 0)); // Lautstärke 0: nicht anfassen
    }
}
