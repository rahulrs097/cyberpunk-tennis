// Billboard ads: the deploy lists the pictures in ads/ for the game.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { adsList } = require('../tools/ads-list.js');

test('the ads list holds the pictures in the folder, in file-name order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-'));
  for (const f of ['10-late.png', '2-cafe.JPG', '01-garage.webp', 'README.md', 'list.json', '.hidden.png', 'notes.txt']) fs.writeFileSync(path.join(dir, f), '');
  assert.deepStrictEqual(adsList(dir), ['01-garage.webp', '2-cafe.JPG', '10-late.png']);
});

test('no ads folder means no ads', () => {
  assert.deepStrictEqual(adsList(path.join(os.tmpdir(), 'no-such-ads-folder')), []);
});

test('the deploy writes the list and the service worker keeps ads for offline play', () => {
  const root = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8'), /\[build\]\s*\ncommand = "node tools\/ads-list.js"/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /isAd\(req\.url\)/);
});
