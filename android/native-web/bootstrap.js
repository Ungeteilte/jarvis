/**
 * Native Bootstrap: lädt sichere Einstellungen, setzt Adapter, patched app-Start.
 */
const Cap = globalThis.Capacitor;
const isNative = Boolean(Cap?.isNativePlatform?.());
window.__JARVIS_NATIVE__ = isNative;

// app.js wartet auf dieses Versprechen, bevor es die Adapter liest. Getrennte Modul-Skripte
// warten NICHT auf das Top-Level-await dieses Skripts – ohne das Versprechen gewinnt app.js
// das Rennen und nimmt die Web-Adapter (im WebView: keine Sprachausgabe). Muss VOR dem ersten
// await stehen und wird im finally immer erfüllt.
let bootDone = () => {};
window.__JARVIS_BOOT__ = new Promise((resolve) => { bootDone = resolve; });

try {
  if (isNative) {
    const { hydrateNativeStorage, createNativeStorageAdapter } = await import('./native-storage.js');
    const { createNativeTTS } = await import('./native-tts.js');
    const { createNativeSTT } = await import('./native-stt.js');
    const { createNativeDevice } = await import('./native-device.js');

    const map = await hydrateNativeStorage();
    window.__JARVIS_ADAPTERS__ = {
      storage: () => createNativeStorageAdapter(map),
      tts: createNativeTTS,
      stt: createNativeSTT,
      device: createNativeDevice
    };
    document.documentElement.classList.add('jarvis-native');
    bootDone(); // Adapter stehen – app.js darf starten (Statusleiste/Updater-UI folgen)

    try {
      await Cap.Plugins?.StatusBar?.setBackgroundColor?.({ color: '#050c16' });
      await Cap.Plugins?.StatusBar?.setStyle?.({ style: 'DARK' });
    } catch { /* optional */ }

    // Selbst-Update: Einstellungsbereich + Hinweiskarte (Fehler hier dürfen den Start nie stören)
    try {
      const { mountUpdaterUI } = await import('./updater-ui.js');
      const mount = () => mountUpdaterUI(Cap.Plugins?.JarvisNative);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
      else mount();
    } catch (e) { console.warn('[Jarvis] Updater-UI nicht verfügbar', e); }
    console.info('[Jarvis] Native Adapter bereit');
  }
} catch (e) {
  console.warn('[Jarvis] Native Bootstrap fehlgeschlagen – Web-Adapter', e);
} finally {
  window.__JARVIS_BOOTSTRAP_DONE__ = true;
  bootDone();
}
