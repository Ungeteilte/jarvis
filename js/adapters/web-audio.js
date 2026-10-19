// Kleine Signaltöne (Timer-Alarm, Wake-Word erkannt) und Vibration.
let ctx;
export function beep({ freq = 880, duration = 0.15, times = 1, gap = 0.12 } = {}) {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const t = ctx.currentTime + i * (duration + gap);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + duration + 0.02);
    }
  } catch { /* Audio nicht verfügbar */ }
}
export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* egal */ }
}
