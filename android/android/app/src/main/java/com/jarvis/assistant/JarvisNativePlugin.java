package com.jarvis.assistant;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.BatteryManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.AlarmClock;
import android.provider.Settings;
import android.util.Log;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import androidx.activity.result.ActivityResult;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.jarvis.assistant.listen.ListenLaunch;
import com.jarvis.assistant.tools.CalendarDraftSpec;
import com.jarvis.assistant.tools.DeviceStatusMapper;
import com.jarvis.assistant.tools.FileLimits;
import com.jarvis.assistant.tools.LaunchPolicy;
import com.jarvis.assistant.tools.MediaControl;
import com.jarvis.assistant.updater.UpdateEngine;
import com.jarvis.assistant.updater.UpdateEvents;
import com.jarvis.assistant.updater.UpdateInstaller;
import com.jarvis.assistant.updater.UpdateNotifier;
import com.jarvis.assistant.updater.UpdateScheduler;
import com.jarvis.assistant.updater.UpdateState;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.jarvis.assistant.briefing.BackgroundSpeech;
import com.jarvis.assistant.briefing.BriefingLaunch;
import com.jarvis.assistant.alarm.AlarmSpec;
import com.jarvis.assistant.stt.BeepMuter;
import com.jarvis.assistant.stt.NativeRecognizer;
import com.jarvis.assistant.briefing.BriefingNotifier;
import com.jarvis.assistant.briefing.BriefingScheduler;
import com.jarvis.assistant.briefing.BriefingService;
import com.jarvis.assistant.briefing.BriefingState;
import com.jarvis.assistant.briefing.CalendarReader;
import android.os.PowerManager;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "JarvisNative",
    permissions = { @Permission(alias = "calendar", strings = { android.Manifest.permission.READ_CALENDAR }) }
)
public class JarvisNativePlugin extends Plugin {
    private TextToSpeech tts;
    private final AtomicBoolean ttsReady = new AtomicBoolean(false);
    private String torchCameraId = null;
    private SharedPreferences securePrefs;
    private UpdateEvents.Listener updateListener;
    private NativeRecognizer recognizer;
    /** Offene speak-Aufrufe nach Äußerungs-ID – speak blockiert den gemeinsamen Plugin-Thread nicht mehr. */
    private final ConcurrentHashMap<String, PluginCall> pendingSpeak = new ConcurrentHashMap<>();
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override
    public void load() {
        Context ctx = getContext();
        try {
            String masterKey = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            securePrefs = EncryptedSharedPreferences.create(
                "jarvis_secure",
                masterKey,
                ctx,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            securePrefs = ctx.getSharedPreferences("jarvis_secure_fallback", Context.MODE_PRIVATE);
        }

        cleanupShareCache(); // v0.9 W2: übrig gebliebene Teilen-Dateien entfernen
        updateListener = st -> {
            try { notifyListeners("updateStatus", JSObject.fromJSONObject(st)); } catch (Exception ignored) {}
        };
        UpdateEvents.add(updateListener);
        BriefingLaunch.setListener(() -> {
            try { notifyListeners("briefingLaunch", new JSObject()); } catch (Exception ignored) {}
        });
        ListenLaunch.setListener((listen) -> {
            JSObject o = new JSObject();
            o.put("listen", listen);
            try { notifyListeners("listenLaunch", o); } catch (Exception ignored) {}
        });

        // Spracherkennung: eine Instanz, Haupt-Thread, Ereignisse mit Sitzungskennung
        BeepMuter.restoreLeftovers(ctx);
        recognizer = new NativeRecognizer(ctx, (session, type, text, code, kind) -> {
            JSObject o = new JSObject();
            o.put("session", session);
            o.put("type", type);
            if (text != null) o.put("text", text);
            if (code != 0) o.put("code", code);
            if (kind != null) o.put("kind", kind);
            try { notifyListeners("sttEvent", o); } catch (Exception ignored) {}
        });
        BackgroundSpeech.setListener(speaking -> {
            JSObject o = new JSObject();
            o.put("speaking", speaking);
            try { notifyListeners("backgroundSpeech", o); } catch (Exception ignored) {}
        });

        tts = new TextToSpeech(ctx, status -> {
            ttsReady.set(status == TextToSpeech.SUCCESS);
            if (ttsReady.get()) {
                tts.setLanguage(Locale.GERMANY);
                // Ein Zuhörer für alle Äußerungen: löst den passenden speak-Aufruf auf.
                // stop()/QUEUE_FLUSH melden nur onStop – auch das beendet den Aufruf.
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) {}
                    @Override public void onDone(String utteranceId) { finishSpeak(utteranceId); }
                    @Override public void onError(String utteranceId) { finishSpeak(utteranceId); }
                    @Override public void onError(String utteranceId, int errorCode) { finishSpeak(utteranceId); }
                    @Override public void onStop(String utteranceId, boolean interrupted) { finishSpeak(utteranceId); }
                });
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (updateListener != null) UpdateEvents.remove(updateListener);
        BriefingLaunch.setListener(null);
        BackgroundSpeech.setListener(null);
        if (recognizer != null) recognizer.cancel();
        resolveAllSpeak();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        try { setTorchInternal(false); } catch (Exception ignored) {}
        super.handleOnDestroy();
    }

    // ---------- Secure storage ----------
    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key", "");
        JSObject ret = new JSObject();
        ret.put("value", securePrefs.contains(key) ? securePrefs.getString(key, null) : null);
        call.resolve(ret);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        securePrefs.edit().putString(key, value).apply();
        call.resolve();
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key", "");
        securePrefs.edit().remove(key).apply();
        call.resolve();
    }

    // ---------- TTS ----------
    @PluginMethod
    public void listVoices(PluginCall call) {
        if (!awaitTts()) {
            call.reject("Text-to-Speech nicht bereit");
            return;
        }
        JSArray arr = new JSArray();
        Set<Voice> voices = tts.getVoices();
        if (voices != null) {
            List<Voice> sorted = new ArrayList<>(voices);
            sorted.sort((a, b) -> {
                boolean ad = a.getLocale().getLanguage().equals("de");
                boolean bd = b.getLocale().getLanguage().equals("de");
                if (ad != bd) return ad ? -1 : 1;
                return a.getName().compareToIgnoreCase(b.getName());
            });
            for (Voice v : sorted) {
                JSObject o = new JSObject();
                o.put("id", v.getName());
                o.put("name", v.getName());
                o.put("lang", v.getLocale().toLanguageTag());
                o.put("default", false);
                arr.put(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("voices", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        if (!awaitTts()) {
            call.reject("Text-to-Speech nicht bereit");
            return;
        }
        String text = call.getString("text", "");
        String lang = call.getString("lang", "de-DE");
        String voiceId = call.getString("voiceId", "");
        float rate = call.getFloat("rate", 1f);
        float pitch = call.getFloat("pitch", 1f);
        if (text.isEmpty()) {
            call.resolve();
            return;
        }
        try {
            Locale loc = Locale.forLanguageTag(lang.replace('_', '-'));
            tts.setLanguage(loc);
            if (voiceId != null && !voiceId.isEmpty() && tts.getVoices() != null) {
                for (Voice v : tts.getVoices()) {
                    if (voiceId.equals(v.getName())) {
                        tts.setVoice(v);
                        break;
                    }
                }
            }
            tts.setSpeechRate(Math.max(0.5f, Math.min(2f, rate)));
            tts.setPitch(Math.max(0.5f, Math.min(2f, pitch)));
            // Nicht mehr blockieren: Früher wartete speak hier (Latch) und hielt den GEMEINSAMEN
            // Plugin-Thread fest – alle anderen Plugin-Aufrufe (z. B. Spracherkennung) stauten sich
            // und kamen danach gebündelt an. Jetzt löst der Äußerungs-Zuhörer den Aufruf auf.
            String id = UUID.randomUUID().toString();
            call.setKeepAlive(true);
            pendingSpeak.put(id, call);
            mainHandler.postDelayed(() -> finishSpeak(id), 120000); // Sicherheitsnetz
            int r = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
            if (r != TextToSpeech.SUCCESS) finishSpeak(id);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void finishSpeak(String id) {
        PluginCall c = id == null ? null : pendingSpeak.remove(id);
        if (c == null) return;
        c.setKeepAlive(false);
        try { c.resolve(); } catch (Exception ignored) {}
        try { bridge.releaseCall(c); } catch (Exception ignored) {}
    }

    private void resolveAllSpeak() {
        for (String id : new ArrayList<>(pendingSpeak.keySet())) finishSpeak(id);
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        resolveAllSpeak(); // falls die Engine kein onStop meldet
        call.resolve();
    }

    // ---------- Spracherkennung (eine Instanz, siehe stt/NativeRecognizer) ----------
    @PluginMethod
    public void sttStart(PluginCall call) {
        String session = call.getString("session", "");
        if (session == null || session.isEmpty() || session.length() > 64) { call.reject("session fehlt"); return; }
        if (!recognizer.available()) { call.reject("unavailable"); return; }
        if (!recognizer.hasPermission()) { call.reject("not-allowed"); return; }
        boolean partial = !Boolean.FALSE.equals(call.getBoolean("partial", true));
        boolean mute = Boolean.TRUE.equals(call.getBoolean("muteBeep", false)) && !BackgroundSpeech.isSpeaking();
        recognizer.start(session, call.getString("language", "de-DE"), partial, mute);
        call.resolve();
    }

    @PluginMethod
    public void sttCancel(PluginCall call) {
        if (recognizer != null) recognizer.cancel();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // App im Hintergrund: Mikrofon freigeben, Stummschaltung sicher aufheben
        if (recognizer != null) recognizer.cancel();
        super.handleOnPause();
    }

    private boolean awaitTts() {
        for (int i = 0; i < 50 && !ttsReady.get(); i++) {
            try { Thread.sleep(100); } catch (InterruptedException ignored) { return false; }
        }
        return ttsReady.get();
    }

    // ---------- Torch ----------
    @PluginMethod
    public void setTorch(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        JSObject ret = new JSObject();
        try {
            setTorchInternal(on);
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("unsupported", true);
            ret.put("message", e.getMessage());
            call.resolve(ret);
        }
    }

    private void setTorchInternal(boolean on) throws CameraAccessException {
        CameraManager cm = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        if (torchCameraId == null) {
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(flash)) {
                    torchCameraId = id;
                    break;
                }
            }
        }
        if (torchCameraId == null) throw new CameraAccessException(CameraAccessException.CAMERA_ERROR, "Keine Taschenlampe");
        cm.setTorchMode(torchCameraId, on);
    }

    // ---------- Intents / Device ----------
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (url.startsWith("tel:")) i = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void copyText(PluginCall call) {
        String text = call.getString("text", "");
        ClipboardManager cm = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("jarvis", text));
        call.resolve();
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        JSArray patternArr = call.getArray("pattern");
        long[] pattern = new long[]{0, 200};
        if (patternArr != null && patternArr.length() > 0) {
            try {
                pattern = new long[patternArr.length() + 1];
                pattern[0] = 0;
                for (int i = 0; i < patternArr.length(); i++) {
                    pattern[i + 1] = patternArr.getInt(i);
                }
            } catch (Exception ignored) {}
        }
        Vibrator vib;
        if (Build.VERSION.SDK_INT >= 31) {
            VibratorManager vm = (VibratorManager) getContext().getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            vib = vm.getDefaultVibrator();
        } else {
            vib = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vib.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } else {
            vib.vibrate(pattern, -1);
        }
        call.resolve();
    }

    @PluginMethod
    public void getBattery(PluginCall call) {
        BatteryManager bm = (BatteryManager) getContext().getSystemService(Context.BATTERY_SERVICE);
        int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        int status = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS);
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING
            || status == BatteryManager.BATTERY_STATUS_FULL;
        JSObject ret = new JSObject();
        ret.put("level", pct / 100.0);
        ret.put("charging", charging);
        call.resolve(ret);
    }

    // ---------- v0.9 W5: Medien, Lautstärke in Prozent, Gerätestatus, Kalender-Entwurf ----------

    /** Medientaste an die aktive Wiedergabe (Spotify, YouTube …). Keine Berechtigung nötig. */
    @PluginMethod
    public void mediaKey(PluginCall call) {
        JSObject ret = new JSObject();
        String action = call.getString("action", "");
        int code = MediaControl.keyCode(action);
        if (code < 0) {
            ret.put("ok", false);
            ret.put("message", "Unbekannte Medien-Aktion.");
            call.resolve(ret);
            return;
        }
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am == null) {
            ret.put("ok", false);
            ret.put("message", "Kein Zugriff auf die Wiedergabe.");
            call.resolve(ret);
            return;
        }
        if ("pause".equals(action) && !am.isMusicActive()) {
            ret.put("ok", true);
            ret.put("idle", true); // „Es läuft gerade nichts.“
            call.resolve(ret);
            return;
        }
        am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, code));
        am.dispatchMediaKeyEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP, code));
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** Medien-Lautstärke auf Prozent (mit System-Anzeige). */
    @PluginMethod
    public void setVolumePercent(PluginCall call) {
        JSObject ret = new JSObject();
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        Integer p = call.getInt("percent");
        if (am == null || p == null) {
            ret.put("ok", false);
            ret.put("message", am == null ? "Kein Zugriff auf die Lautstärke." : "Es fehlt der Prozentwert.");
            call.resolve(ret);
            return;
        }
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int idx = MediaControl.volumeIndex(p, max);
        try {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, idx, AudioManager.FLAG_SHOW_UI);
            ret.put("ok", true);
            ret.put("percent", MediaControl.percentOf(idx, max));
        } catch (SecurityException e) {
            ret.put("ok", false);
            ret.put("message", "Android erlaubt das gerade nicht, zum Beispiel wegen Nicht stören.");
        }
        call.resolve(ret);
    }

    /** Gerätestatus im festen Schema (DeviceStatusMapper); jede Abfrage einzeln abgesichert. */
    @PluginMethod
    public void getDeviceStatus(PluginCall call) {
        Context ctx = getContext();
        Boolean wifi = null, cell = null, bt = null, charging = null;
        Integer filter = null, battery = null;
        try {
            android.net.ConnectivityManager cm = (android.net.ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                android.net.NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
                wifi = nc != null && nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI);
                cell = nc != null && nc.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR);
            }
        } catch (Exception ignored) {}
        try {
            // Ab Android 12 ohne Berechtigung; davor kann es eine SecurityException geben → „unbekannt“
            android.bluetooth.BluetoothManager bm = (android.bluetooth.BluetoothManager) ctx.getSystemService(Context.BLUETOOTH_SERVICE);
            if (bm != null && bm.getAdapter() != null) bt = bm.getAdapter().isEnabled();
        } catch (Exception ignored) {}
        try {
            android.app.NotificationManager nm = (android.app.NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) filter = nm.getCurrentInterruptionFilter();
        } catch (Exception ignored) {}
        try {
            BatteryManager bmgr = (BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            if (bmgr != null) {
                int lvl = bmgr.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                battery = lvl >= 0 && lvl <= 100 ? lvl : null;
                charging = bmgr.isCharging();
            }
        } catch (Exception ignored) {}
        JSObject status = new JSObject();
        for (java.util.Map.Entry<String, Object> e : DeviceStatusMapper.map(wifi, cell, bt, filter, battery, charging).entrySet()) {
            status.put(e.getKey(), e.getValue());
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("status", status);
        call.resolve(ret);
    }

    /** Kalender-App mit Entwurf öffnen (ACTION_INSERT, keine Schreibberechtigung). */
    @PluginMethod
    public void calendarDraft(PluginCall call) {
        JSObject ret = new JSObject();
        CalendarDraftSpec spec;
        try {
            Double b = call.getDouble("begin");
            Double e = call.getDouble("end");
            spec = CalendarDraftSpec.of(call.getString("title"), b == null ? null : b.longValue(), e == null ? null : e.longValue(), call.getString("location"));
        } catch (IllegalArgumentException ex) {
            ret.put("ok", false);
            ret.put("message", ex.getMessage());
            call.resolve(ret);
            return;
        }
        Intent i = new Intent(CalendarDraftSpec.ACTION_INSERT).setData(android.provider.CalendarContract.Events.CONTENT_URI);
        for (java.util.Map.Entry<String, Object> x : spec.extras().entrySet()) {
            if (x.getValue() instanceof Long) i.putExtra(x.getKey(), (Long) x.getValue());
            else i.putExtra(x.getKey(), String.valueOf(x.getValue()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            ret.put("ok", true);
        } catch (ActivityNotFoundException ex) {
            ret.put("ok", false);
            ret.put("message", "Keine Kalender-App gefunden.");
        }
        call.resolve(ret);
    }

    // ---------- v0.9 W2: Dateien (Storage Access Framework, keine Speicher-Berechtigung) ----------

    /** Export: System-Dialog „Speichern unter“; du wählst Ort und Namen. */
    @PluginMethod
    public void saveDocument(PluginCall call) {
        String text = call.getString("text", "");
        if (text.length() > FileLimits.MAX_EXPORT_CHARS) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("message", "Das ist zu viel Text für eine Datei.");
            call.resolve(r);
            return;
        }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(FileLimits.shareMime(call.getString("mime", "")))
            .putExtra(Intent.EXTRA_TITLE, FileLimits.safeFileName(call.getString("name", "")));
        try {
            startActivityForResult(call, i, "onSaveDocument");
        } catch (ActivityNotFoundException e) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("message", "Auf diesem Gerät gibt es keinen Datei-Dialog.");
            call.resolve(r);
        }
    }

    @ActivityCallback
    private void onSaveDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (uri == null) {
            ret.put("ok", false);
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        try (java.io.OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) throw new java.io.IOException("kein Ziel");
            os.write(call.getString("text", "").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            ret.put("ok", true);
            ret.put("name", displayName(uri, call.getString("name", "")));
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("message", "Die Datei konnte nicht gespeichert werden.");
        }
        call.resolve(ret);
    }

    /** Einlesen: System-Dialog „Öffnen“; nur Text bis 256 KB, keine dauerhaften Rechte. */
    @PluginMethod
    public void openTextDocument(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, FileLimits.PICK_MIMES);
        try {
            startActivityForResult(call, i, "onOpenTextDocument");
        } catch (ActivityNotFoundException e) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("message", "Auf diesem Gerät gibt es keinen Datei-Dialog.");
            call.resolve(r);
        }
    }

    @ActivityCallback
    private void onOpenTextDocument(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Uri uri = result.getResultCode() == Activity.RESULT_OK && result.getData() != null ? result.getData().getData() : null;
        if (uri == null) {
            ret.put("ok", false);
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        android.content.ContentResolver cr = getContext().getContentResolver();
        String name = displayName(uri, "datei");
        long size = -1;
        try (android.database.Cursor c = cr.query(uri, new String[] { android.provider.OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) size = c.getLong(0);
        } catch (Exception ignored) {}
        String mime = cr.getType(uri);
        String err = FileLimits.checkMeta(name, mime, size);
        if (err == null) {
            try (java.io.InputStream in = cr.openInputStream(uri)) {
                if (in == null) throw new java.io.IOException("leer");
                byte[] buf = new byte[FileLimits.MAX_BYTES + 1];
                int len = 0;
                int n;
                while (len < buf.length && (n = in.read(buf, len, buf.length - len)) > 0) len += n;
                if (len > FileLimits.MAX_BYTES) err = "Die Datei ist zu groß. Ich lese höchstens 256 KB.";
                else if (FileLimits.looksBinary(buf, len)) err = "Das sieht nicht nach einer Textdatei aus – ich lese sie nicht.";
                else {
                    ret.put("ok", true);
                    ret.put("name", name);
                    ret.put("mime", mime == null ? "" : mime);
                    ret.put("size", len);
                    ret.put("text", new String(buf, 0, len, java.nio.charset.StandardCharsets.UTF_8));
                }
            } catch (Exception e) {
                err = "Die Datei konnte nicht gelesen werden.";
            }
        }
        if (err != null) {
            ret.put("ok", false);
            ret.put("message", err);
        }
        call.resolve(ret);
    }

    /** Teilen: Datei kurz in cache/share/, Teilen-Menü über den FileProvider; nach 10 Minuten gelöscht. */
    @PluginMethod
    public void shareTextFile(PluginCall call) {
        JSObject ret = new JSObject();
        String text = call.getString("text", "");
        String mime = FileLimits.shareMime(call.getString("mime", ""));
        String name = FileLimits.safeFileName(call.getString("name", ""));
        if (text.length() > FileLimits.MAX_EXPORT_CHARS) {
            ret.put("ok", false);
            ret.put("message", "Das ist zu viel Text für eine Datei.");
            call.resolve(ret);
            return;
        }
        try {
            cleanupShareCache();
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new java.io.IOException("kein Ordner");
            File f = new File(dir, name);
            try (java.io.FileOutputStream os = new java.io.FileOutputStream(f)) {
                os.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }
            Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND)
                .setType(mime)
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            send.setClipData(ClipData.newRawUri(name, uri));
            Intent chooser = Intent.createChooser(send, "Datei teilen");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (getActivity() != null) getActivity().startActivity(chooser);
            else getContext().startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            mainHandler.postDelayed(this::cleanupShareCache, FileLimits.CACHE_MAX_AGE_MS + 5000);
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("message", "Teilen hat nicht geklappt.");
        }
        call.resolve(ret);
    }

    /** Löscht geteilte Dateien, die älter als 10 Minuten sind (auch beim App-Start). */
    private void cleanupShareCache() {
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            for (File f : FileLimits.expired(dir.listFiles(), System.currentTimeMillis())) {
                if (!f.delete()) Log.w("JarvisFiles", "Konnte alte Teilen-Datei nicht löschen");
            }
        } catch (Exception ignored) {}
    }

    private String displayName(Uri uri, String fallback) {
        try (android.database.Cursor c = getContext().getContentResolver().query(uri, new String[] { android.provider.OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {}
        return fallback;
    }

    /** Startbare Apps (Launcher-Einträge) als {label, package}; Jarvis selbst nicht. */
    private List<JSObject> launchableApps() {
        PackageManager pm = getContext().getPackageManager();
        Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> infos = pm.queryIntentActivities(main, 0);
        List<JSObject> out = new ArrayList<>();
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        String own = getContext().getPackageName();
        for (ResolveInfo ri : infos) {
            if (ri.activityInfo == null) continue;
            String pkg = ri.activityInfo.packageName;
            if (pkg == null || pkg.equals(own) || !seen.add(pkg)) continue;
            JSObject o = new JSObject();
            o.put("label", String.valueOf(ri.loadLabel(pm)));
            o.put("package", pkg);
            out.add(o);
        }
        return out;
    }

    /**
     * v0.9 W1: Liste der startbaren Apps. Der Abgleich mit dem gesprochenen Namen passiert im JS-Kern
     * (js/core/app-match.js). Braucht kein QUERY_ALL_PACKAGES – die <queries>-Regel MAIN/LAUNCHER reicht.
     */
    @PluginMethod
    public void listLaunchableApps(PluginCall call) {
        JSObject ret = new JSObject();
        JSArray arr = new JSArray();
        for (JSObject o : launchableApps()) arr.put(o);
        ret.put("ok", true);
        ret.put("apps", arr);
        call.resolve(ret);
    }

    /** v0.9 W1: startet genau ein Paket – nur, wenn es jetzt in der Launcher-Liste steht (LaunchPolicy). */
    @PluginMethod
    public void launchPackage(PluginCall call) {
        String pkg = call.getString("package", "");
        JSObject ret = new JSObject();
        List<String> allowed = new ArrayList<>();
        for (JSObject o : launchableApps()) allowed.add(o.getString("package"));
        String err = LaunchPolicy.check(pkg, allowed, getContext().getPackageName());
        if (err != null) {
            ret.put("ok", false);
            ret.put("message", err);
            call.resolve(ret);
            return;
        }
        Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
        if (launch == null) {
            ret.put("ok", false);
            ret.put("message", "Diese App lässt sich nicht starten.");
            call.resolve(ret);
            return;
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(launch);
            ret.put("ok", true);
        } catch (ActivityNotFoundException | SecurityException e) {
            ret.put("ok", false);
            ret.put("message", "Die App hat den Start abgelehnt.");
        }
        call.resolve(ret);
    }

    /**
     * Wecker in der Uhr-App stellen – im Hintergrund (EXTRA_SKIP_UI=true), damit Jarvis offen bleibt.
     * Lehnt die Uhr-App das ab (z. B. SecurityException), öffnet Jarvis sie ersatzweise mit vorausgefüllter
     * Uhrzeit (SKIP_UI=false) und meldet {opened:true}; JS sagt dann ehrlich „bitte auf Speichern tippen“.
     * Fehler werden mit klarer Meldung (ohne Klammern) abgelehnt, nie still verschluckt.
     */
    @PluginMethod
    public void setAlarm(PluginCall call) {
        AlarmSpec spec;
        try {
            spec = AlarmSpec.of(call.getInt("hour"), call.getInt("minute"), call.getString("message"));
        } catch (IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        Intent i = alarmIntent(spec, true);
        // Android 11+: braucht <queries> für SET_ALARM im Manifest, sonst ist die Uhr-App hier unsichtbar
        if (i.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Keine Uhr-App gefunden, die Wecker annimmt.");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("hour", spec.hour);
        ret.put("minute", spec.minute);
        try {
            getContext().startActivity(i);
            ret.put("ok", true);
            ret.put("opened", false);
            call.resolve(ret);
            return;
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Uhr-App gefunden.");
            return;
        } catch (Exception e) {
            // SecurityException o. Ä.: Ersatzweg unten
            Log.w("JarvisNative", "Wecker im Hintergrund abgelehnt: " + e.getClass().getSimpleName());
        }
        try {
            getContext().startActivity(alarmIntent(spec, false));
            ret.put("ok", true);
            ret.put("opened", true);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Die Uhr-App erlaubt Jarvis keinen Wecker, auch nicht zum Bestätigen");
        } catch (Exception e) {
            call.reject("Die Uhr-App ließ sich nicht öffnen");
        }
    }

    /** ACTION_SET_ALARM mit Uhrzeit, Beschriftung und SKIP_UI (true = im Hintergrund, false = Uhr-App zeigen). */
    private static Intent alarmIntent(AlarmSpec spec, boolean skipUi) {
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, spec.hour);
        i.putExtra(AlarmClock.EXTRA_MINUTES, spec.minute);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, spec.message);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, skipUi);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return i;
    }

    @PluginMethod
    public void setTimer(PluginCall call) {
        int seconds = call.getInt("seconds", 60);
        String message = call.getString("message", "Jarvis Timer");
        Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
        i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, message);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Timer-App gefunden.");
        } catch (SecurityException e) {
            call.reject("Die Uhr-App hat den Timer abgelehnt");
        }
    }

    @PluginMethod
    public void adjustVolume(PluginCall call) {
        String direction = call.getString("direction", "up");
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if ("mute".equals(direction)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
        } else if ("down".equals(direction)) {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
        } else {
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
        }
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String panel = call.getString("panel", "app");
        Intent i;
        if ("wifi".equals(panel)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                i = new Intent(Settings.Panel.ACTION_WIFI);
            } else {
                i = new Intent(Settings.ACTION_WIFI_SETTINGS);
            }
        } else if ("bluetooth".equals(panel)) {
            i = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    // ---------- Selbst-Update ----------
    private JSObject updateStatusObject() {
        JSObject o;
        try { o = JSObject.fromJSONObject(UpdateState.toJson(getContext())); } catch (Exception e) { o = new JSObject(); }
        o.put("notificationsAllowed", UpdateNotifier.canNotify(getContext()));
        return o;
    }

    @PluginMethod
    public void getUpdateStatus(PluginCall call) {
        call.resolve(updateStatusObject());
    }

    @PluginMethod
    public void setUpdateConfig(PluginCall call) {
        Context c = getContext();
        boolean enabled = call.getBoolean("enabled", UpdateState.enabled(c));
        int interval = call.getInt("intervalHours", UpdateState.intervalHours(c));
        boolean wifiOnly = call.getBoolean("wifiOnly", UpdateState.wifiOnly(c));
        UpdateState.setConfig(c, enabled, interval, wifiOnly);
        try { UpdateScheduler.applyConfig(c); } catch (Exception e) { call.reject("Planung fehlgeschlagen: " + e.getMessage()); return; }
        if (enabled) askNotificationPermission();
        call.resolve(updateStatusObject());
    }

    @PluginMethod
    public void checkNow(PluginCall call) {
        boolean allowMetered = call.getBoolean("allowMetered", false);
        UpdateState.setStatus(getContext(), UpdateState.CHECKING, "Suche nach Updates …");
        UpdateScheduler.checkNow(getContext(), allowMetered);
        call.resolve(updateStatusObject());
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (UpdateInstaller.readyApk(getContext()) == null) {
            // Noch nicht geladen (z. B. wartet auf WLAN) → auf ausdrücklichen Wunsch jetzt laden
            UpdateScheduler.checkNow(getContext(), true);
            JSObject r = updateStatusObject();
            r.put("result", "downloading");
            call.resolve(r);
            return;
        }
        if (getActivity() == null) { call.reject("Keine sichtbare App"); return; }
        getActivity().runOnUiThread(() -> {
            String res = UpdateInstaller.install(getActivity());
            if (UpdateInstaller.RESULT_NEEDS_PERMISSION.equals(res) && getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).installAfterPermission();
            }
            JSObject r = updateStatusObject();
            r.put("result", res);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        askNotificationPermission();
        call.resolve(updateStatusObject());
    }

    private void askNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        if (ContextCompat.checkSelfPermission(getContext(), android.Manifest.permission.POST_NOTIFICATIONS)
            == PackageManager.PERMISSION_GRANTED) return;
        ActivityCompat.requestPermissions(getActivity(), new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 4712);
    }

    // ---------- Morgen-Briefing ----------
    /** Kalender (nur lesend). interactive=false fragt nie nach der Erlaubnis. */
    @PluginMethod
    public void getCalendarEvents(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            if (call.getBoolean("interactive", false) && getActivity() != null) {
                requestPermissionForAlias("calendar", call, "calendarPermCallback");
                return;
            }
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("permission", getPermissionState("calendar") == PermissionState.DENIED ? "denied" : "prompt");
            call.resolve(r);
            return;
        }
        resolveCalendar(call);
    }

    @PermissionCallback
    private void calendarPermCallback(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("permission", "denied");
            call.resolve(r);
            return;
        }
        resolveCalendar(call);
    }

    private void resolveCalendar(PluginCall call) {
        int day = Math.max(0, Math.min(1, call.getInt("dayOffset", 0)));
        List<CalendarReader.Item> items = CalendarReader.read(getContext(), day, System.currentTimeMillis());
        JSObject r = new JSObject();
        if (items == null) { r.put("ok", false); r.put("permission", "denied"); call.resolve(r); return; }
        JSArray arr = new JSArray();
        for (CalendarReader.Item it : items) {
            JSObject e = new JSObject();
            e.put("title", it.title);
            e.put("location", it.location);
            e.put("begin", it.begin);
            e.put("end", it.end);
            e.put("allDay", it.allDay);
            arr.put(e);
        }
        r.put("ok", true);
        r.put("events", arr);
        call.resolve(r);
    }

    /** Einstellungen + Aktivität aus der App für den Hintergrund (JSON, max. 16 KB). */
    @PluginMethod
    public void syncBriefing(PluginCall call) {
        try {
            BriefingState.saveSync(getContext(), call.getString("json", "{}"));
            if (!BriefingState.anyEnabled(getContext()) && BriefingService.isRunning()) BriefingScheduler.cancel(getContext());
            else { try { BriefingScheduler.refresh(getContext()); } catch (Exception ignored) {} }
            call.resolve(briefingStateObject());
        } catch (Exception e) {
            call.reject("Briefing-Daten ungültig");
        }
    }

    @PluginMethod
    public void getBriefingState(PluginCall call) { call.resolve(briefingStateObject()); }

    @PluginMethod
    public void setBriefingBackground(PluginCall call) {
        Context c = getContext();
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        BriefingState.setBackgroundEnabled(c, on, false);
        try { BriefingScheduler.apply(c); } catch (Exception e) { call.reject("Planung fehlgeschlagen"); return; }
        if (on) askNotificationPermission();
        JSObject r = briefingStatusObject();
        r.put("ok", true);
        call.resolve(r);
    }

    @PluginMethod
    public void getBriefingStatus(PluginCall call) { call.resolve(briefingStatusObject()); }

    /** Systemdialog „Akku-Optimierung ignorieren?“ (bzw. Liste, falls der Dialog fehlt). */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context c = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            c.startActivity(i);
        } catch (Exception e) {
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                c.startActivity(i);
            } catch (Exception ignored) {}
        }
        call.resolve(briefingStatusObject());
    }

    /** v0.9 Stufe 0: Wurde Jarvis zum Zuhören (Kachel/Verknüpfung/jarvis://zuhoeren) oder normal geöffnet? (einmalig) */
    @PluginMethod
    public void consumeListenLaunch(PluginCall call) {
        boolean[] r = ListenLaunch.consume();
        JSObject o = new JSObject();
        o.put("listen", r[0]);
        o.put("opened", r[1]);
        call.resolve(o);
    }

    /** Verknüpfung „Jarvis fragen“ auf den Startbildschirm legen (der Launcher fragt nach). */
    @PluginMethod
    public void pinListenShortcut(PluginCall call) {
        JSObject ret = new JSObject();
        Context c = getContext();
        try {
            if (!androidx.core.content.pm.ShortcutManagerCompat.isRequestPinShortcutSupported(c)) {
                ret.put("ok", false);
                ret.put("message", "Dieser Startbildschirm unterstützt das nicht. Tippen Sie lange auf das Jarvis-Symbol und ziehen Sie „Jarvis fragen“ heraus.");
                call.resolve(ret);
                return;
            }
            Intent i = new Intent(c, MainActivity.class).setAction(ListenLaunch.ACTION_LISTEN);
            androidx.core.content.pm.ShortcutInfoCompat info = new androidx.core.content.pm.ShortcutInfoCompat.Builder(c, "jarvis_fragen_pin")
                .setShortLabel("Jarvis fragen")
                .setLongLabel("Jarvis fragen (hört sofort zu)")
                .setIcon(androidx.core.graphics.drawable.IconCompat.createWithResource(c, R.drawable.ic_shortcut_ask))
                .setIntent(i)
                .build();
            ret.put("ok", androidx.core.content.pm.ShortcutManagerCompat.requestPinShortcut(c, info, null));
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("message", "Die Verknüpfung ließ sich nicht anlegen.");
        }
        call.resolve(ret);
    }

    /** Kachel „Jarvis fragen“ zu den Schnelleinstellungen hinzufügen (Android 13+ mit System-Dialog). */
    @PluginMethod
    public void requestAddListenTile(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < 33) {
            ret.put("ok", false);
            ret.put("manual", true);
            call.resolve(ret);
            return;
        }
        try {
            android.app.StatusBarManager sbm = getContext().getSystemService(android.app.StatusBarManager.class);
            sbm.requestAddTileService(
                new android.content.ComponentName(getContext(), com.jarvis.assistant.listen.ListenTileService.class),
                "Jarvis fragen",
                android.graphics.drawable.Icon.createWithResource(getContext(), R.drawable.ic_tile_mic),
                getContext().getMainExecutor(),
                result -> {}
            );
            ret.put("ok", true);
        } catch (Exception e) {
            ret.put("ok", false);
            ret.put("manual", true);
        }
        call.resolve(ret);
    }

    /** Wurde die App über die Briefing-Benachrichtigung geöffnet? (einmalig) */
    @PluginMethod
    public void consumeBriefingLaunch(PluginCall call) {
        String kind = BriefingLaunch.kind();
        boolean[] r = BriefingLaunch.consume();
        JSObject o = new JSObject();
        o.put("kind", kind);
        o.put("requested", r[0]);
        o.put("trusted", r[1]);
        call.resolve(o);
    }

    private JSObject briefingStateObject() {
        try { return JSObject.fromJSONObject(BriefingState.toJson(getContext())); } catch (Exception e) { return new JSObject(); }
    }

    private JSObject briefingStatusObject() {
        Context c = getContext();
        JSObject o = briefingStateObject();
        o.put("serviceRunning", BriefingService.isRunning());
        o.put("notifications", BriefingNotifier.canNotify(c));
        o.put("calendar", CalendarReader.granted(c));
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= 23) {
            PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
        }
        o.put("ignoringBattery", ignoring);
        o.put("backgroundEnabled", BriefingState.backgroundEnabled(c));
        return o;
    }
}
