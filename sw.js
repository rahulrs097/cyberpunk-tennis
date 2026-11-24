// Service worker: keeps the game playable with no connection (the CPU,
// the tutorial, VR), so it can be installed as an app. Online matches still
// need the network; the relay's WebSockets never come through here.
//
// Fresh first: every file is asked of the network (revalidated, so an
// unchanged file costs a 304) and the cache is only the fallback when
// offline. A new build is therefore what loads as soon as there's a
// connection, with nothing to bump. VERSION only needs a change if the
// list of files below does, to start a clean cache.
const VERSION = 'ct-2';
const SHELL = [
  './',
  'manifest.webmanifest',
  'js/physics.js',
  'js/characters.js',
  'js/match.js',
  'js/game.js',
  'js/input.js',
  'js/achievements.js',
  'js/render.js',
  'js/vr.js',
  'js/music.js',
  'js/net.js',
  'js/main.js',
  'img/billboard.jpg',
  'sound/net-1.wav',
  'sound/net-2.wav',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));
// The 3D graphics level's files: not fetched at install (most never use
// them), but kept once they have been, so 3D works offline after that.
const LAZY = /\/(js\/render3d\.js|vendor\/three\/.+\.js|models\/.+|sound\/(thunder-.+|rain-loop)\.mp3)$/;
// Google Fonts: the stylesheet and the font files, kept once seen
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL.map((p) => new Request(new URL(p, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/room/') || url.pathname.endsWith('/sw.js')) return;
    e.respondWith(freshFirst(req));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(cachedFirst(req));
  }
});

async function freshFirst(req) {
  const cache = await caches.open(VERSION);
  const nav = req.mode === 'navigate';
  // the page is one file whatever its query (?ping, ?lag=200)
  const key = nav ? new URL('./', self.registration.scope).href : req;
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && (nav || SHELL_URLS.has(stripSearch(req.url)) || LAZY.test(new URL(req.url).pathname))) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cachedFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') await cache.put(req, res.clone());
  return res;
}

// A new build is live (the page asks: main.js checkBuild). Fetch every file
// afresh into the cache, the page's own and the 3D files this phone has
// used (so 3D still matches the rest offline), telling the page how far it
// has got. The page reloads only once all of it is in, so the new build
// opens at once and works offline. Any file failing (the connection gone)
// stops it, and the old build carries on as it was.
self.addEventListener('message', (e) => {
  if (e.data && e.data.t === 'update') e.waitUntil(update(e.source));
});

async function update(client) {
  const say = (m) => { if (client) client.postMessage(Object.assign({ t: 'update' }, m)); };
  try {
    const cache = await caches.open(VERSION);
    const old = await cache.keys();
    const urls = [...SHELL_URLS, ...old.map((r) => r.url).filter((u) => LAZY.test(new URL(u).pathname))];
    // each file weighed by its old copy's size (a guess where there is none)
    // so the bar moves with the bytes: the 3D textures dwarf the scripts
    const weight = await Promise.all(urls.map(async (u) => {
      const hit = await cache.match(u);
      return Math.max(4e3, (hit && +hit.headers.get('content-length')) || 3e4);
    }));
    const total = weight.reduce((a, b) => a + b, 0), got = weight.map(() => 0);
    let last = 0;
    const tell = (force) => {
      const now = Date.now();
      if (!force && now - last < 100) return;
      last = now;
      say({ p: Math.min(1, got.reduce((a, b) => a + b, 0) / total) });
    };
    tell(true);
    let next = 0;
    const one = async (i) => {
      const res = await fetch(urls[i], { cache: 'no-cache' });
      if (!res.ok) throw new Error(urls[i] + ' ' + res.status);
      const len = +res.headers.get('content-length') || 0, parts = [];
      let n = 0;
      if (res.body) {
        const rd = res.body.getReader();
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          parts.push(value); n += value.length;
          got[i] = Math.min(weight[i], weight[i] * n / (len || Math.max(n * 2, weight[i])));
          tell();
        }
      }
      // (the body is already unzipped, so it mustn't still say it's zipped)
      const head = new Headers(res.headers);
      head.delete('content-encoding'); head.delete('content-length');
      await cache.put(urls[i], new Response(new Blob(parts), { status: res.status, statusText: res.statusText, headers: head }));
      got[i] = weight[i];
      tell();
    };
    // four at a time
    await Promise.all([0, 1, 2, 3].map(async () => { while (next < urls.length) await one(next++); }));
    say({ p: 1, done: true });
  } catch (err) {
    say({ failed: true });
  }
}

function stripSearch(u) { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; }
