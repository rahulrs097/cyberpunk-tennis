// Writes ads/list.json from the pictures in ads/, in file-name order, so the
// billboard shows whatever is in the folder. Cloudflare runs it on every
// deploy ([build] in wrangler.toml); `node tools/ads-list.js` does it locally.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'ads');
const PICTURE = /\.(png|jpe?g|webp|gif)$/i;

function adsList(folder = dir) {
  const files = fs.existsSync(folder) ? fs.readdirSync(folder) : [];
  return files.filter((f) => PICTURE.test(f) && !f.startsWith('.')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

if (require.main === module) {
  fs.mkdirSync(dir, { recursive: true });
  const ads = adsList();
  fs.writeFileSync(path.join(dir, 'list.json'), JSON.stringify({ ads }, null, 2) + '\n');
  console.log(`ads/list.json: ${ads.length} ad${ads.length === 1 ? '' : 's'}${ads.length ? ' (' + ads.join(', ') + ')' : ''}`);
}

module.exports = { adsList };
