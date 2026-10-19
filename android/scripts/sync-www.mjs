/** Kopiert die PWA nach www/ und hängt den nativen Bootstrap an. */
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const project = join(root, '..');
const candidates = [join(project, '..'), join(project, '..', 'jarvis')];
const src = candidates.find((c) => existsSync(join(c, 'js', 'core', 'assistant.js')));
if (!src) throw new Error('PWA-Quellen (js/core) nicht gefunden');
const www = join(project, 'www');
const overlay = join(project, 'native-web');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

for (const name of ['index.html', 'manifest.json', 'css', 'js', 'icons']) {
  cpSync(join(src, name), join(www, name), { recursive: true });
}
cpSync(overlay, join(www, 'native'), { recursive: true });

let html = readFileSync(join(www, 'index.html'), 'utf8');
if (!html.includes('native/bootstrap.js')) {
  html = html.replace(
    '<script type="module" src="js/app.js"></script>',
    `<script type="module" src="native/bootstrap.js"></script>\n  <script type="module" src="js/app.js"></script>`
  );
  writeFileSync(join(www, 'index.html'), html);
}
console.log('www synchronisiert aus', src);
