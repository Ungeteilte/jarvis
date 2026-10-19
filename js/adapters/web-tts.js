// TextToSpeech-Adapter (Web Speech API: speechSynthesis).
// Schnittstelle (auch für eine spätere native Android-Version):
//   isSupported(): boolean
//   listVoices(): Promise<Array<{id, name, lang, default}>>
//   speak(text, {voiceId, rate, pitch, lang}): Promise<void>
//   cancel(): void
//   onVoicesChanged(cb)
import { pickVoice, voiceIdOf } from '../core/persona.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

function rawVoices() {
  return synth ? synth.getVoices() : [];
}

/** Chrome liefert Stimmen oft erst verzögert – kurz warten. */
function waitForVoices(timeout = 1500) {
  return new Promise((resolve) => {
    const v = rawVoices();
    if (v.length || !synth) return resolve(v);
    const done = () => { synth.removeEventListener('voiceschanged', done); resolve(rawVoices()); };
    synth.addEventListener('voiceschanged', done);
    setTimeout(done, timeout);
  });
}

/** Markdown & Emojis entfernen und in Sätze teilen (Chrome bricht lange Texte ab). */
function toChunks(text) {
  const clean = String(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_#>`~|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]*/g) || [clean];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 180 && cur) { chunks.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

export function createWebTTS() {
  let speaking = false;
  return {
    isSupported: () => Boolean(synth && window.SpeechSynthesisUtterance),
    get speaking() { return speaking; },

    async listVoices() {
      const voices = await waitForVoices();
      return voices.map((v) => ({ id: voiceIdOf(v), name: v.name, lang: v.lang, default: v.default, localService: v.localService }));
    },

    onVoicesChanged(cb) {
      synth?.addEventListener('voiceschanged', cb);
    },

    cancel() {
      synth?.cancel();
      speaking = false;
    },

    async speak(text, { voiceId = '', rate = 1, pitch = 1, lang = 'de-DE' } = {}) {
      if (!synth || !text) return;
      if (synth.speaking || synth.pending) synth.cancel();
      const voice = pickVoice(await waitForVoices(), voiceId);
      speaking = true;
      try {
        for (const chunk of toChunks(text)) {
          if (!speaking) break;
          await new Promise((resolve) => {
            const u = new SpeechSynthesisUtterance(chunk);
            u.lang = voice?.lang || lang;
            if (voice) u.voice = voice;
            u.rate = rate;
            u.pitch = pitch;
            u.onend = resolve;
            u.onerror = resolve;
            synth.speak(u);
            // Sicherheitsnetz, falls "onend" nie kommt (bekannter Chrome-Fehler)
            setTimeout(resolve, 2000 + chunk.length * 120 / rate);
          });
        }
      } finally {
        speaking = false;
      }
    }
  };
}
