import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatStatusLine, formatTime, shouldShowCard, normalizeInterval, INTERVAL_OPTIONS } from '../android/native-web/updater-format.js';

const NOW = new Date(2026, 9, 19, 21, 30).getTime();

test('Updater-Anzeige: Zeit und Statuszeile', () => {
  assert.equal(formatTime(0, NOW), 'noch nie');
  assert.equal(formatTime(new Date(2026, 9, 19, 21, 14).getTime(), NOW), 'heute, 21:14');
  assert.equal(formatTime(new Date(2026, 9, 18, 7, 5).getTime(), NOW), '18.10., 07:05');
  const t = new Date(2026, 9, 19, 21, 14).getTime();
  assert.equal(formatStatusLine({ status: 'up-to-date', lastCheck: t, installedVersionName: '0.3' }, NOW),
    'Zuletzt geprüft: heute, 21:14 – aktuell (v0.3)');
  assert.match(formatStatusLine({ status: 'ready', lastCheck: t, availableVersionName: '0.4' }, NOW), /v0\.4 bereit/);
  assert.match(formatStatusLine({ status: 'waiting-wifi', lastCheck: t, availableVersionName: '0.4' }, NOW), /wartet auf WLAN/);
  assert.match(formatStatusLine({ status: 'error', lastCheck: t, message: 'Prüfsumme falsch' }, NOW), /Prüfsumme falsch/);
  assert.match(formatStatusLine({ status: 'idle', installedVersionName: '0.3' }, NOW), /noch nie/);
});

test('Updater-Anzeige: Karte und Intervalle', () => {
  assert.equal(shouldShowCard({ availableVersionCode: 4, installedVersionCode: 3 }), true);
  assert.equal(shouldShowCard({ availableVersionCode: 3, installedVersionCode: 3 }), false);
  assert.equal(shouldShowCard({}), false);
  assert.deepEqual(INTERVAL_OPTIONS, [3, 6, 12, 24]);
  assert.equal(normalizeInterval(12), 12);
  assert.equal(normalizeInterval(0.25), 6);
});
