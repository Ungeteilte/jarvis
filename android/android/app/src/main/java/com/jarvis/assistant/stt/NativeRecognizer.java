package com.jarvis.assistant.stt;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import androidx.core.content.ContextCompat;

import java.util.ArrayList;

/**
 * Die EINE Spracherkennung der App. Alle Aufrufe laufen auf dem Haupt-Thread; ein neuer Start
 * bricht die vorige Erkennung ab und zerstört sie (kein Überlappen, keine zwei Mikrofon-Nutzer).
 * Rückmeldungen tragen die Sitzungskennung aus der App – Meldungen alter Sitzungen werden
 * verworfen. Pro Segment: ready → partial* → final | error(kind). Neustarts plant die App
 * (js/core/listen-loop.js) mit Pausen und Wartezeiten.
 */
public final class NativeRecognizer {
    public interface Sink { void event(String session, String type, String text, int code, String kind); }

    private static final long UNMUTE_AFTER_READY_MS = 600;
    private static final long UNMUTE_FALLBACK_MS = 1500;

    private final Context ctx;
    private final Sink sink;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private String session;            // nur auf dem Haupt-Thread lesen/schreiben
    private final Runnable unmute;

    public NativeRecognizer(Context ctx, Sink sink) {
        this.ctx = ctx.getApplicationContext();
        this.sink = sink;
        this.unmute = () -> BeepMuter.restore(this.ctx);
    }

    public boolean hasPermission() {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    public boolean available() { return SpeechRecognizer.isRecognitionAvailable(ctx); }

    /** Startet ein Segment (ersetzt ein laufendes). */
    public void start(String id, String language, boolean partial, boolean muteBeep) {
        start(id, language, partial, muteBeep, 0, 0);
    }

    /** v0.9.6: mit Satzende-Hinweisen (ms; 0 = Standard des Erkenners), siehe SttTiming. */
    public void start(String id, String language, boolean partial, boolean muteBeep, int completeSilenceMs, int possiblySilenceMs) {
        final int complete = SttTiming.silenceMs(completeSilenceMs);
        final int possibly = SttTiming.possiblySilenceMs(possiblySilenceMs, completeSilenceMs);
        main.post(() -> {
            destroyCurrent();
            session = id;
            try {
                rec = SpeechRecognizer.createSpeechRecognizer(ctx);
                rec.setRecognitionListener(new Listener(id));
                Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
                i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
                i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial);
                i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
                if (complete > 0) i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, (long) complete);
                if (possibly > 0) i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, (long) possibly);
                if (muteBeep) {
                    BeepMuter.mute(ctx);
                    main.postDelayed(unmute, UNMUTE_FALLBACK_MS);
                }
                rec.startListening(i);
            } catch (Exception e) {
                destroyCurrent();
                sink.event(id, "error", null, 5, SttErrors.RETRY);
            }
        });
    }

    /** Laufende Erkennung abbrechen (ohne Ergebnis) und freigeben. */
    public void cancel() { main.post(this::destroyCurrent); }

    private void destroyCurrent() {
        main.removeCallbacks(unmute);
        session = null;
        if (rec != null) {
            try { rec.cancel(); } catch (Exception ignored) {}
            try { rec.destroy(); } catch (Exception ignored) {}
            rec = null;
        }
        BeepMuter.restore(ctx);
    }

    private final class Listener implements RecognitionListener {
        private final String id;
        private String lastPartial = "";
        Listener(String id) { this.id = id; }
        private boolean current() { return id.equals(session); }

        @Override public void onReadyForSpeech(Bundle params) {
            if (!current()) return;
            main.removeCallbacks(unmute);
            if (BeepMuter.isMuting(ctx)) main.postDelayed(unmute, UNMUTE_AFTER_READY_MS);
            sink.event(id, "ready", null, 0, null);
        }
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int eventType, Bundle params) {}

        @Override public void onPartialResults(Bundle b) {
            if (!current()) return;
            String t = first(b);
            if (t != null && !t.isEmpty() && !t.equals(lastPartial)) { lastPartial = t; sink.event(id, "partial", t, 0, null); }
        }

        @Override public void onResults(Bundle b) {
            if (!current()) return;
            String t = first(b);
            destroyCurrent();
            sink.event(id, "final", t == null || t.isEmpty() ? lastPartial : t, 0, null);
        }

        @Override public void onError(int error) {
            if (!current()) return;
            destroyCurrent();
            // Manche Geräte melden NO_MATCH, obwohl schon Teilergebnisse kamen → als Satz werten
            if (SttErrors.SILENCE.equals(SttErrors.classify(error)) && !lastPartial.isEmpty()) {
                sink.event(id, "final", lastPartial, 0, null);
                return;
            }
            sink.event(id, "error", SttErrors.name(error), error, SttErrors.classify(error));
        }
    }

    private static String first(Bundle b) {
        if (b == null) return null;
        ArrayList<String> m = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return m == null || m.isEmpty() ? null : m.get(0);
    }
}
