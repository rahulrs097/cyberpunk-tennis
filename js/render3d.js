// The 3D view (Settings > Graphics > 3D): the rooftop drawn with three.js
// from the same camera as the flat view (render.js works the camera out
// each frame and this copies it). Lamp light, bloom on the neon, a 3D
// skyline. The players are today's vector characters, drawn each frame on a
// card that stands on the court facing you; the ball, its trail and the
// billboard are 3D too. The touch guides are drawn over it by render.js.
// Nothing here feeds back into the game.
//
// Game coordinates are x across, y down the court, z up; three.js has y up,
// so a game point (x, y, z) is (x, z, -y) here.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const CT = window.CT;
const V = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
// ?3d=lite: the lightest graphics level whatever Settings says (to compare speed)
const LITE = /[?&]3d=lite\b/.test(location.search);
// Graphics levels (render.js r.quality, r.max) for this theme: pixel ratio
// and whether the glow pass runs. Smooth draws straight to the screen.
// samples: anti-aliasing of the glow pass's buffer (costly on phones; the
// higher pixel ratios smooth edges anyway). small: 2048 px baked textures.
const LEVELS = [{ dpr: 1, bloom: false, small: true }, { dpr: 1, bloom: true, samples: 0, small: true }, { dpr: 1.25, bloom: true, samples: 2 }];
const MAX = { dpr: 2, bloom: true, samples: 4 };
// ?3d=plain: the simple lit scenery instead of the baked rooftop
const PLAIN = /[?&]3d=plain\b/.test(location.search);
// The baked rooftop (made in Blender: art/rooftop-bake/). Its light is in
// the textures, so it needs no live lights.
const BAKED = 'models/rooftop/';
// the longest the view waits for its files before showing what it has (ms)
const LOAD_WAIT = 12000;
// the ground picture's extent in game metres (bake.py GX0.. GY1)
const GROUND = { x0: -30, x1: 30, y0: -21.8, y1: 17.8 };

// HDR colour: above 1 it blooms
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

function dispose(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of Object.keys(m)) if (m[k] && m[k].isTexture && m[k] !== radial && m[k] !== blob) m[k].dispose();
      m.dispose();
    }
  });
}

export function create3d(r, R) {
  const { COURT: C, hash } = R;
  let small = false;   // the 2048 px bake (see loadBaked below)
  const canvas = document.createElement('canvas');
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  gl.info.autoReset = false;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 0.9;
  gl.shadowMap.enabled = !LITE && PLAIN;   // only the plain scenery has live shadows
  gl.shadowMap.type = THREE.PCFShadowMap;
  gl.shadowMap.autoUpdate = false;   // the scenery that casts shadows never moves
  gl.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x140a24, 0.011);
  {
    const pm = new THREE.PMREMGenerator(gl);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.12;
    pm.dispose();
  }

  const sky = buildSky(scene, hash), moon = sky.moon;
  const skyline = buildSkyline(scene, hash);
  // the simple lit scenery, until (or unless) the baked rooftop has loaded
  const plain = new THREE.Group();
  scene.add(plain);
  buildDeck(plain, R);
  buildLamps(plain, R.LAMPS, LITE);
  buildCars(plain, R.CARS, hash);
  const court = buildCourt(scene, C);
  const net = buildNet(scene, C);
  buildLampGlows(scene, R.LAMPS);
  // the Rain 3D theme (r.wet): falling rain, and the baked ground and lines
  // swapped for wet ones once the bake has loaded
  const rain = buildRain(scene);
  let baked = null, skyTex = null, wet = null;
  // Until the whole look has loaded (the baked rooftop, its cars, the city,
  // the scanned asphalt and rust) the view isn't shown: render.js draws a
  // plain night sky meanwhile, so the simple stand-in scenery and the flat
  // theme never flash up before it (Rahul, 2026-11-27). After LOAD_WAIT
  // it shows whatever has come, so a slow network still gets a picture.
  const loads = [];
  let complete = PLAIN, warm = false, self3dProgress = () => 1;
  if (!PLAIN) {
    // the lower graphics levels (and Auto on a modest phone) load the 2048 px bake: a quarter of the memory
    small = LITE || (!r.max && r.quality < 2);
    loads.push(loadBaked(scene, small, R).then((b) => {
      baked = b;
      scene.remove(plain);
      dispose(plain);   // free its meshes and textures on the GPU too
      gl.shadowMap.enabled = false;
      if (scene.environment) scene.environment.dispose();
      scene.environment = null;   // (only the plain cars' paint used it)
    }).catch((e) => console.warn('baked rooftop unavailable', e)));
    loads.push(loadSkyline(scene).then((t) => { skyTex = t; scene.remove(skyline, moon); dispose(skyline); dispose(moon); })
      .catch((e) => console.warn('baked skyline unavailable', e)));
    for (const f of ['asphalt.jpg', 'asphalt_nor.jpg', 'post_rust.jpg']) loads.push(fileTex('models/rain/' + f).loaded);
    let left = loads.length;
    for (const l of loads) l.then(() => { left--; });
    const total = loads.length;
    self3dProgress = () => 1 - left / total;
    Promise.race([Promise.all(loads), new Promise((res) => setTimeout(res, LOAD_WAIT))]).then(() => { complete = true; });
  }
  const board = buildBoard(scene, R);
  const players = [0, 1].map(() => buildPlayer(scene, R.LAMPS));
  const ball = buildBall(scene);

  const cam = new THREE.PerspectiveCamera(50, 1, 0.3, 2400);
  const storm = buildStorm(scene, cam, hash);
  // the composer draws into a multisampled target, so edges stay smooth
  let composer, bloom;
  function makeComposer(w, h, dpr, samples) {
    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples });
    composer = new EffectComposer(gl, rt);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, cam));
    {
      bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.14, 0.3, 1.2);
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());
  }

  // dry or wet; when wet, what the puddles mirror this frame
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  // Concrete 3D and Rain 3D share the scanned asphalt, worn lines, steel net
  // posts and wire net once the bake has loaded; Rain adds water and glow
  const look = {};
  function makeWet(on, now, r) {
    rain.visible = on;
    // Auto steps the graphics level down on a phone that can't keep up (and
    // Smooth has no glow pass); here the rain thins with it, and Cardboard VR,
    // drawing every frame twice, gets the least
    const lite = !!r.vr || r.quality === 0;
    // (and in a match with the storm on, the rain only starts with the first winner's lightning)
    const pour = r.storm ? r.storm.pour : 1;
    rain.geometry.setDrawRange(0, 2 * Math.round(RAIN_N * pour * (r.vr ? 0.35 : r.quality === 0 ? 0.45 : r.quality === 1 ? 0.7 : 1)));
    if (on) rain.material.uniforms.time.value = (now / 1000) % 1000, rain.material.uniforms.cam.value.copy(cam.position);
    board.setWet(on);
    if (!baked) return;
    if (baked.cars) {
      const d = baked.cars.material.userData;
      d.wet.value = on ? 1 : 0;
      if (d.cam) d.cam.value.copy(cam.position);
    }
    const k = on ? 'wet' : 'dry';
    if (!look[k]) {
      const ground = groundMaterial(baked.ground, baked.grain, R.LAMPS, on);
      look[k] = { ground, lines: wornLines(court.mat, baked.grain, ground.uniforms.asphalt.value, on), net: wireNetMaterial(C, on) };
    }
    if (!look.posts) {
      look.posts = buildMetalPosts(scene, C);
      for (const p of net.posts) p.visible = false;
    }
    wet = look[k];
    baked.deck.material = wet.ground;
    for (const m of court.meshes) m.material = wet.lines;
    net.mesh.material = wet.net;
    const u = wet.ground.uniforms;
    u.camPos.value.copy(cam.position);
    if (!on) return;
    u.time.value = (now / 1000) % 1000;
    u.rainAmt.value = r.storm ? r.storm.pour : 1;
    u.sky.value = skyTex; u.skyOn.value = skyTex ? 1 : 0;
    board.sign.updateWorldMatrix(true, false);
    u.board.value = board.tex; u.boardInv.value.copy(board.sign.matrixWorld).invert();
    // (at the lite levels the puddles mirror only the sky and city: no billboard, players or ball)
    u.boardOn.value = lite ? 0 : board.on() * 1.6;   // (brighter in the rain, as Rain's board is)
    u.boardSize.value.set(R.BOARD.w, R.BOARD.h);
    players.forEach((pl, i) => {
      const c = pl.card;
      u.cardOn.value[i] = c.visible && !lite ? 1 : 0;
      u['card' + i].value = pl.tex;
      // the card stood upright, turned to the camera only round the vertical:
      // a sprite tilted back with the camera would mirror leaning over
      tmpQ.setFromAxisAngle(UP, Math.atan2(cam.position.x - c.position.x, cam.position.z - c.position.z));
      u.cardInv.value[i].copy(tmpM.compose(c.position, tmpQ, ONE.clone().setScalar(c.scale.x))).invert();
    });
    u.ballOn.value = ball.mesh.visible && !lite ? 1 : 0;
    u.ball.value.set(ball.mesh.position.x, ball.mesh.position.y, ball.mesh.position.z, ball.mesh.scale.x);
  }

  // back from another app: repaint the painted textures and send the
  // billboard and players again (and once more if the chip's context was
  // lost and comes back later)
  function refresh() {
    repaintAll();
    board.refresh();
    for (const p of players) p.refresh();
  }
  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', refresh);

  let level = null, levelKey = '';
  const key = (r) => `${r.quality}|${r.max}|${r.W}x${r.H}|${r.vr ? r.dpr : ''}`;
  const self = {
    ready: true, canvas, refresh,
    // everything loaded, and drawn once out of sight (so the shaders are
    // built before it is seen): render.js shows the view only then
    loaded: () => complete && warm,
    progress: () => (complete ? 1 : self3dProgress()),
    // ?prof: what the last frame cost the GPU, roughly
    stats() {
      const i = gl.info;
      return { calls: i.render.calls, tris: i.render.triangles, tex: i.memory.textures, geo: i.memory.geometries,
        dpr: gl.getPixelRatio(), glow: level && level.bloom ? `glow aa${level.samples}` : 'no glow', bake: small ? '2k' : '4k' };
    },
    resize(r) {
      // VR draws two eyes a frame on a phone, so never with glow; the
      // sharpness follows the VR graphics setting (Smooth 1x, Sharp 1.5x)
      level = r.vr ? { dpr: r.dpr, bloom: false } : LITE ? LEVELS[0] : r.max ? MAX : LEVELS[r.quality] || LEVELS[2];
      levelKey = key(r);
      const dpr = Math.min(level.dpr, window.devicePixelRatio || 1);
      gl.setPixelRatio(dpr);
      gl.setSize(r.W, r.H);
      if (composer) composer.renderTarget1.dispose(), composer.renderTarget2.dispose(), composer = null;
      if (level.bloom) makeComposer(r.W, r.H, dpr, level.samples);
    },
    draw(r, g, human, now) {
      gl.info.reset();   // counted over all the passes (?prof)
      // Auto graphics steps r.quality down (or back) while playing
      if (levelKey !== key(r)) self.resize(r);
      setCamera(cam, r);
      const f = human === 1 ? -1 : 1;
      board.update(r, f);
      for (const p of g.players) players[p.side].update(r, g, p, r.view === 'first' && p.side === human, cam);
      ball.update(r, g, cam);
      makeWet(!!r.wet, now, r);
      storm.update(r, now, f, sky.stars, !!r.wet);
      if (composer) composer.render(); else gl.render(scene, cam);
      if (complete) warm = true;
    },
  };
  self.resize(r);
  return self;
}

// The flat view's pinhole camera (r.cam: position, look-at point, focal
// length f in CSS pixels, centre cx, cy, which sits below the scoreboard)
// as a three.js camera with the same picture.
function setCamera(cam, r) {
  const c = r.cam, near = cam.near, far = cam.far;
  cam.position.set(c.x, c.z, -c.y);
  cam.up.set(0, 1, 0);
  cam.lookAt(c.lx, c.lz, -c.ly);
  cam.updateMatrixWorld();
  const k = near / c.f;
  cam.projectionMatrix.makePerspective(-c.cx * k, (r.W - c.cx) * k, c.cy * k, -(r.H - c.cy) * k, near, far);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

// Image textures loaded once and shared; each one's load is tracked, so
// the view can wait for them before it is first shown (see `complete`)
const FILES = new Map();
function fileTex(url) {
  let f = FILES.get(url);
  if (!f) {
    let done;
    const loaded = new Promise((res) => { done = res; });
    const t = new THREE.TextureLoader().load(url, () => done(true), undefined, () => done(false));
    FILES.set(url, f = { t, loaded });
  }
  return f;
}

// Every texture painted here keeps its painter, so it can be painted again.
// On a phone, switching apps can lose the graphics chip's copy of everything
// (three.js then uploads each texture again from its canvas) and Chrome can
// also wipe GPU-backed 2D canvases, which left the felt ball solid black.
// So these canvases are kept in ordinary memory (willReadFrequently), and
// all of them are repainted and sent again when the page comes back.
const PAINTED = new Set();
function repaint(p) {
  const ctx = p.cv.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, p.cv.width, p.cv.height);
  p.draw(ctx, p.cv.width, p.cv.height);
  p.t.needsUpdate = true;
}
function repaintAll() { for (const p of PAINTED) repaint(p); }

function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d', { willReadFrequently: true }), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  const p = { cv, draw, t };
  PAINTED.add(p);
  cv.addEventListener('contextrestored', () => repaint(p));
  t.addEventListener('dispose', () => PAINTED.delete(p));
  return t;
}

const radial = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const blob = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0.8)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

// a shadow cast along the ground: darkest at the feet (the texture's top),
// soft at the sides, fading out towards its far end
const castTex = canvasTex(64, 128, (g) => {
  const id = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const t = y / 127, sx = Math.abs(x - 31.5) / 32;
    const w = 1 - t * 0.45;   // narrower towards the tip
    const side = Math.max(0, 1 - Math.pow(sx / w, 2));
    const a = Math.min(1, 1.25 * side * Math.pow(1 - t, 0.8) * Math.min(1, (t + 0.04) / 0.1));
    id.data[(y * 64 + x) * 4 + 3] = Math.round(255 * a);
  }
  g.putImageData(id, 0, 0);
});

function flat(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.copy(V(x, y, z));
  return m;
}

// ---------------- sky ----------------
function buildSky(scene, hash) {
  const tex = canvasTex(16, 512, (g) => {
    const gr = g.createLinearGradient(0, 0, 0, 512);
    gr.addColorStop(0, '#02030a'); gr.addColorStop(0.4, '#0a0d26'); gr.addColorStop(0.485, '#2b1645');
    gr.addColorStop(0.505, '#4a1d4f'); gr.addColorStop(1, '#120818');
    g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.userData.clear = tex;
  scene.add(dome);
  const pts = [];
  for (let i = 0; i < 1400; i++) {
    const a = hash(i * 1.7) * Math.PI * 2, e = 0.05 + hash(i * 2.3 + 9) * 1.4;
    pts.push(Math.cos(a) * Math.cos(e) * 1000, Math.sin(e) * 1000, Math.sin(a) * Math.cos(e) * 1000);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe6ebff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 }));
  stars.renderOrder = -3;   // (behind the storm's clouds and the city)
  scene.add(stars);
  // the moon, ahead and to the right, a little above the skyline
  const dir = V(Math.sin(0.45), Math.cos(0.45), 0).normalize();
  const at = (d, h) => dir.clone().multiplyScalar(d).setY(h);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 24, 12), new THREE.MeshBasicMaterial({ color: hdr(0xe8ecff, 1.5), fog: false }));
  moon.position.copy(at(900, 190));
  scene.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: 0x8890c0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.copy(moon.position); halo.scale.setScalar(180);
  scene.add(halo);
  const g = new THREE.Group(); g.add(moon, halo);
  scene.remove(moon, halo); scene.add(g);
  return { moon: g, dome, stars };
}

// ---------------- Rain 3D's storm ----------------
// Clouds that roll in as winners pile up, lightning just after a winner and
// a faint flash over everything (render.js stormEvent says when). Clouds:
// one dome with a tiling noise seen as a flat layer overhead, so it
// thickens towards the horizon. Nothing here is drawn in a clear sky.
function cloudTex(hash) {
  const N = 256, v = new Float32Array(N * N);
  for (const [f, a] of [[4, 0.5], [8, 0.25], [16, 0.14], [32, 0.07], [64, 0.04]]) {
    const g = Array.from({ length: f * f }, (_, i) => hash(i * 1.37 + f * 7.1));
    const at = (i, j) => g[((j % f + f) % f) * f + ((i % f + f) % f)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * f, fy = (y / N) * f, i = Math.floor(fx), j = Math.floor(fy);
      let tx = fx - i, ty = fy - j; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      v[y * N + x] += a * ((at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty);
    }
  }
  const t = canvasTex(N, N, (c) => {
    const im = c.createImageData(N, N);
    for (let i = 0; i < N * N; i++) { const k = Math.max(0, Math.min(255, (v[i] - 0.1) * 255 / 0.85)); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = k; im.data[i * 4 + 3] = 255; }
    c.putImageData(im, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// a strike's envelope: a bright stroke and a few return strokes, about half
// a second; for someone who asked their phone for less motion, one soft swell
const PULSES = [[0, 1], [0.07, 0.55], [0.19, 0.85], [0.34, 0.35]];
function flashAt(t, calm) {
  if (t < 0) return 0;
  if (calm) return t < 0.8 ? 0.45 * Math.sin(Math.PI * t / 0.8) : 0;
  let e = 0;
  for (const [s, a] of PULSES) if (t >= s) e += a * Math.exp(-(t - s) / 0.045);
  return Math.min(1, e);
}

function buildStorm(scene, cam, hash) {
  const grp = new THREE.Group();
  grp.visible = false;
  scene.add(grp);
  const u = {
    map: { value: cloudTex(hash) }, cover: { value: 0 }, drift: { value: 0 },
    flash: { value: 0 }, flashDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
  };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(950, 48, 16, 0, Math.PI * 2, 0, THREE.MathUtils.degToRad(88)), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D map; uniform float cover, drift, flash; uniform vec3 flashDir; varying vec3 vDir;
      void main() {
        // the layer seen as a flat ceiling, so it bunches up towards the horizon
        vec2 p = vDir.xz / (vDir.y + 0.12) * 0.22 + vec2(drift, drift * 0.35);
        float n = texture2D(map, p).r * 0.7 + texture2D(map, p * 2.7 + 0.3).r * 0.3;
        float a = smoothstep(1.0 - cover * 1.15, 1.15 - cover * 1.15, n) * smoothstep(0.02, 0.16, vDir.y);
        // dark, a little purple from the city below; lit from inside by a strike
        vec3 c = mix(vec3(0.075, 0.045, 0.1), vec3(0.03, 0.032, 0.05), smoothstep(0.08, 0.5, vDir.y)) * (0.35 + 1.3 * n * n);
        float near = pow(max(dot(vDir, flashDir), 0.0), 6.0);
        c += flash * vec3(0.5, 0.55, 0.8) * (0.06 + 1.3 * near) * n * n * 1.6;
        gl_FragColor = vec4(c, a * 0.96);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  clouds.renderOrder = -2;   // after the stars, before the city strip
  grp.add(clouds);

  // the bolt: a jagged ribbon from the cloud base to the city, rebuilt each strike
  const boltMat = new THREE.MeshBasicMaterial({ color: hdr(0xdfe6ff, 5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
  bolt.frustumCulled = false;
  bolt.renderOrder = 2;
  grp.add(bolt);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: 0x9fb0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  grp.add(glow);
  function makeBolt(dir, dist, seed) {
    let k = seed * 13.1;
    const rnd = () => hash(k += 1.618) - 0.5;
    const side = new THREE.Vector3(-dir.z, 0, dir.x);   // across the view
    // a far strike is shorter and finer on the screen; it goes down into the city, never onto a roof near us
    const far = (dist - 150) / 550;
    const top = dist * (0.42 - 0.2 * far), bot = 2 + dist * 0.02, w = 0.3 + dist * 0.0015;
    const pos = [];
    const strand = (from, to, n, width, wander) => {
      let prev = from.clone();
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const p = from.clone().lerp(to, t);
        if (i < n) p.addScaledVector(side, rnd() * wander).y += rnd() * wander * 0.3;
        const ww = width * (1 - t * 0.5);
        const a0 = prev.clone().addScaledVector(side, -ww), a1 = prev.clone().addScaledVector(side, ww);
        const b0 = p.clone().addScaledVector(side, -ww), b1 = p.clone().addScaledVector(side, ww);
        pos.push(...a0.toArray(), ...a1.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...b0.toArray());
        if (i === Math.round(n * 0.35) || i === Math.round(n * 0.6)) branch.push(p.clone());
        prev = p;
      }
    };
    const branch = [];
    const start = dir.clone().multiplyScalar(dist).setY(top), end = dir.clone().multiplyScalar(dist).setY(bot);
    end.addScaledVector(side, rnd() * dist * 0.15);
    strand(start, end, 14, w, dist * 0.05);
    for (const b of branch.slice(0, 2)) {
      const to = b.clone().addScaledVector(side, rnd() * dist * 0.25).setY(b.y - (top - bot) * (0.2 + 0.15 * (rnd() + 0.5)));
      strand(b, to, 6, w * 0.45, dist * 0.03);
    }
    bolt.geometry.dispose();
    bolt.geometry = new THREE.BufferGeometry();
    bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    glow.position.copy(start);
    glow.scale.setScalar(dist * 0.5);
  }

  // a faint wash of light over the whole view in the flash, in front of the camera
  const wash = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0xb8c4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  wash.position.z = -0.5;
  wash.renderOrder = 10;
  wash.visible = false;
  cam.add(wash);
  scene.add(cam);

  let cur = null, lastT = 0;
  return {
    update(r, now, f, stars, on) {
      const s = r.storm;
      grp.visible = on && !!s && (s.cover > 0.005 || s.clouds > 0 || !!cur);
      wash.visible = false;
      stars.material.opacity = 0.75;
      if (!on || !s) return;
      const t = now / 1000, dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      // the clouds roll in (or drift off) over a few seconds
      s.cover += (s.clouds - s.cover) * Math.min(1, dt * 0.35);
      if (s.rainFrom && t >= s.rainFrom) { s.rain = 1; s.rainFrom = 0; }
      s.pour += (s.rain - s.pour) * Math.min(1, dt * 0.45);   // the rain sets in over a few seconds
      u.cover.value = s.cover;
      u.drift.value = (t * 0.004) % 100;
      stars.material.opacity = 0.75 * (1 - Math.min(1, s.cover * 1.4));
      if (s.strikes.length && t >= s.strikes[0].at) {
        cur = s.strikes.shift();
        // somewhere ahead over the city, left or right of the far end
        const a = (hash(cur.n * 3.7 + 1) - 0.5) * 0.8;
        cur.dir = V(Math.sin(a) * f, Math.cos(a) * f, 0).normalize();
        makeBolt(cur.dir, cur.dist, cur.n + 1);
        u.flashDir.value.copy(cur.dir).setY(0.35).normalize();
      }
      let e = 0;
      if (cur) {
        const age = t - cur.at;
        e = flashAt(age, CT.CALM);
        if (age > 1) cur = null;
      }
      const k = cur ? 1 - (cur.dist - 150) / 550 * 0.6 : 0;   // a near strike lights more
      u.flash.value = e * k;
      boltMat.opacity = Math.min(1, e * 1.6);
      bolt.visible = !!cur;
      glow.material.opacity = e * 0.6;
      glow.visible = !!cur;
      wash.visible = e > 0.01;
      wash.material.opacity = e * k * (r.vr ? 0.035 : 0.06);
    },
  };
}

// a soft glow round each lamp head, which bloom can't make on its own on a small screen
function buildLampGlows(scene, LAMPS) {
  for (const [x, y, col] of LAMPS) {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: new THREE.Color(col), transparent: true, opacity: /ffb04a/i.test(col) ? 0.4 : 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.copy(V(x * 0.75, y, 7.3)); glow.scale.set(2.4, 1.4, 1);
    scene.add(glow);
  }
}

// ---------------- the baked rooftop ----------------
// A baked texture shown as it is, a little brighter, and its brightest
// parts (lamp lenses, neon strips, car lights, bulbs) pushed above white
// so the bloom catches them.
// detail = { map, repeat: [u, v], amount }: a tiling grain multiplied over the
// bake, so a smooth bake reads as rough concrete close up instead of glass
function bakedMaterial(map, gain = 1.0, hot = 3, detail = null) {
  const m = new THREE.MeshBasicMaterial({ map });
  m.onBeforeCompile = (sh) => {
    let head = `#define BAKE_GAIN ${gain.toFixed(2)}\n#define BAKE_HOT ${hot.toFixed(2)}\n`;
    let grain = '';
    if (detail) {
      sh.uniforms.detailMap = { value: detail.map };
      head += `uniform sampler2D detailMap;\n`;
      grain = `
      vec3 dt = texture2D(detailMap, vMapUv * vec2(${detail.repeat[0].toFixed(2)}, ${detail.repeat[1].toFixed(2)})).rgb;
      diffuseColor.rgb *= 1.0 + (dt.r - 0.5) * ${(detail.amount * 2).toFixed(2)};
      float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), ${(detail.desat || 0).toFixed(2)});`;
    }
    sh.fragmentShader = head + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float peak = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
      diffuseColor.rgb *= BAKE_GAIN + BAKE_HOT * smoothstep(0.8, 1.0, peak);${grain}`);
  };
  return m;
}

// a tiling concrete grain: blotches, fine sand, pits and pale aggregate, mean 0.5
function concreteTex(size = 512) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const v = new Float32Array(size * size);
  // periodic value noise, so the tile wraps without a seam
  for (const [f, a] of [[4, 0.35], [8, 0.25], [16, 0.18], [32, 0.12], [64, 0.08]]) {
    const g = Array.from({ length: f * f }, rnd);
    const at = (i, j) => g[((j % f + f) % f) * f + ((i % f + f) % f)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * f, fy = (y / size) * f, i = Math.floor(fx), j = Math.floor(fy);
      let tx = fx - i, ty = fy - j; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const n = (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
      v[y * size + x] += (n - 0.5) * a;
    }
  }
  for (let i = 0; i < v.length; i++) v[i] += (rnd() - 0.5) * 0.22;   // sand
  for (let k = 0; k < size * size / 90; k++) {                        // pits and aggregate
    const i = Math.floor(rnd() * v.length), d = rnd() < 0.6 ? -0.35 : 0.25;
    v[i] += d; if (rnd() < 0.5) v[(i + 1) % v.length] += d * 0.6;
  }
  return canvasTex(size, size, (g) => {
    const id = g.createImageData(size, size);
    for (let i = 0; i < v.length; i++) {
      const c = Math.max(0, Math.min(255, 128 + v[i] * 255));
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = c; id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
}

async function loadBaked(scene, small, R) {
  const tl = new THREE.TextureLoader();
  const tex = (f) => tl.loadAsync(BAKED + f).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
  const [ground, atlas, gltf] = await Promise.all([tex(small ? 'ground_2k.jpg' : 'ground.jpg'), tex(small ? 'props_2k.jpg' : 'props.jpg'), new GLTFLoader().loadAsync(BAKED + 'props.glb')]);
  atlas.flipY = false;   // glTF's UVs run top-down
  const G = GROUND;
  const grain = concreteTex();
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 4;
  // (shown until the scanned ground is ready: groundMaterial)
  const dry = bakedMaterial(ground, 0.85, 0, { map: grain, repeat: [(G.x1 - G.x0) / 2.5, (G.y1 - G.y0) / 2.5], amount: 0.4, desat: 0.15 });
  const deck = flat(new THREE.PlaneGeometry(G.x1 - G.x0, G.y1 - G.y0), dry, (G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2, 0);
  // the roof beyond the baked part, dark
  // (only either side of the bake: a plane under the whole deck fought it for
  // depth, as dark bands flickering past the net where the screen's depth
  // buffer is coarse, as it is on phones at Smooth, which draws straight to it)
  const dark = new THREE.MeshBasicMaterial({ color: 0x07070b });
  const side = 45 + G.x0, beyond = new THREE.Group();
  for (const x of [-45 + side / 2, 45 - side / 2]) beyond.add(flat(new THREE.PlaneGeometry(side, G.y1 - G.y0), dark, x, (G.y0 + G.y1) / 2, 0));
  const mat = bakedMaterial(atlas);
  gltf.scene.traverse((o) => { if (o.isMesh) o.material = mat; });
  scene.add(beyond, deck, gltf.scene);
  const out = { deck, dry, ground, grain, cars: null };
  // (the roof is ready with or without the cars)
  await loadCars(scene, R, small).then((m) => { out.cars = m; }).catch((e) => console.warn('cars unavailable', e));
  return out;
}

// Poly Haven's scanned covered car (CC0, tools/rooftop-bake/README.md) in a
// third of the bays the bake parks a car in (tools/rooftop-bake/covered_car.py
// took those baked cars out). One instanced draw. The roof has no live lights, so its
// shader lights the tarp itself from the six lamps.
async function loadCars(scene, R, small) {
  const tl = new THREE.TextureLoader();
  const [gltf, map, nor] = await Promise.all([new GLTFLoader().loadAsync(BAKED + 'car.glb'), tl.loadAsync(BAKED + 'car.jpg'), tl.loadAsync(BAKED + 'car_nor.jpg')]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, nor]) { t.flipY = false; t.anisotropy = small ? 2 : 4; }
  let geo = null;
  gltf.scene.traverse((o) => { if (o.isMesh) geo = o.geometry; });
  const { hash } = R;
  // the bake's bays: R.CARS, and the outer rows by the roof's sides (tools/rooftop-bake/scene.py)
  const cars = R.CARS.map((c) => ({ ...c, face: c.sx }));
  for (const sx of [-1, 1]) {
    for (let y = -19.5, k = 100; y < 17.5 - 2.6; y += 2.6, k++) {
      if (hash(k * 2.7 + sx) >= 0.45 && !(sx > 0 && y > 6.5 && y < 15.5)) cars.push({ x: sx * (16.5 + 2.15 + hash(k * 1.9) * 0.3), y: y + 1.3, k, face: -sx });
    }
  }
  // about a third of the bays covered, the rest left as the baked open cars
  // (the same pick as tools/rooftop-bake/covered_car.py)
  const covered = cars.filter((c) => hash(c.k * 8.3 + c.face * 1.7) < 0.35);
  const wet = { value: 0 };
  const m = new THREE.MeshBasicMaterial({ map });
  m.userData.wet = wet;
  const lamps = R.LAMPS.map(([x, y]) => V(x * 0.75, y, 7.37));
  const cols = R.LAMPS.map(([, , c]) => new THREE.Color(c));
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { norMap: { value: nor }, lampPos: { value: lamps }, lampCol: { value: cols }, wet, camPos2: { value: new THREE.Vector3() } });
    m.userData.cam = sh.uniforms.camPos2;
    sh.vertexShader = 'varying vec3 vWP, vWN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      mat4 wm = modelMatrix;
      #ifdef USE_INSTANCING
      wm = wm * instanceMatrix;
      #endif
      vWP = (wm * vec4(transformed, 1.0)).xyz;
      vWN = normalize(mat3(wm) * normal);`);
    sh.fragmentShader = `varying vec3 vWP, vWN;
      uniform sampler2D norMap; uniform vec3 lampPos[${lamps.length}], lampCol[${lamps.length}], camPos2; uniform float wet;
      ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      // the tarp's folds: its normal map in a frame built from the screen derivatives (no tangents)
      vec3 n = normalize(vWN) * (gl_FrontFacing ? 1.0 : -1.0);
      {
        vec3 dp1 = dFdx(vWP), dp2 = dFdy(vWP); vec2 du1 = dFdx(vMapUv), du2 = dFdy(vMapUv);
        vec3 t = cross(dp2, n) * du1.x + cross(n, dp1) * du2.x;
        vec3 b = cross(dp2, n) * du1.y + cross(n, dp1) * du2.y;
        float s = inversesqrt(max(max(dot(t, t), dot(b, b)), 1e-12));
        vec3 tn = texture2D(norMap, vMapUv).xyz * 2.0 - 1.0;
        n = normalize(t * s * tn.x + b * s * tn.y + n * tn.z);
      }
      vec3 v = normalize(camPos2 - vWP);
      vec3 alb = diffuseColor.rgb * mix(1.0, 0.6, wet);
      // night sky and the glow of the city from above, the dark deck from below
      vec3 lit = mix(vec3(0.03, 0.025, 0.05), vec3(0.10, 0.09, 0.16), n.y * 0.5 + 0.5);
      vec3 spec = vec3(0.0);
      for (int i = 0; i < ${lamps.length}; i++) {
        vec3 L = lampPos[i] - vWP; float d2 = dot(L, L); L *= inversesqrt(d2);
        vec3 c = lampCol[i] * (60.0 / (d2 + 6.0));
        lit += c * max(dot(n, L), 0.0);
        // a wet tarp catches the lamps
        spec += c * pow(max(dot(n, normalize(L + v)), 0.0), mix(12.0, 60.0, wet)) * mix(0.04, 0.5, wet);
      }
      diffuseColor.rgb = alb * lit + spec;`);
  };
  const inst = new THREE.InstancedMesh(geo, m, covered.length);
  const o = new THREE.Object3D();
  covered.forEach((c, i) => {
    o.position.copy(V(c.x, c.y, 0));
    // lengthways across the roof, nose to the court, as the bake had them
    o.rotation.set(0, (c.face > 0 ? Math.PI / 2 : -Math.PI / 2) + (hash(c.k * 6.1) - 0.5) * 0.06, 0);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  });
  inst.computeBoundingSphere();
  scene.add(inst);
  return inst;
}

// towers round the horizon, windows as an emissive texture
function buildSkyline(scene, hash) {
  const wtex = (seed) => {
    const t = canvasTex(64, 256, (g) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 64, 256);
      for (let y = 2; y < 256; y += 6) for (let x = 2; x < 64; x += 5) {
        const h = hash(x * 0.37 + y * 1.91 + seed);
        if (h > 0.9) { g.fillStyle = h > 0.975 ? '#ff3fb4' : h > 0.945 ? '#25d9ff' : '#ffc878'; g.fillRect(x, y, 2, 3); }
      }
    });
    t.magFilter = THREE.NearestFilter;
    return t;
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const grp = new THREE.Group();
  scene.add(grp);
  scene = grp;
  for (let s = 0; s < 3; s++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x0b0819, roughness: 0.6, metalness: 0.3, emissive: 0xffffff, emissiveMap: wtex(s + 1), emissiveIntensity: 0.8, fog: false });
    const n = 70, m = new THREE.InstancedMesh(box, mat, n);
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + s * 0.03, d = 330 + s * 60 + hash(i * 3 + s) * 80;
      const w = 20 + hash(i + s * 50) * 30, h = 15 + hash(i * 3.3 + s) * (s === 0 ? 45 : 30) + s * 18;
      o.position.set(Math.cos(a) * d, h / 2 - 30, Math.sin(a) * d);
      o.scale.set(w, h, w); o.rotation.y = -a; o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    scene.add(m);
  }
  return grp;
}

// The baked skyline (tools/rooftop-bake/skyline.py): an equirectangular
// strip from LAT0 to LAT1 degrees round the court, its centre straight down
// the court (+y), on a band of a big sphere.
function loadSkyline(scene) {
  const LAT0 = -4, LAT1 = 14, R = 1000, NU = 96, NV = 6, DIM = 0.7;   // must match tools/rooftop-bake/skyline.py
  // a real city at night: Poly Haven's Shanghai Bund HDRI (CC0), its Pudong
  // skyline cut into the same strip (tools/rooftop-bake/README.md)
  return new THREE.TextureLoader().loadAsync(BAKED + 'skyline_city.png').then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NV; j++) {
      const lat = THREE.MathUtils.degToRad(LAT0 + ((LAT1 - LAT0) * j) / NV);
      for (let i = 0; i <= NU; i++) {
        const a = (i / NU - 0.5) * Math.PI * 2;   // + is to the right (+x)
        const p = V(Math.sin(a) * Math.cos(lat) * R, Math.cos(a) * Math.cos(lat) * R, Math.sin(lat) * R + 5);
        pos.push(p.x, p.y, p.z); uv.push(i / NU, j / NV);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + NU + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(DIM, DIM, DIM), transparent: true, fog: false, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = -1;
    scene.add(m);
    // the dark streets carry on below the strip, so from the higher chase camera
    // the city never floats on sky
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(R * Math.cos(LAT0 * Math.PI / 180), R * 0.1, R * 0.99, NU, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(26 / 255 * DIM, 17 / 255 * DIM, 34 / 255 * DIM, THREE.SRGBColorSpace), transparent: true, fog: false, depthWrite: false, side: THREE.DoubleSide }));   // transparent: drawn after the sky, like the strip
    skirt.position.y = 5 + R * Math.sin(LAT0 * Math.PI / 180) - R * 0.495;
    skirt.renderOrder = -1;
    scene.add(skirt);
    return t;
  });
}

// ---------------- the roof ----------------
function noiseTex(size, base, amp, seed, hash) {
  const t = canvasTex(size, size, (g) => {
    const id = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = base + (hash(i * 0.731 + seed) - 0.5) * amp + (hash(Math.floor(i / 7) * 0.13 + seed) - 0.5) * amp * 0.6;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = Math.max(0, Math.min(255, v));
      id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildDeck(scene, R) {
  const { LOT_EDGE, LOT_BACK, COURT: C, hash } = R;
  const rough = noiseTex(256, 150, 120, 4, hash);
  rough.repeat.set(30, 15);
  const deck = flat(new THREE.PlaneGeometry(90, LOT_EDGE - LOT_BACK), new THREE.MeshStandardMaterial({ color: 0x1b1c26, roughness: 0.75, roughnessMap: rough, metalness: 0.1 }), 0, (LOT_EDGE + LOT_BACK) / 2, 0);
  deck.receiveShadow = true;
  scene.add(deck);
  for (const y of [LOT_EDGE, LOT_BACK]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(90, 1, 0.3), new THREE.MeshStandardMaterial({ color: 0x1c1b2a, roughness: 0.8 }));
    p.position.copy(V(0, y, 0.5)); p.receiveShadow = true; scene.add(p);
    const s = new THREE.Mesh(new THREE.BoxGeometry(90, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.4, 3) }));
    s.position.copy(V(0, y, 1.03)); scene.add(s);
  }
  // parking bays and the yellow dashes
  const bay = new THREE.MeshBasicMaterial({ color: 0x77756a });
  const bayG = new THREE.PlaneGeometry(R.STALL_OUT - R.STALL_IN, 0.08);
  for (const sx of [-1, 1]) for (let y = -19.5; y <= LOT_EDGE - 0.5; y += R.STALL_W) scene.add(flat(bayG, bay, sx * (R.STALL_IN + R.STALL_OUT) / 2, y, 0.01));
  const dash = new THREE.MeshBasicMaterial({ color: 0x9a7a1c });
  const dashG = new THREE.PlaneGeometry(0.1, 0.6);
  for (const sx of [-1, 1]) for (let y = LOT_BACK; y < LOT_EDGE; y += 1.2) scene.add(flat(dashG, dash, sx * C.PARK, y + 0.3, 0.01));
  // the court's paint
  const surround = flat(new THREE.PlaneGeometry(2 * C.DW + 2.4, 2 * C.HL + 5), new THREE.MeshStandardMaterial({ color: 0x17294a, roughness: 0.55, roughnessMap: rough }), 0, 0, 0.004);
  const inner = flat(new THREE.PlaneGeometry(2 * C.SW, 2 * C.HL), new THREE.MeshStandardMaterial({ color: 0x1b3a66, roughness: 0.5, roughnessMap: rough }), 0, 0, 0.007);
  surround.receiveShadow = inner.receiveShadow = true;
  scene.add(surround, inner);
}

function buildCourt(scene, C) {
  const D = C.DW, L = C.HL, S = C.SW, B = 2 * C.LW;
  const lines = [[-D, -L, D, -L, B], [-D, L, D, L, B], [-D, -L, -D, L], [D, -L, D, L], [-S, -L, -S, L], [S, -L, S, L],
    [-S, -C.SL, S, -C.SL], [-S, C.SL, S, C.SL], [0, -C.SL, 0, C.SL], [0, -L, 0, -L + 0.3], [0, L, 0, L - 0.3]];
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.95, 1.0) });
  const meshes = [];
  for (const [x1, y1, x2, y2, w0 = C.LW] of lines) {
    const w = Math.max(w0, 0.07);   // a touch wider than real, so far lines don't break up
    const len = Math.hypot(x2 - x1, y2 - y1) + w;
    const along = x1 === x2;
    const m = flat(new THREE.PlaneGeometry(along ? w : len, along ? len : w), mat, (x1 + x2) / 2, (y1 + y2) / 2, 0.011);
    meshes.push(m);
    scene.add(m);
  }
  return { mat, meshes };
}

function buildNet(scene, C) {
  const X = C.POST_X, N = 32;
  const top = (x) => CT.netHeight(x);
  // the mesh: a grid texture on a sheet whose top follows the sag
  const geo = new THREE.PlaneGeometry(2 * X, 1, N, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), up = pos.getY(i) > 0;
    pos.setY(i, up ? top(x) : 0);
  }
  // a faint fill under the cords, so from afar the net reads as a band, as a real one does
  const grid = canvasTex(32, 32, (g) => { g.fillStyle = '#333'; g.fillRect(0, 0, 32, 32); g.strokeStyle = '#fff'; g.lineWidth = 4; g.strokeRect(0, 0, 32, 32); }, false);
  grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
  grid.repeat.set(2 * X / 0.07, 1 / 0.07);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.78, 0.82), alphaMap: grid, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
  scene.add(mesh);
  // the tape along the top and the posts
  const tapeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.82, 0.86, 0.9) });   // white, like the lines
  const pts = [];
  for (let i = 0; i <= N; i++) { const x = -X + (2 * X * i) / N; pts.push(new THREE.Vector3(x, top(x), 0)); }
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.03, 6), tapeMat));
  const posts = [];
  for (const x of [-X, X]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, top(x) + 0.05, 10), tapeMat);
    p.position.set(x, (top(x) + 0.05) / 2, 0);
    scene.add(p);
    posts.push(p);
  }
  return { posts, mesh, dry: mesh.material };
}

function buildLamps(scene, LAMPS, lite) {
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.5, metalness: 0.7 });
  const poleG = new THREE.CylinderGeometry(0.07, 0.09, 7.5, 8);
  let shadows = 0;
  for (const [x, y, col] of LAMPS) {
    const pole = new THREE.Mesh(poleG, poleMat);
    pole.position.copy(V(x, y, 3.75)); pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x) * 0.25, 0.08, 0.08), poleMat);
    arm.position.copy(V(x * 0.875, y, 7.5));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.12, 16), new THREE.MeshBasicMaterial({ color: hdr(col, 4) }));
    head.position.copy(V(x * 0.75, y, 7.42));
    scene.add(pole, arm, head);
    const L = new THREE.SpotLight(col, 150, 34, 1.0, 0.8, 1.7);
    L.position.copy(V(x * 0.75, y, 7.3));
    L.target.position.copy(V(x * 0.45, y, 0));
    scene.add(L, L.target);
    // the two lamps nearest the court centre throw the shadows
    if (!lite && shadows < 2 && Math.abs(y) < 5) { L.castShadow = true; L.shadow.mapSize.set(1024, 1024); L.shadow.bias = -0.0005; shadows++; }
    const m = new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color(col).multiplyScalar(0.12), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add(flat(new THREE.PlaneGeometry(9, 9), m, x * 0.75, y, 0.02));
  }
  scene.add(new THREE.HemisphereLight(0x6a5ab0, 0x140c20, 1.6));
}

function buildCars(scene, CARS, hash) {
  const PAL = [0x4a5a8a, 0x7a3a7f, 0x2d6a80, 0x80644a, 0x505060, 0x30407a];
  const bodyG = new RoundedBoxGeometry(4.3, 0.65, 1.8, 3, 0.18), cabG = new RoundedBoxGeometry(2.3, 0.55, 1.5, 3, 0.2);
  const glass = new THREE.MeshStandardMaterial({ color: 0x0a1020, roughness: 0.05, metalness: 0.9 });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.2) });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.3) });
  const lightG = new THREE.BoxGeometry(0.05, 0.1, 0.35), glowG = new THREE.PlaneGeometry(6, 3.4);
  const glows = [new THREE.Color(1.2, 0.2, 0.7), new THREE.Color(0.15, 0.8, 1.1)].map((color) => new THREE.MeshBasicMaterial({ map: radial, color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  const paints = PAL.map((color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.1 }));
  for (const car of CARS) {
    const grp = new THREE.Group();
    const b = new THREE.Mesh(bodyG, paints[Math.floor(hash(car.k * 3.7 + car.sx) * PAL.length)]);
    b.position.y = 0.5; b.castShadow = b.receiveShadow = true;
    const cab = new THREE.Mesh(cabG, glass);
    cab.position.set(0.15, 1.0, 0); cab.castShadow = true;
    grp.add(b, cab);
    // nose (headlights) towards the court
    for (const z of [-0.6, 0.6]) {
      const h = new THREE.Mesh(lightG, head); h.position.set(-2.16, 0.6, z);
      const t = new THREE.Mesh(lightG, tail); t.position.set(2.16, 0.6, z);
      grp.add(h, t);
    }
    const gl = new THREE.Mesh(glowG, glows[hash(car.k * 5.1) > 0.5 ? 0 : 1]);
    gl.rotation.x = -Math.PI / 2; gl.position.y = 0.02;
    grp.add(gl);
    grp.position.copy(V(car.x, car.y, 0));
    // (all lengthways across the roof, as in the flat view)
    grp.rotation.y = car.sx > 0 ? 0 : Math.PI;
    scene.add(grp);
  }
}

// ---------------- billboard ----------------
// The building next door that the billboard stands on: a flat roof `drop`
// metres below ours with a low parapet, and dark walls with a few lit
// windows going down to the street. In the billboard's own frame: x along
// the sign, z out of its face (towards the court), the roof's top at -drop.
function buildNextDoor(w, d, drop) {
  const g = new THREE.Group();
  const H = 60;
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const win = canvasTex(128, 256, (c) => {
    c.fillStyle = '#0d0e14'; c.fillRect(0, 0, 128, 256);
    for (let y = 4; y < 256; y += 9) for (let x = 3; x < 128; x += 8) {
      const h = rnd();
      c.fillStyle = h > 0.93 ? '#ffcf8a' : h > 0.9 ? '#9fc8ff' : '#14161e';
      c.fillRect(x, y, 5, 5);
    }
  });
  win.wrapS = win.wrapT = THREE.RepeatWrapping;
  win.repeat.set(w / 12, H / 12);
  const wall = new THREE.MeshBasicMaterial({ map: win });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), [wall, wall, new THREE.MeshBasicMaterial({ color: 0x24252b }), wall, wall, wall]);
  body.position.set(0, -drop - H / 2, 0);
  g.add(body);
  // the parapet round its roof, and a couple of roof boxes
  const lip = new THREE.MeshBasicMaterial({ color: 0x2c2d34 });
  for (const [bw, bd, x, z] of [[w, 0.25, 0, d / 2], [w, 0.25, 0, -d / 2], [0.25, d, w / 2, 0], [0.25, d, -w / 2, 0]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.9, bd), lip);
    p.position.set(x, -drop + 0.45, z);
    g.add(p);
  }
  for (const [bw, bh, bd, x, z] of [[2.4, 1.4, 1.8, -w * 0.38, -d * 0.25], [1.6, 1.0, 1.6, w * 0.4, d * 0.2]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), new THREE.MeshBasicMaterial({ color: 0x1b1c22 }));
    b.position.set(x, -drop + bh / 2, z);
    g.add(b);
  }
  return g;
}

const BOARD_DIM = 0.6;   // the one neon accent left, kept soft against the concrete
function buildBoard(scene, R) {
  const B = R.BOARD;
  const grp = new THREE.Group();
  const tex = new THREE.CanvasTexture(document.createElement('canvas'));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(BOARD_DIM, BOARD_DIM, BOARD_DIM), transparent: true, fog: false, side: THREE.DoubleSide });
  // a real LED panel: a fine grid of diodes, a little less saturated, and a
  // faint sheen on its glass from the sky
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 g = vMapUv * vec2(${(B.w / 0.06).toFixed(0)}.0, ${(B.h / 0.06).toFixed(0)}.0);
      // (the grid fades out once its cells shrink towards a pixel, so it never shimmers)
      float fade = 1.0 - smoothstep(0.25, 0.5, max(fwidth(g).x, fwidth(g).y));
      float diode = 1.0 - smoothstep(0.25, 0.5, length(fract(g) - 0.5)) * 0.45 * fade;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.2) * diode;
      diffuseColor.rgb += vec3(0.02, 0.025, 0.035) * smoothstep(0.4, 1.0, vMapUv.y);`);
  };
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), mat);
  sign.position.y = B.z + B.h / 2;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, B.z, 0.5), new THREE.MeshStandardMaterial({ color: 0x1c1b2a, roughness: 0.6 }));
  post.position.y = B.z / 2;
  grp.add(sign, post);
  // a steel frame and legs (both 3D themes); in the rain, the neon's glow
  // spilling round the sign and a haze of lit rain below it
  const wetGrp = new THREE.Group();
  wetGrp.visible = false;
  grp.add(wetGrp);
  let wetBuilt = false, wet = false;
  const cy = B.z + B.h / 2;
  const glowU = { map: { value: tex }, k: { value: 1 } };
  {
    const m = metalMat(), T = 0.22, D = 0.3;
    // The sign stands past our roof's edge, so its legs go down to the roof
    // of the building next door (NEXT m lower), which carries it
    const NEXT = 2.2, LEG = B.z + NEXT;
    for (const [w, h, x, y] of [[B.w + 2 * T, T, 0, B.z + B.h + T / 2], [B.w + 2 * T, T, 0, B.z - T / 2], [T, B.h, -(B.w + T) / 2, cy], [T, B.h, (B.w + T) / 2, cy],
      [0.28, LEG, -B.w * 0.3, B.z - LEG / 2], [0.28, LEG, B.w * 0.3, B.z - LEG / 2],
      [B.w * 0.6, 0.16, 0, B.z * 0.45], [0.8, 0.08, -B.w * 0.3, -NEXT + 0.04], [0.8, 0.08, B.w * 0.3, -NEXT + 0.04]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, D * (h < 0.1 ? 2.5 : 1)), m);
      bar.position.set(x, y, -0.06);
      grp.add(bar);
    }
    post.visible = false;   // (the legs hold it now)
    grp.add(buildNextDoor(B.w + 8, 14, NEXT));
  }
  function buildWet() {
    wetBuilt = true;
    // the glow: the sign's own picture, blurred (a low mip) and fading out
    // past its edges, added behind it
    const glow = (w, h, y, z, frag) => {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
        uniforms: glowU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D map; uniform float k; varying vec2 vUv; ${frag}`,
      }));
      q.position.set(0, y, z);
      wetGrp.add(q);
    };
    const SX = 1.6, SY = 2.2;   // the halo's size against the sign's
    glow(B.w * SX, B.h * SY, cy, -0.12, `void main() {
      vec2 q = (vUv - 0.5) * vec2(${SX.toFixed(2)}, ${SY.toFixed(2)});
      vec2 o = max(abs(q) - 0.5, 0.0) / vec2(${((SX - 1) / 2).toFixed(2)}, ${((SY - 1) / 2).toFixed(2)});
      float f = pow(max(0.0, 1.0 - length(o)), 2.0);
      vec3 c = textureLod(map, clamp(q + 0.5, 0.0, 1.0), 5.0).rgb;
      gl_FragColor = vec4(c * f * 0.9 * k, 1.0);
    }`);
    // the haze below: the sign's lower edge colour, falling off towards the roof
    glow(B.w * 1.2, B.z, B.z / 2, 0.4, `void main() {
      vec3 c = textureLod(map, vec2(clamp((vUv.x - 0.5) * 1.2 + 0.5, 0.0, 1.0), 0.15), 6.0).rgb;
      // (clamped: with multisampling an edge pixel can be shaded just outside
      // the quad, where vUv.y < 0, and pow() of a negative is NaN, which the
      // glow pass then smears into a big black box)
      float f = pow(clamp(vUv.y, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.25, min(vUv.x, 1.0 - vUv.x));
      gl_FragColor = vec4(c * f * 0.35 * k, 1.0);
    }`);
  }
  scene.add(grp);
  let lastSrc = null, lastKey, lit = 1;
  return {
    sign, tex, on: () => lit,
    refresh() { lastSrc = null; },
    setWet(on) {
      if (on && !wetBuilt) buildWet();
      wet = on;
      wetGrp.visible = on;
    },
    update(r, f) {
      grp.position.copy(V(f * B.x, f * B.y, 0));
      // the sign's left end is at (u = 0) and it turns by B.turn, far end to the right
      grp.rotation.y = B.turn + (f < 0 ? Math.PI : 0);
      const { src, on } = R.boardSource(r);
      if (src !== lastSrc || src.key == null || src.key !== lastKey) {
        tex.image = src; tex.needsUpdate = true;
        lastSrc = src; lastKey = src.key;
      }
      // brighter in the rain: neon on a wet night
      mat.color.setScalar((wet ? 1.15 : BOARD_DIM) * on);
      glowU.k.value = on;
      lit = on;
    },
  };
}

// ---------------- players ----------------
// Each player is drawn by characters.js onto its own canvas, PPM pixels to
// the metre, feet at (CW/2, FEET), and shown on a card standing at their
// feet, turned to face the camera, like the flat view's sprite.
const PPM = 80, CARD_W = 3.6, CARD_UP = 3.0, CARD_DOWN = 0.4;
function buildPlayer(scene, LAMPS) {
  const cv = document.createElement('canvas');
  cv.width = Math.round(CARD_W * PPM); cv.height = Math.round((CARD_UP + CARD_DOWN) * PPM);
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(CARD_W, CARD_UP + CARD_DOWN);
  geo.translate(0, (CARD_UP - CARD_DOWN) / 2, 0);
  const card = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.02, toneMapped: false }));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: blob, transparent: true, opacity: 0.55, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  // what stands the cutout on the asphalt: a small near-black core right
  // under the feet (contact), and a long soft shadow cast away from the
  // nearest lamp, as long as that lamp's height makes it
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshBasicMaterial({ map: blob, transparent: true, opacity: 0.92, depthWrite: false }));
  shadow.add(contact);
  contact.position.z = 0.002;
  // (one from each of the two nearest lamps, as under real floodlights)
  const casts = [0, 1].map(() => {
    const pivot = new THREE.Object3D();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: castTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    pivot.add(m);
    scene.add(pivot);
    return { pivot, m };
  });
  const lamps = LAMPS.map(([x, y]) => ({ x: x * 0.75, y }));
  const LAMP_H = 7.37, BODY_H = 1.6;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.57, 0.63, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(card, shadow, ring);
  const q = new THREE.Quaternion();
  let drawn = -1e9;
  return {
    card, tex,
    refresh() { drawn = -1e9; },
    update(r, g, p, hidden, cam) {
      card.visible = shadow.visible = ring.visible = casts[0].pivot.visible = casts[1].pivot.visible = !hidden;
      if (hidden) return;
      const R = CT.R2D;
      const pos = R.proj(r, p.x, p.y, 0);
      const pose = R.playerPose(r, g, p, pos.behind ? { x: 0, y: 0, s: 1 } : pos);
      // the drawing (and its upload) at 30 fps; the card still moves every frame
      const t = performance.now();
      if (t - drawn >= 30) {
        drawn = t;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.translate(cv.width / 2, CARD_UP * PPM);
        ctx.scale(PPM, PPM);
        CT.drawCharacter(ctx, p.ch.id, pose, PPM / 45);
        tex.needsUpdate = true;
      }
      card.position.copy(V(p.x, p.y, 0));
      card.scale.setScalar(R.SPRITE_SCALE);
      // stand up facing the camera, like a sprite drawn upright on the screen
      cam.getWorldQuaternion(q);
      card.quaternion.copy(q);
      shadow.position.copy(V(p.x, p.y, 0.015));
      const by = lamps.map((l) => ({ l, d: Math.hypot(l.x - p.x, l.y - p.y) })).sort((a, b) => a.d - b.d);
      casts.forEach(({ pivot, m }, i) => {
        const { l, d } = by[i], len = Math.min(4, Math.max(0.7, BODY_H * d / (LAMP_H - BODY_H)));
        pivot.position.copy(V(p.x, p.y, 0.013 - i * 0.001));
        // (+z of the pivot points away from the lamp, along the ground)
        pivot.rotation.y = Math.atan2(p.x - l.x, -(p.y - l.y));
        m.position.set(0, 0, len * 0.5 - 0.05);
        m.scale.set(0.9, len, 1);
        // darker from the nearer lamp, and the shorter the shadow
        m.material.opacity = Math.min(1, (i ? 0.75 : 1.1) * Math.min(1, 2.2 / len) + 0.15);
      });
      ring.position.copy(V(p.x, p.y, 0.016));
      ring.material.color.set(p.ch.colors.glow);
    },
  };
}

// ---------------- ball ----------------
const TRAIL_MAX = 40;
const UP3 = new THREE.Vector3(0, 1, 0);
// Settings' Ball: Neon (glowing, with a bright tail) or Real (r.realBall):
// optic-yellow felt with its white seam, lit from the lamps above (dark
// underneath), turning with its spin, no glow, only a faint motion streak
// so it still reads at pace (the flat view's is render.js drawRealBall).
function feltTex() {
  const W = 256, H = 128;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#c8dc32'; g.fillRect(0, 0, W, H);
    // fuzz: little light and dark flecks
    for (let i = 0; i < 2600; i++) {
      const l = rnd();
      g.fillStyle = l > 0.5 ? `rgba(240,250,140,${0.25 * rnd()})` : `rgba(90,110,10,${0.25 * rnd()})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // the seam: a curve weaving round the ball (in this equirectangular map)
    g.strokeStyle = 'rgba(245,245,235,0.95)'; g.lineWidth = 3.5;
    g.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const phi = (x / W) * Math.PI * 2, lat = 0.62 * Math.cos(2 * phi);
      const y = H / 2 - (lat / Math.PI) * H;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  });
}

function buildBall(scene) {
  const felt = new THREE.MeshBasicMaterial({ map: feltTex() });
  felt.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vWN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = 'varying vec3 vWN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      // lit from the lamps overhead, a little from the city behind; dark underneath
      vec3 n = normalize(vWN);
      float lit = 0.22 + 0.95 * max(dot(n, normalize(vec3(0.25, 1.0, 0.35))), 0.0) + 0.15 * max(-n.z, 0.0);
      diffuseColor.rgb *= lit;`);
  };
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 1.15, 0.3) });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), neon);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radial, color: 0xc6ff2e, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blob, transparent: true, opacity: 0.5, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  // the trail: a ribbon facing the camera, fading towards its tail
  const tg = new THREE.BufferGeometry();
  const tpos = new Float32Array(TRAIL_MAX * 2 * 3), tcol = new Float32Array(TRAIL_MAX * 2 * 3);
  tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  tg.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  const idx = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  tg.setIndex(idx);
  const trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  trail.frustumCulled = false;
  scene.add(ball, glow, shadow, trail);
  const cp = new THREE.Vector3(), a = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3(), view = new THREE.Vector3();
  return {
    mesh: ball,
    update(r, g, cam) {
      const b = g.ball, on = !!b.active;
      const real = !!r.realBall;
      ball.visible = shadow.visible = trail.visible = on;
      glow.visible = on && !real;
      if (!on) return;
      ball.material = real ? felt : neon;
      const f = r.cam.f;
      cp.copy(cam.position);
      const was = ball.position.clone();
      ball.position.copy(V(b.pos.x, b.pos.y, b.pos.z));
      // turn with its travel, as if rolling forward (topspin), so the seam moves
      d.copy(ball.position).sub(was);
      const moved = d.length();
      if (moved > 1e-4 && moved < 2) {
        side.crossVectors(UP3, d).normalize();
        ball.rotateOnWorldAxis(side, Math.min(0.9, moved / 0.033 * 0.35));
      }
      const dist = Math.max(0.4, ball.position.distanceTo(cp));
      // as in the flat view: twice life size, never under 2.8 px, capped up
      // close. In VR the floor is 0.9 px and the glow follows the true size:
      // a ball that stops shrinking reads as growing when both eyes say "far"
      // (as render.js drawBall)
      const t = (0.075 * f) / dist;
      const px = Math.min(r.H * 0.04, Math.max(r.vr ? 0.9 : 2.8, t));
      const rad = (px * dist) / f;
      ball.scale.setScalar(rad);
      glow.position.copy(ball.position);
      // the sprite is 1.5x as wide as the glow's radius (its texture fades early)
      glow.scale.setScalar(r.vr ? (Math.max(px * 1.6, t * 4) * dist / f) * 1.5 : rad * 6);
      shadow.position.copy(V(b.pos.x, b.pos.y, 0.02));
      // the blob texture fades out before its edge, hence the 1.4
      const sh = CT.ballShadow(b.pos.z, 0.09);
      shadow.scale.setScalar(2 * sh.rad * 1.4);
      shadow.material.opacity = sh.alpha;
      const T = g.trail, n = Math.min(T.length, TRAIL_MAX);
      const off = T.length - n;
      for (let i = 0; i < TRAIL_MAX; i++) {
        const k = Math.min(i, n - 1), t = T[off + Math.max(0, k)];
        if (!t) { tpos.fill(0, i * 6, i * 6 + 6); tcol.fill(0, i * 6, i * 6 + 6); continue; }
        a.copy(V(t.x, t.y, t.z));
        const nx = T[off + Math.min(n - 1, k + 1)], pv = T[off + Math.max(0, k - 1)];
        d.copy(V(nx.x, nx.y, nx.z)).sub(V(pv.x, pv.y, pv.z));
        view.copy(a).sub(cp);
        side.crossVectors(d, view).normalize();
        const fr = n > 1 ? k / (n - 1) : 0;
        const dd = Math.max(0.4, view.length());
        const w = Math.max((r.vr ? 0.6 : 1.5) * dd / f, 0.08) * fr * 0.5;
        tpos[i * 6] = a.x + side.x * w; tpos[i * 6 + 1] = a.y + side.y * w; tpos[i * 6 + 2] = a.z + side.z * w;
        tpos[i * 6 + 3] = a.x - side.x * w; tpos[i * 6 + 4] = a.y - side.y * w; tpos[i * 6 + 5] = a.z - side.z * w;
        // (the real ball leaves a faint motion streak, the neon one a bright tail)
        const c = (real ? fr * fr * 0.16 : fr * 0.45) * (i < n ? 1 : 0);
        const tc = real ? [0.85, 0.9, 0.55] : [0.89, 1.0, 0.29];
        for (const o of [0, 3]) { tcol[i * 6 + o] = tc[0] * c; tcol[i * 6 + o + 1] = tc[1] * c; tcol[i * 6 + o + 2] = tc[2] * c; }
      }
      tg.attributes.position.needsUpdate = true;
      tg.attributes.color.needsUpdate = true;
    },
  };
}

// ---------------- the scanned ground, dry or in the rain ----------------
// The ground's light is baked, so the material look is a shader on top of
// that bake: grit, bumps and gloss from a scanned asphalt (models/rain).
// Dry (Concrete 3D) it is dull with a faint lamp sheen. In the rain (Rain
// 3D) wet asphalt is darker and a little glossy,
// and puddles are dark mirrors. What they mirror is traced in the shader,
// not drawn twice: the baked city (by direction), the billboard and the
// players (a ray to their flat cards), the ball (a ray to a sphere) and the
// lamp lenses (a glossy highlight). Rain falls round the camera, and drops
// ring the puddles.

// where the puddles are: value noise over the baked ground, deep spots
// above 0.5. Fewer and smaller on the court, so the ball stays easy to read.
function puddleTex(C) {
  const G = GROUND, W = 1024, H = Math.round(W * (G.y1 - G.y0) / (G.x1 - G.x0));
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const v = new Float32Array(W * H);
  for (const [f, a] of [[8, 0.5], [17, 0.3], [35, 0.17], [70, 0.1], [150, 0.05]]) {
    const fx = Math.round(f * 1.5), fy = Math.round(f * H / W * 1.5) + 1;
    const g = Array.from({ length: (fx + 1) * (fy + 1) }, rnd);
    const at = (i, j) => g[j * (fx + 1) + i];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = (x / W) * fx, py = (y / H) * fy, i = Math.floor(px), j = Math.floor(py);
      let tx = px - i, ty = py - j; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      v[y * W + x] += ((at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty - 0.5) * a;
    }
  }
  const t = canvasTex(W, H, (g) => {
    const id = g.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const gx = G.x0 + (x / W) * (G.x1 - G.x0), gy = G.y1 - (y / H) * (G.y1 - G.y0);
      // inside the court (and a little round it), shallower
      const cin = Math.max(0, 1 - Math.max(Math.abs(gx) - C.DW - 1, Math.abs(gy) - C.HL - 2, 0) / 2);
      const d = v[y * W + x] * 1.6 + 0.5 - cin * 0.1;
      const c = Math.max(0, Math.min(255, d * 255)), k = (y * W + x) * 4;
      id.data[k] = id.data[k + 1] = id.data[k + 2] = c; id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
  }, false);
  t.anisotropy = 4;
  return t;
}

function groundMaterial(ground, grain, LAMPS, wet) {
  const G = GROUND, C = CT.R2D.COURT;
  const lamps = LAMPS.map(([x, y]) => V(x * 0.75, y, 7.37));
  // the baked lamp colours: amber, and the pink and cyan paled half to white (scene.py)
  const cols = LAMPS.map(([, , c]) => { const k = new THREE.Color(c); return /ffb04a/i.test(c) ? k : k.lerp(new THREE.Color(1, 1, 1), 0.5); });
  const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    camPos: { value: new THREE.Vector3() },
    time: { value: 0 }, rainAmt: { value: 1 },
    lampPos: { value: lamps }, lampCol: { value: cols },
    sky: { value: null }, skyOn: { value: 0 },
    board: { value: null }, boardInv: { value: new THREE.Matrix4() }, boardOn: { value: 0 }, boardSize: { value: new THREE.Vector2(1, 1) },
    card0: { value: null }, card1: { value: null },
    cardInv: { value: [new THREE.Matrix4(), new THREE.Matrix4()] }, cardOn: { value: [0, 0] },
    ball: { value: new THREE.Vector4(0, -10, 0, 0.05) }, ballOn: { value: 0 },
  }]);
  u.map = { value: ground }; u.grain = { value: grain };
  // the scanned asphalt: Poly Haven's Asphalt Floor (CC0), 1k (models/rain/README.md)
  for (const [k, f] of [['asphalt', 'asphalt.jpg'], ['asphaltN', 'asphalt_nor.jpg']]) {
    const t = fileTex('models/rain/' + f).t;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    u[k] = { value: t };
  } u.puddles = { value: puddleTex(CT.R2D.COURT) };
  const m = new THREE.ShaderMaterial({
    uniforms: u, fog: true,
    defines: { WET: wet ? 1 : 0, DW: C.DW.toFixed(3), SW: C.SW.toFixed(3), HL: C.HL.toFixed(3), SL: C.SL.toFixed(3), NL: lamps.length, GX0: G.x0.toFixed(2), GW: (G.x1 - G.x0).toFixed(2), GY0: G.y0.toFixed(2), GH: (G.y1 - G.y0).toFixed(2),
      CW: CARD_W.toFixed(2), CUP: CARD_UP.toFixed(2), CDN: CARD_DOWN.toFixed(2), SKY_DIM: '0.55', BOARD_K: BOARD_DIM.toFixed(2) },
    vertexShader: `
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform sampler2D map, grain, asphalt, asphaltN, puddles, sky, board, card0, card1;
      uniform vec3 camPos; uniform float time, rainAmt;
      uniform vec3 lampPos[NL]; uniform vec3 lampCol[NL];
      uniform float skyOn, boardOn; uniform mat4 boardInv; uniform vec2 boardSize;
      uniform mat4 cardInv[2]; uniform float cardOn[2];
      uniform vec4 ball; uniform float ballOn;
      varying vec2 vUv; varying vec3 vW;
      #include <fog_pars_fragment>
      const float PI = 3.14159265;
      const vec3 LINE_GLOW = vec3(0.35, 0.9, 1.0);
      float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      // a hit on a flat card (plane z = 0 of its own space): rgba, a = 0 for a miss
      vec4 hitCard(mat4 inv, vec3 p, vec3 d, vec2 lo, vec2 hi, sampler2D tex, float lod) {
        vec3 o = (inv * vec4(p, 1.0)).xyz, r = mat3(inv) * d;
        if (abs(r.z) < 1e-4) return vec4(0.0);
        float t = -o.z / r.z;
        vec2 q = o.xy + r.xy * t;
        if (t < 0.0 || q.x < lo.x || q.y < lo.y || q.x > hi.x || q.y > hi.y) return vec4(0.0);
        return textureLod(tex, (q - lo) / (hi - lo), lod);
      }
      void main() {
        // the baked ground, as the dry theme draws it (bakedMaterial: gain 0.85, grain 0.4, desat 0.15)
        // the scanned asphalt (models/rain: r = albedo, g = roughness, b = height;
        // a 2.35 m tile), over the baked light; the procedural grain at a
        // 10 m scale breaks up the tile's repeat in the distance
        vec2 aUv = vW.xz / 2.35;
        vec3 as = texture2D(asphalt, aUv).rgb;
        float g0 = texture2D(grain, vUv * vec2(GW / 10.0, GH / 10.0)).r;
        vec3 base = texture2D(map, vUv).rgb * 0.85;
        base *= mix(1.0, as.r / 0.51, 0.9) * (1.0 + (g0 - 0.5) * 0.5);
        base = mix(base, vec3(dot(base, vec3(0.3, 0.59, 0.11))), 0.15);
        // how deep the water is here; the asphalt's low spots fill first
        float deep = texture2D(puddles, vUv).r - (as.b - 0.62) * 0.3;
        float pud = WET > 0 ? smoothstep(0.64, 0.7, deep) : 0.0;
        float damp = WET > 0 ? smoothstep(0.4, 0.66, deep) : 0.0;
        // the surface's tilt: the scan's normal map, flat water with rain rings
        // (a softer mip, so the grit doesn't sparkle and shimmer as the camera moves)
        vec3 tn = texture2D(asphaltN, aUv, 1.0).xyz * 2.0 - 1.0;
        vec3 n = normalize(vec3(tn.x * 1.1, tn.z, -tn.y * 1.1));
        vec2 gp = vW.xz * 2.5;   // rings: one drop per 40 cm cell, a ring every 0.8 s or so
        vec2 cell = floor(gp), f = fract(gp) - 0.5;
        float ph = h21(cell), age = fract(time * 1.3 + ph);
        vec2 off = vec2(h21(cell + 7.1), h21(cell + 3.7)) - 0.5;
        float dr = length(f - off * 0.5), rad = age * 0.45;
        float ring = sin(clamp((dr - rad) * 40.0, -PI, PI)) * (1.0 - age) * step(abs(dr - rad), 0.08) * step(h21(cell + 1.3), rainAmt);   // (fewer drops while the rain starts)
        vec3 nw = normalize(vec3((f - off * 0.5).x / max(dr, 1e-3) * ring * 0.12, 1.0, (f - off * 0.5).y / max(dr, 1e-3) * ring * 0.12));
        n = normalize(mix(n, nw, pud));
        // water sits in the pits, so they are glossier than the stone tops
        float rough = WET > 0 ? mix(mix(0.16, 0.36, smoothstep(0.5, 0.75, as.b)) * (0.8 + as.g * 0.25), 0.03, pud)
          : 0.42 + as.g * 0.15;   // dry: a dull sheen, worn tops a little shinier
        // what the surface mirrors
        vec3 v = normalize(vW - camPos);
        vec3 rd = reflect(v, n);
        rd.y = max(rd.y, 0.002);
        float lod = rough * 9.0;
        // the night sky, and the baked city where the strip is (loadSkyline: -4..14 degrees)
        vec3 env = mix(vec3(0.02, 0.022, 0.05), vec3(0.09, 0.05, 0.11), exp(-rd.y * 6.0));
        if (WET > 0 && skyOn > 0.5) {
          float lat = degrees(asin(min(rd.y, 1.0)));
          vec2 su = vec2(atan(rd.x, -rd.z) / (2.0 * PI) + 0.5, (lat + 4.0) / 18.0);
          if (su.y < 1.0) { vec4 s = textureLod(sky, su, lod); env = mix(env, s.rgb * SKY_DIM, s.a); }
        }
        if (WET > 0 && boardOn > 0.0) {
          vec4 b = hitCard(boardInv, vW, rd, -boardSize * 0.5, boardSize * 0.5, board, lod);
          env = mix(env, b.rgb * BOARD_K * boardOn, b.a);
        }
        if (WET > 0 && cardOn[0] > 0.5) { vec4 c = hitCard(cardInv[0], vW, rd, vec2(-CW * 0.5, -CDN), vec2(CW * 0.5, CUP), card0, lod * 0.5); env = mix(env, c.rgb, c.a); }
        if (WET > 0 && cardOn[1] > 0.5) { vec4 c = hitCard(cardInv[1], vW, rd, vec2(-CW * 0.5, -CDN), vec2(CW * 0.5, CUP), card1, lod * 0.5); env = mix(env, c.rgb, c.a); }
        if (WET > 0 && ballOn > 0.5) {
          vec3 oc = vW - ball.xyz;
          float bb = dot(oc, rd), cc = dot(oc, oc) - ball.w * ball.w * mix(4.0, 1.0, pud);
          if (bb < 0.0 && bb * bb > cc) env = vec3(0.95, 1.15, 0.3) * mix(0.6, 1.0, pud);
        }
        // the lamp lenses: a glossy highlight each (GGX)
        vec3 spec = vec3(0.0);
        float a2 = rough * rough * rough * rough + 1e-5;
        for (int i = 0; i < NL; i++) {
          vec3 l = lampPos[i] - vW;
          float dl = length(l); l /= dl;
          vec3 h = normalize(l - v);
          float nh = max(dot(n, h), 0.0), q = nh * nh * (a2 - 1.0) + 1.0;
          spec += lampCol[i] * (a2 / (PI * q * q)) * max(dot(n, l), 0.0) * 40.0 / (dl * dl);
        }
        // more mirror at a glancing look (Fresnel); water mirrors more than wet asphalt
        float cosv = clamp(dot(n, -v), 0.0, 1.0);   // (pow below of a negative would be NaN)
        float fr = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
        float k = mix(0.12 + 0.45 * fr, 0.35 + 0.65 * fr, pud);
        vec3 col = base * mix(0.62, 0.22, pud) * mix(1.0, 0.8, damp) * (1.0 - k * 0.5) + env * k + spec * mix(0.07 + 0.22 * fr, 1.0, pud);
        if (WET == 0) {
          // dry: the bake's light, the scan's grit and shading from its bumps, a little lamp sheen
          // (the grit pushed harder than wet: dry, nothing glints to show it)
          float shade = 0.55 + 0.6 * dot(n, normalize(vec3(0.25, 1.0, 0.35)));
          col = base * (1.0 + (as.r / 0.51 - 1.0) * 1.2) * shade + spec * 0.12;
        }
        // the glowing court lines: a cyan halo on the wet ground round each
        // line, and a longer smear of it where the water mirrors it
        vec2 c = vec2(vW.x, -vW.z), a = abs(c);
        float d = 1e3;
        d = min(d, max(abs(a.x - DW), a.y - HL));
        d = min(d, max(abs(a.x - SW), a.y - HL));
        d = min(d, max(abs(a.y - HL), a.x - DW));
        d = min(d, max(abs(a.y - SL), a.x - SW));
        d = min(d, max(a.x, a.y - SL));
        d = max(d, 0.0);
        if (WET > 0) col += LINE_GLOW * (exp(-d / 0.06) * 0.45 + exp(-d / 0.22) * 0.07) * mix(0.8, 1.3, max(pud, damp * 0.5));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  return m;
}

// worn court lines: patchy paint with the asphalt's grit showing through;
// in the rain they glow pale cyan
function wornLines(mat, grain, asphalt, wet) {
  const m = mat.clone();
  if (wet) m.color = new THREE.Color(0.95, 1.35, 1.5);   // pale cyan, a little above white so the glow pass just catches it
  m.onBeforeCompile = (sh) => {
    sh.uniforms.grain = { value: grain };
    sh.uniforms.asphalt = { value: asphalt };
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D grain, asphalt;\nvarying vec3 vW;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float patchy = smoothstep(0.38, 0.62, texture2D(grain, vW.xz / 7.0).r);
      // the asphalt's grit shows through the paint
      vec3 as = texture2D(asphalt, vW.xz / 2.35).rgb;
      diffuseColor.rgb *= mix(0.4, 0.95, patchy) * mix(1.0, as.r / 0.51, 0.7) * smoothstep(0.3, 0.6, as.b + 0.15);`);
  };
  return m;
}

// rain: thin streaks in a 24 m box that moves with the camera; the falling
// is done on the GPU, so it costs one draw call
const RAIN_N = 1400;   // streaks at the top graphics levels
function buildRain(scene) {
  const N = RAIN_N, BOX = 24, TOP = 12, LEN = 0.55;
  const pos = new Float32Array(N * 6), seed = new Float32Array(N * 2 * 4);
  let s = 3;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) {
    const x = rnd() * BOX, z = rnd() * BOX, y = rnd() * TOP, sp = 0.8 + rnd() * 0.4;
    for (let k = 0; k < 2; k++) { pos.set([x, y + k * LEN, z], i * 6 + k * 3); seed.set([x, y, z, sp], i * 8 + k * 4); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, cam: { value: new THREE.Vector3() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 seed; uniform float time; uniform vec3 cam; varying float vA;
      void main() {
        float top = position.y - seed.y;   // 0 at the streak's foot, LEN at its head
        vec3 p = vec3(seed.x, seed.y, seed.z);
        // fall at 9 m/s, slanting a little, wrapped in a box round the camera
        p.y = mod(p.y - time * 9.0 * seed.w, ${TOP.toFixed(1)});
        p.x += p.y * 0.08;
        p.xz = mod(p.xz - cam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) + cam.xz - ${(BOX / 2).toFixed(1)};
        p.y += top;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vA = (1.0 - smoothstep(6.0, ${(BOX / 2).toFixed(1)}, length(mv.xyz))) * smoothstep(0.6, 2.0, length(mv.xyz)) * (0.4 + top * 1.2);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(vec3(0.55, 0.62, 0.75) * vA * 0.32, 1.0); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  scene.add(lines);
  return lines;
}

// Steel with worn grey paint over rust (Poly Haven's Rusty Metal 04, CC0),
// for the net posts and the billboard's frame. The baked rooftop has no live
// lights, so the shine is a painted matcap: amber from the lamps above, cyan
// from the lines below.
let metal = null;
function metalMat() {
  if (metal) return metal;
  const rust = fileTex('models/rain/post_rust.jpg').t;
  rust.colorSpace = THREE.SRGBColorSpace;
  rust.wrapS = rust.wrapT = THREE.RepeatWrapping;
  rust.repeat.set(0.6, 1.2);
  const cap = canvasTex(128, 128, (g) => {
    g.fillStyle = '#05070a'; g.fillRect(0, 0, 128, 128);
    const ball = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    ball.addColorStop(0, '#b4bac4'); ball.addColorStop(0.65, '#6a7079'); ball.addColorStop(1, '#262a30');
    g.fillStyle = ball; g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
    const hot = (x, y, r, c) => { const h = g.createRadialGradient(x, y, 0, x, y, r); h.addColorStop(0, c); h.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = h; g.fillRect(0, 0, 128, 128); };
    hot(48, 26, 26, 'rgba(255,214,150,0.95)');   // the lamps
    hot(90, 40, 18, 'rgba(255,170,210,0.5)');
    hot(70, 116, 30, 'rgba(110,230,255,0.55)');  // the lines' glow from below
  });
  // (brighter than white: the rust map is dark, and the rooftop is dim)
  metal = new THREE.MeshMatcapMaterial({ matcap: cap, map: rust, color: new THREE.Color(2.6, 2.6, 2.6) });
  return metal;
}

// the net posts (both 3D themes): thick steel, a cap, a foot plate and a winder
function buildMetalPosts(scene, C) {
  const mat = metalMat();
  const grp = new THREE.Group();
  for (const x of [-C.POST_X, C.POST_X]) {
    const h = CT.netHeight(x) + 0.12;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, h, 16), mat);
    pole.position.set(x, h / 2, 0);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.05, 16), mat);
    top.position.set(x, h + 0.02, 0);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 16), mat);
    foot.position.set(x, 0.015, 0);
    // the winder on the side of the post
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), mat);
    wind.position.set(x + Math.sign(x) * 0.08, h * 0.55, 0);
    grp.add(pole, top, foot, wind);
  }
  scene.add(grp);
  return grp;
}

// the net: dark steel wire in square cells, lit from above, with rust at
// some joints and, in the rain, drops caught on it. One texture holds 4 x 4
// cells (6 cm each) so they don't repeat cell by cell.
function wireNetMaterial(C, wet) {
  const CELL = 0.06, K = 4, P = 32;   // P pixels a cell
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tex = canvasTex(K * P, K * P, (g, w) => {
    // a faint dark fill, so from afar the net still reads as a band
    g.fillStyle = 'rgba(20,24,30,0.35)'; g.fillRect(0, 0, w, w);
    for (let i = 0; i <= K; i++) {
      const o = i * P;
      // the horizontal wires: a bright top edge where the lamps catch them
      g.fillStyle = '#3a3f46'; g.fillRect(0, o - 3.5, w, 7);
      g.fillStyle = '#b8c2cc'; g.fillRect(0, o - 3.5, w, 2);
      // the vertical wires: a lit stripe down one side
      g.fillStyle = '#33373d'; g.fillRect(o - 3.5, 0, 7, w);
      g.fillStyle = '#87909a'; g.fillRect(o - 2, 0, 1.6, w);
    }
    // rust at some joints, and drops hanging under the wires
    for (let k = 0; k < 10; k++) {
      const x = Math.floor(rnd() * K) * P, y = Math.floor(rnd() * K) * P;
      g.fillStyle = 'rgba(120,62,30,0.8)'; g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (let k = 0; k < (wet ? 7 : 0); k++) {
      const x = rnd() * w, y = Math.floor(rnd() * K) * P + 3.5;
      g.fillStyle = 'rgba(200,235,255,0.9)'; g.beginPath(); g.arc(x, y, 1.8, 0, Math.PI * 2); g.fill();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.repeat.set((2 * C.POST_X) / (CELL * K), 1 / (CELL * K));
  // (the sheet's v runs 0..1 over its height, so one repeat a K-cell band)
  return new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.25, 1.3, 1.4), transparent: true, side: THREE.DoubleSide, depthWrite: false });
}
