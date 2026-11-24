// The installable app: the manifest, its icons, and the service worker's
// list of files, which has to hold everything the page loads to play offline.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const shell = () => {
  const m = /const SHELL = \[([\s\S]*?)\];/.exec(read('sw.js'));
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};

test('the service worker caches every script, image and icon the page uses', () => {
  const html = read('index.html');
  const list = shell();
  const used = [
    ...[...html.matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]),
    ...[...html.matchAll(/<link rel="(?:manifest|icon|apple-touch-icon)" href="([^"]+)"/g)].map((x) => x[1]),
  ];
  for (const f of used) assert.ok(list.includes(f), `${f} is not in sw.js SHELL`);
  // (the 3D graphics level's files are cached when first fetched instead: sw.js LAZY)
  const lazy = new RegExp(/const LAZY = \/(.*)\/;/.exec(read('sw.js'))[1]);
  for (const f of fs.readdirSync(path.join(root, 'js'))) assert.ok(list.includes('js/' + f) || lazy.test('/js/' + f), `js/${f} is not in sw.js SHELL`);
  assert.ok(lazy.test('/vendor/three/three.module.min.js') && lazy.test('/vendor/three/addons/postprocessing/Pass.js'), 'three.js is cached for offline 3D');
  for (const f of fs.readdirSync(path.join(root, 'img'))) assert.ok(list.includes('img/' + f), `img/${f} is not in sw.js SHELL`);
  for (const f of list) if (f !== './') assert.ok(fs.existsSync(path.join(root, f)), `${f} in sw.js SHELL does not exist`);
});

test('the manifest makes the game installable', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.ok(m.name && m.short_name && m.start_url && m.display);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) assert.ok(shell().includes(i.src), `${i.src} is not in sw.js SHELL`);
});

test('a new build is downloaded before the reload, with a loader on the menu', () => {
  const sw = read('sw.js'), main = read('js/main.js'), html = read('index.html');
  assert.match(sw, /addEventListener\('message'[\s\S]*t === 'update'/, 'sw.js answers the page\'s update message');
  assert.match(main, /postMessage\(\{ t: 'update' \}\)/, 'main.js asks the service worker to fetch the new build');
  assert.match(main, /if \(!newBuild \|\| !fetched/, 'the page reloads only once the new build is in');
  assert.match(html, /id="update"[^>]*role="status"/, 'the loader is announced');
  assert.match(html, /#update \{[^}]*pointer-events: none/, 'the loader never blocks a touch');
});
