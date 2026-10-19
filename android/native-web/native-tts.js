/** Native TextToSpeech über JarvisNative (Android TextToSpeech). */
import { pickVoice, voiceIdOf } from '../js/core/persona.js';

const J = () => globalThis.Capacitor?.Plugins?.JarvisNative;

export function createNativeTTS() {
  let speaking = false;
  let voicesCache = [];

  return {
    isSupported: () => Boolean(J()?.speak),
    get speaking() { return speaking; },

    async listVoices() {
      try {
        const { voices } = await J().listVoices();
        voicesCache = (voices || []).map((v) => ({
          id: v.id || `${v.name}|${v.lang}`,
          name: v.name,
          lang: v.lang,
          default: !!v.default,
          localService: true,
          voiceURI: v.id
        }));
        return voicesCache;
      } catch {
        return voicesCache;
      }
    },

    onVoicesChanged() { /* Android liefert Stimmen synchron nach Init */ },

    cancel() {
      speaking = false;
      try { J()?.stopSpeaking?.(); } catch { /* egal */ }
    },

    async speak(text, { voiceId = '', rate = 1, pitch = 1, lang = 'de-DE' } = {}) {
      if (!text || !J()?.speak) return;
      await this.listVoices();
      const voice = pickVoice(
        voicesCache.map((v) => ({ ...v, voiceURI: v.id })),
        voiceId
      );
      speaking = true;
      try {
        await J().speak({
          text: String(text),
          lang: voice?.lang || lang,
          voiceId: voice?.id || '',
          rate,
          pitch
        });
      } finally {
        speaking = false;
      }
    }
  };
}
