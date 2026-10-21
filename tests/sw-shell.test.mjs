// Jedes Modul unter js/ muss im Service-Worker-Cache stehen, sonst bricht die PWA offline (v0.9-Fund).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });

test('sw.js: alle js-Module im APP_SHELL, keine toten Einträge', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const listed = new Set([...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map((m) => m[1]));
  const files = walk('js').map((p) => p.replace(/\\/g, '/'));
  assert.deepEqual(files.filter((f) => !listed.has(f)), []);
  assert.deepEqual([...listed].filter((f) => !files.includes(f)), []);
});
