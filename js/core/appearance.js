// v0.9.6 Designoptionen: reine Logik (kein Browser-Code). Standardwerte = bisheriges Aussehen,
// d. h. bestehende Nutzer sehen nach dem Update nichts Neues, solange sie nichts umstellen.

export const THEMES = Object.freeze(['dark', 'light', 'system']);
export const ACCENTS = Object.freeze({
  cyan: { label: 'Cyan (Standard)', hex: '#00c8ff' },
  blau: { label: 'Blau', hex: '#4d8dff' },
  violett: { label: 'Violett', hex: '#9b7bff' },
  gruen: { label: 'Grün', hex: '#2ee6a6' },
  bernstein: { label: 'Bernstein', hex: '#ffb547' },
  rose: { label: 'Rosé', hex: '#ff6fa3' }
});
export const MOTIONS = Object.freeze(['normal', 'calm', 'reduced']);       // Orb-Animation
export const TEXT_SIZES = Object.freeze({ small: 0.92, normal: 1, large: 1.12, xlarge: 1.25 });
export const DISPLAYS = Object.freeze(['bubbles', 'compact']);
export const BG_MODES = Object.freeze(['default', 'color', 'gradient', 'image']);
export const EFFECTS = Object.freeze(['particles', 'waves', 'glow']);
export const EFFECT_FPS = 30; // Obergrenze für Zier-Animationen (Akku)

export const DEFAULT_APPEARANCE = Object.freeze({
  theme: 'dark',
  accent: 'cyan',
  motion: 'normal',
  textSize: 'normal',
  display: 'bubbles',
  liveText: true,
  background: Object.freeze({ mode: 'default', color: '#0a1828', color2: '#3a1f5d', angle: 160 }),
  effects: Object.freeze({ particles: false, waves: false, glow: false })
});

const HEX_RE = /^#[0-9a-f]{6}$/i;
const pick = (v, list, fb) => (list.includes(v) ? v : fb);
const hex = (v, fb) => (typeof v === 'string' && HEX_RE.test(v) ? v.toLowerCase() : fb);

export function normalizeAppearance(a) {
  const d = DEFAULT_APPEARANCE;
  const bg = a?.background || {};
  const fx = a?.effects || {};
  const angle = Math.round(Number(bg.angle));
  return {
    theme: pick(a?.theme, THEMES, d.theme),
    accent: Object.hasOwn(ACCENTS, a?.accent) ? a.accent : d.accent,
    motion: pick(a?.motion, MOTIONS, d.motion),
    textSize: Object.hasOwn(TEXT_SIZES, a?.textSize) ? a.textSize : d.textSize,
    display: pick(a?.display, DISPLAYS, d.display),
    liveText: typeof a?.liveText === 'boolean' ? a.liveText : d.liveText,
    background: {
      mode: pick(bg.mode, BG_MODES, d.background.mode),
      color: hex(bg.color, d.background.color),
      color2: hex(bg.color2, d.background.color2),
      angle: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : d.background.angle
    },
    effects: Object.fromEntries(EFFECTS.map((k) => [k, fx[k] === true]))
  };
}

/** '#rrggbb' → [r, g, b] */
export function hexToRgb(h) {
  const v = hex(h, '#000000');
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
}

/** Relative Leuchtdichte nach WCAG 2.x (0 … 1). */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(l1, l2) {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

// Textfarben der beiden Paletten (müssen zu css/style.css passen)
export const TEXT_LIGHT = '#d8f4ff';
export const TEXT_DARK = '#0b2233';
export const MIN_CONTRAST = 4.5; // WCAG AA für normalen Text

/**
 * Welche Textfarbe ist auf diesem Hintergrund besser lesbar?
 * bgLums = Leuchtdichten der Hintergrund-Farben (bei Verlauf beide Enden, bei Bild der Mittelwert).
 * → { text: 'light'|'dark', ratio (schlechteste Stelle), ok }
 */
export function textForBackground(bgLums) {
  const lums = (bgLums || []).filter((l) => Number.isFinite(l));
  if (!lums.length) return { text: 'light', ratio: 21, ok: true };
  const lt = luminance(hexToRgb(TEXT_LIGHT));
  const dk = luminance(hexToRgb(TEXT_DARK));
  const worst = (tl) => Math.min(...lums.map((l) => contrastRatio(tl, l)));
  const rl = worst(lt);
  const rd = worst(dk);
  const text = rd > rl ? 'dark' : 'light';
  const ratio = Math.round(Math.max(rl, rd) * 10) / 10;
  return { text, ratio, ok: ratio >= MIN_CONTRAST };
}

/** Hintergrund als CSS (ohne Bild-Daten; das Bild setzt die UI-Schicht). null = Standard-Design. */
export function backgroundCss(bg) {
  const b = normalizeAppearance({ background: bg }).background;
  if (b.mode === 'color') return b.color;
  if (b.mode === 'gradient') return `linear-gradient(${b.angle}deg, ${b.color}, ${b.color2})`;
  return null;
}

/** Leuchtdichten des gewählten Hintergrunds (Bild: übergebener Mittelwert). */
export function backgroundLuminances(bg, imageLum = null) {
  const b = normalizeAppearance({ background: bg }).background;
  if (b.mode === 'color') return [luminance(hexToRgb(b.color))];
  if (b.mode === 'gradient') return [luminance(hexToRgb(b.color)), luminance(hexToRgb(b.color2))];
  if (b.mode === 'image' && Number.isFinite(imageLum)) return [imageLum];
  return [];
}

/** Sollen Zier-Animationen laufen? (nie im Hintergrund, nie bei reduzierter Bewegung) */
export function effectsRunning({ appearance, hidden, prefersReducedMotion }) {
  const a = normalizeAppearance(appearance);
  if (hidden || prefersReducedMotion || a.motion === 'reduced') return [];
  return EFFECTS.filter((k) => a.effects[k]);
}
