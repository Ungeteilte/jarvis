package com.jarvis.assistant.briefing;

import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import org.json.JSONObject;

import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Lautes Vorlesen im Hintergrund – nur wenn es passt: kein Anruf, Klingelton „Normal“,
 * „Nicht stören“ aus, Medienlautstärke > 0, Audio-Fokus erhalten. Lautstärke wird nie verändert.
 * Lautsprecher, Kopfhörer, Bluetooth und Auto sind erlaubt (Wunsch des Nutzers).
 */
public final class BriefingSpeaker {
    private BriefingSpeaker() {}

    /** Gründe gegen das Vorlesen (null = darf). */
    public static String blockReason(Context c) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return "audio";
        if (am.getMode() != AudioManager.MODE_NORMAL) return "call";
        if (am.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) return "silent";
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL
            && nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_UNKNOWN) return "dnd";
        if (am.getStreamVolume(AudioManager.STREAM_MUSIC) <= 0) return "muted";
        return null;
    }

    /** Spricht blockierend (max. 90 s). true = vorgelesen. Auf einem Hintergrund-Thread aufrufen. */
    public static boolean speak(Context c, String text) {
        if (blockReason(c) != null) return false;
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        AudioFocusRequest req = null;
        int focus;
        AudioManager.OnAudioFocusChangeListener fl = ch -> {};
        if (Build.VERSION.SDK_INT >= 26) {
            req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attrs).setOnAudioFocusChangeListener(fl).build();
            focus = am.requestAudioFocus(req);
        } else {
            focus = am.requestAudioFocus(fl, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
        if (focus != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return false;
        CountDownLatch ready = new CountDownLatch(1);
        final boolean[] ok = {false};
        TextToSpeech[] holder = new TextToSpeech[1];
        try {
            holder[0] = new TextToSpeech(c.getApplicationContext(), st -> { ok[0] = st == TextToSpeech.SUCCESS; ready.countDown(); });
            if (!ready.await(8, TimeUnit.SECONDS) || !ok[0]) return false;
            TextToSpeech tts = holder[0];
            tts.setAudioAttributes(attrs);
            tts.setLanguage(Locale.GERMANY);
            JSONObject voice = BriefingState.sync(c).optJSONObject("voice");
            if (voice != null) {
                String id = voice.optString("voiceId", "");
                if (!id.isEmpty() && tts.getVoices() != null) for (Voice v : tts.getVoices()) if (id.equals(v.getName())) { tts.setVoice(v); break; }
                tts.setSpeechRate((float) Math.max(0.5, Math.min(2, voice.optDouble("rate", 1))));
                tts.setPitch((float) Math.max(0.5, Math.min(2, voice.optDouble("pitch", 1))));
            }
            CountDownLatch done = new CountDownLatch(1);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) {}
                @Override public void onDone(String id) { done.countDown(); }
                @Override public void onError(String id) { done.countDown(); }
            });
            if (blockReason(c) != null) return false; // in der Zwischenzeit Anruf / lautlos?
            BackgroundSpeech.set(true); // offene App: Wake-Word pausieren
            try {
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, new Bundle(), "jarvis-briefing");
                done.await(90, TimeUnit.SECONDS);
            } finally {
                BackgroundSpeech.set(false);
            }
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (holder[0] != null) { try { holder[0].stop(); holder[0].shutdown(); } catch (Exception ignored) {} }
            if (Build.VERSION.SDK_INT >= 26 && req != null) am.abandonAudioFocusRequest(req); else am.abandonAudioFocus(fl);
        }
    }
}
