// v0.9.6 Designoptionen – Browser-Schicht: setzt data-Attribute/CSS-Variablen auf <html>,
// verwaltet das lokale Hintergrundbild und die optionalen Zier-Animationen (Canvas).
// Kein Netzwerk: das Bild wird nur auf dem Gerät gespeichert (localStorage), nie hochgeladen.
import {
  normalizeAppearance, ACCENTS, TEXT_SIZES, hexToRgb, backgroundCss, backgroundLuminances,
  textForBackground, effectsRunning, EFFECT_FPS
} from '../core/appearance.js';

export const BG_IMAGE_KEY = 'jarvis.bg-image';
const MAX_SIDE = 1600;          // Bild wird verkleinert (Speicher + Akku)
const MAX_DATA_CHARS = 2_500_000; // ~1,8 MB – passt sicher in localStorage

const root = () => document.documentElement;
const mq = (q) => (globalThis.matchMedia ? globalThis.matchMedia(q) : null);

export function loadBgImage() {
  try { const v = JSON.parse(globalThis.localStorage?.getItem(BG_IMAGE_KEY) || 'null'); return v?.data ? v : null; } catch { return null; }
}
export function clearBgImage() { try { globalThis.localStorage?.removeItem(BG_IMAGE_KEY); } catch { /* egal */ } }

/** Datei (vom Dateiwähler) → verkleinertes JPEG + mittlere Helligkeit, lokal gespeichert. */
export async function storeBgImageFromFile(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('Bitte eine Bilddatei wählen.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Das Bild konnte nicht gelesen werden.'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL('image/jpeg', 0.82);
    if (data.length > MAX_DATA_CHARS) data = c.toDataURL('image/jpeg', 0.6);
    if (data.length > MAX_DATA_CHARS) throw new Error('Das Bild ist zu groß.');
    // mittlere Helligkeit über ein 24×24-Raster (für den automatischen Textkontrast)
    const s = document.createElement('canvas'); s.width = 24; s.height = 24;
    const sx = s.getContext('2d'); sx.drawImage(c, 0, 0, 24, 24);
    const px = sx.getImageData(0, 0, 24, 24).data;
    let lum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    lum /= px.length / 4;
    const rec = { data, lum: Math.round(lum * 1000) / 1000 };
    try { globalThis.localStorage.setItem(BG_IMAGE_KEY, JSON.stringify(rec)); } catch { throw new Error('Nicht genug Speicher für dieses Bild.'); }
    return rec;
  } finally { URL.revokeObjectURL(url); }
}

/** Lesbarkeit für den gewählten Hintergrund (für den Hinweis in den Einstellungen). */
export function contrastInfo(appearance, image = loadBgImage()) {
  const a = normalizeAppearance(appearance);
  if (a.background.mode === 'default') return null;
  if (a.background.mode === 'image' && !image) return null;
  return textForBackground(backgroundLuminances(a.background, image?.lum));
}

export function applyAppearance(appearance) {
  const a = normalizeAppearance(appearance);
  const el = root();
  const dark = mq('(prefers-color-scheme: dark)');
  const theme = a.theme === 'system' ? (dark && !dark.matches ? 'light' : 'dark') : a.theme;
  const set = (k, v, def) => { if (v === def) delete el.dataset[k]; else el.dataset[k] = v; };
  set('theme', theme, 'dark');
  set('motion', a.motion, 'normal');
  set('display', a.display, 'bubbles');
  set('liveText', a.liveText ? 'on' : 'off', 'on');
  const accent = ACCENTS[a.accent].hex;
  if (a.accent === 'cyan') { el.style.removeProperty('--cyan'); el.style.removeProperty('--accent-rgb'); el.style.removeProperty('--cyan-soft'); }
  else {
    const rgb = hexToRgb(accent).join(', ');
    el.style.setProperty('--cyan', accent);
    el.style.setProperty('--accent-rgb', rgb);
    el.style.setProperty('--cyan-soft', `rgba(${rgb}, 0.35)`);
  }
  if (TEXT_SIZES[a.textSize] === 1) el.style.removeProperty('--chat-scale');
  else el.style.setProperty('--chat-scale', String(TEXT_SIZES[a.textSize]));
  // Hintergrund
  const image = a.background.mode === 'image' ? loadBgImage() : null;
  const css = a.background.mode === 'image' ? (image ? `url("${image.data}")` : null) : backgroundCss(a.background);
  if (css) {
    el.style.setProperty('--custom-bg', css);
    el.dataset.customBg = a.background.mode;
    el.dataset.bgText = contrastInfo(a, image)?.text || 'light';
  } else {
    el.style.removeProperty('--custom-bg');
    delete el.dataset.customBg;
    delete el.dataset.bgText;
  }
  effects.update(a);
  return a;
}

// ---------- Zier-Animationen ----------
// Ein Canvas für alle Effekte; requestAnimationFrame mit FPS-Obergrenze; pausiert im Hintergrund,
// bei „reduzierter Bewegung“ (Einstellung oder Gerät) und wenn kein Effekt an ist (Canvas wird entfernt).
export const effects = (() => {
  let cfg = null;
  let canvas = null; let ctx = null; let raf = 0; let last = 0; let t0 = 0;
  let parts = [];
  let active = [];
  const reduce = mq('(prefers-reduced-motion: reduce)');
  const stats = { frames: 0 };

  function size() {
    if (!canvas) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'fx-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    root().dataset.fx = '1';
    size();
    addEventListener('resize', size);
    parts = Array.from({ length: 36 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.004 + Math.random() * 0.01, p: Math.random() * 6.28 }));
  }
  function removeCanvas() {
    stop();
    if (!canvas) return;
    removeEventListener('resize', size);
    canvas.remove(); canvas = null; ctx = null;
    delete root().dataset.fx;
  }
  function accent() { return getComputedStyle(root()).getPropertyValue('--accent-rgb').trim() || '0, 200, 255'; }
  function draw(ts) {
    raf = requestAnimationFrame(draw);
    if (ts - last < 1000 / EFFECT_FPS) return; // FPS-Obergrenze
    last = ts;
    stats.frames++;
    const t = (ts - t0) / 1000;
    const w = innerWidth; const h = innerHeight;
    const rgb = accent();
    ctx.clearRect(0, 0, w, h);
    if (active.includes('glow')) {
      const orb = document.querySelector('#orb');
      const r = orb && orb.offsetParent ? orb.getBoundingClientRect() : null;
      if (r) {
        const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
        const rad = r.width * (0.95 + 0.12 * Math.sin(t * 1.4));
        const g = ctx.createRadialGradient(cx, cy, r.width * 0.3, cx, cy, rad);
        g.addColorStop(0, `rgba(${rgb}, 0.22)`); g.addColorStop(1, `rgba(${rgb}, 0)`);
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.fill();
      }
    }
    if (active.includes('particles')) {
      ctx.fillStyle = `rgba(${rgb}, 0.45)`;
      for (const p of parts) {
        p.y -= p.v / EFFECT_FPS * 2; if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        const x = (p.x + 0.01 * Math.sin(t + p.p)) * w;
        ctx.beginPath(); ctx.arc(x, p.y * h, p.r, 0, 6.2832); ctx.fill();
      }
    }
    if (active.includes('waves')) {
      ctx.lineWidth = 1.5;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(${rgb}, ${0.22 - k * 0.05})`;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const y = h * (0.86 + k * 0.04) + Math.sin(x / (90 + k * 30) + t * (0.8 + k * 0.3)) * (10 + k * 4);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  function start() { if (!raf && ctx) { t0 = t0 || performance.now(); raf = requestAnimationFrame(draw); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function refresh() {
    if (!cfg) return;
    const wanted = normalizeAppearance(cfg).effects;
    const anyOn = Object.values(wanted).some(Boolean);
    if (!anyOn) { removeCanvas(); active = []; return; }
    active = effectsRunning({ appearance: cfg, hidden: document.hidden, prefersReducedMotion: Boolean(reduce?.matches) });
    if (!active.length) { stop(); if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    ensureCanvas();
    start();
  }
  document.addEventListener('visibilitychange', refresh);
  reduce?.addEventListener?.('change', refresh);
  return {
    update(a) { cfg = a; refresh(); },
    get running() { return Boolean(raf); },
    get active() { return [...active]; },
    get frames() { return stats.frames; }
  };
})();

// Theme „System“ folgt dem Gerät live
mq('(prefers-color-scheme: dark)')?.addEventListener?.('change', () => { if (lastApplied) applyAppearance(lastApplied); });
let lastApplied = null;
export function applyAndRemember(a) { lastApplied = a; return applyAppearance(a); }
