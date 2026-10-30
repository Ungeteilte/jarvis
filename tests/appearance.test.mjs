import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APPEARANCE, normalizeAppearance, ACCENTS, textForBackground, backgroundCss, backgroundLuminances,
  contrastRatio, effectsRunning, EFFECT_FPS, MIN_CONTRAST
} from '../js/core/appearance.js';
import { DEFAULT_SETTINGS, loadSettings } from '../js/core/settings.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { get: (k, d) => (m.has(k) ? m.get(k) : d), set: (k, v) => m.set(k, v) }; };

test('Design: Standard = bisheriges Aussehen (dunkel, Cyan, Blasen, Live-Text, keine Effekte, Standard-Hintergrund)', () => {
  assert.equal(DEFAULT_APPEARANCE.theme, 'dark');
  assert.equal(ACCENTS[DEFAULT_APPEARANCE.accent].hex, '#00c8ff');
  assert.equal(DEFAULT_APPEARANCE.motion, 'normal');
  assert.equal(DEFAULT_APPEARANCE.textSize, 'normal');
  assert.equal(DEFAULT_APPEARANCE.display, 'bubbles');
  assert.equal(DEFAULT_APPEARANCE.liveText, true);
  assert.equal(DEFAULT_APPEARANCE.background.mode, 'default');
  assert.ok(Object.values(DEFAULT_APPEARANCE.effects).every((v) => v === false));
  assert.deepEqual(DEFAULT_SETTINGS.appearance, DEFAULT_APPEARANCE);
});

test('Design: alte Einstellungen ohne „appearance“ und Unsinnswerte werden sauber normalisiert', () => {
  const s = loadSettings(mem({ settings: { provider: 'gemini' } }));
  assert.deepEqual(s.appearance, DEFAULT_APPEARANCE);
  const n = normalizeAppearance({ theme: 'neon', accent: 'x', motion: 1, textSize: 'riesig', display: 'grid', liveText: 'ja',
    background: { mode: 'gradient', color: 'red', color2: '#ABCDEF', angle: 999 }, effects: { particles: 1, waves: true, hack: true } });
  assert.equal(n.theme, 'dark'); assert.equal(n.accent, 'cyan'); assert.equal(n.motion, 'normal');
  assert.equal(n.textSize, 'normal'); assert.equal(n.display, 'bubbles');
  assert.equal(n.background.mode, 'gradient');
  assert.equal(n.background.color, DEFAULT_APPEARANCE.background.color);
  assert.equal(n.background.color2, '#abcdef');
  assert.ok(n.background.angle >= 0 && n.background.angle < 360);
  assert.equal(n.effects.waves, true);
  assert.ok(!('hack' in n.effects));
});

test('Design: Hintergrund-CSS nur aus geprüften Werten (kein Einschleusen)', () => {
  assert.equal(backgroundCss({ mode: 'default' }), null);
  assert.equal(backgroundCss({ mode: 'color', color: '#112233' }), '#112233');
  assert.match(backgroundCss({ mode: 'gradient', color: '#000000', color2: '#ffffff', angle: 90 }), /^linear-gradient\(90deg, #000000, #ffffff\)$/);
  assert.equal(backgroundCss(normalizeAppearance({ background: { mode: 'color', color: 'red;background:url(http://x)' } }).background), DEFAULT_APPEARANCE.background.color);
});

test('Design: automatischer Textkontrast (WCAG) – hell auf dunkel, dunkel auf hell, Warnung bei Grau', () => {
  assert.ok(contrastRatio(0, 1) > 20);
  const dark = textForBackground(backgroundLuminances({ mode: 'color', color: '#0a1828' }));
  assert.equal(dark.text, 'light'); assert.ok(dark.ok && dark.ratio >= MIN_CONTRAST);
  const white = textForBackground(backgroundLuminances({ mode: 'color', color: '#ffffff' }));
  assert.equal(white.text, 'dark'); assert.ok(white.ok);
  const grey = textForBackground(backgroundLuminances({ mode: 'gradient', color: '#000000', color2: '#ffffff', angle: 0 }));
  assert.equal(grey.ok, false, 'Verlauf schwarz→weiß: an einer Stelle immer schlecht lesbar → Warnung');
  const img = textForBackground(backgroundLuminances({ mode: 'image' }, 0.9));
  assert.equal(img.text, 'dark');
});

test('Design: Zier-Animationen nur wenn an, sichtbar und ohne reduzierte Bewegung; FPS gedeckelt', () => {
  const on = normalizeAppearance({ effects: { particles: true, glow: true } });
  assert.deepEqual(effectsRunning({ appearance: on, hidden: false, prefersReducedMotion: false }).sort(), ['glow', 'particles']);
  assert.deepEqual(effectsRunning({ appearance: on, hidden: true, prefersReducedMotion: false }), []);
  assert.deepEqual(effectsRunning({ appearance: on, hidden: false, prefersReducedMotion: true }), []);
  assert.deepEqual(effectsRunning({ appearance: { ...on, motion: 'reduced' }, hidden: false, prefersReducedMotion: false }), []);
  assert.deepEqual(effectsRunning({ appearance: DEFAULT_APPEARANCE, hidden: false, prefersReducedMotion: false }), []);
  assert.ok(EFFECT_FPS <= 30);
});
