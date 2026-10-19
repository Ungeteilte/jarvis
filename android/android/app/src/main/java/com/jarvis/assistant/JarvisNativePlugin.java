package com.jarvis.assistant;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
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
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "JarvisNative")
public class JarvisNativePlugin extends Plugin {
    private TextToSpeech tts;
    private final AtomicBoolean ttsReady = new AtomicBoolean(false);
    private String torchCameraId = null;
    private SharedPreferences securePrefs;

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

        tts = new TextToSpeech(ctx, status -> {
            ttsReady.set(status == TextToSpeech.SUCCESS);
            if (ttsReady.get()) {
                tts.setLanguage(Locale.GERMANY);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
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
            String id = UUID.randomUUID().toString();
            CountDownLatch done = new CountDownLatch(1);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String utteranceId) {}
                @Override public void onDone(String utteranceId) { done.countDown(); }
                @Override public void onError(String utteranceId) { done.countDown(); }
            });
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
            done.await(120, TimeUnit.SECONDS);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopSpeaking(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
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

    @PluginMethod
    public void openApp(PluginCall call) {
        String name = call.getString("name", "").trim().toLowerCase(Locale.GERMAN);
        JSObject ret = new JSObject();
        PackageManager pm = getContext().getPackageManager();
        List<ApplicationInfo> apps = pm.getInstalledApplications(PackageManager.GET_META_DATA);
        String bestPkg = null;
        String bestLabel = null;
        for (ApplicationInfo ai : apps) {
            String label = pm.getApplicationLabel(ai).toString().toLowerCase(Locale.GERMAN);
            if (label.equals(name) || label.contains(name) || name.contains(label)) {
                Intent launch = pm.getLaunchIntentForPackage(ai.packageName);
                if (launch != null) {
                    bestPkg = ai.packageName;
                    bestLabel = pm.getApplicationLabel(ai).toString();
                    if (label.equals(name)) break;
                }
            }
        }
        if (bestPkg == null) {
            ret.put("ok", false);
            ret.put("message", "Ich habe keine App namens „" + call.getString("name", "") + "“ gefunden.");
            call.resolve(ret);
            return;
        }
        Intent launch = pm.getLaunchIntentForPackage(bestPkg);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(launch);
        ret.put("ok", true);
        ret.put("message", "Öffne " + bestLabel + ".");
        call.resolve(ret);
    }

    @PluginMethod
    public void setAlarm(PluginCall call) {
        int hour = call.getInt("hour", 7);
        int minute = call.getInt("minute", 0);
        String message = call.getString("message", "Jarvis Wecker");
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
        i.putExtra(AlarmClock.EXTRA_HOUR, hour);
        i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
        i.putExtra(AlarmClock.EXTRA_MESSAGE, message);
        i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("Keine Uhr-App gefunden.");
        }
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
}
