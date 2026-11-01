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
  'js/achievements.js',
  'js/render.js',
  'js/vr.js',
  'js/xr.js',
  'js/music.js',
  'js/net.js',
  'js/main.js',
  'img/billboard.jpg',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.registration.scope).href));
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
    if (res.ok && (nav || SHELL_URLS.has(stripSearch(req.url)))) await cache.put(key, res.clone());
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

function stripSearch(u) { const x = new URL(u); x.search = ''; x.hash = ''; return x.href; }
