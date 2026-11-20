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
// ?3d=lite: no bloom or shadows, fewer pixels (to compare speed)
const LITE = /[?&]3d=lite\b/.test(location.search);
// ?3d=plain: the simple lit scenery instead of the baked rooftop
const PLAIN = /[?&]3d=plain\b/.test(location.search);
// The baked rooftop (made in Blender: art/rooftop-bake/). Its light is in
// the textures, so it needs no live lights.
const BAKED = 'models/rooftop/';
// the ground picture's extent in game metres (bake.py GX0.. GY1)
const GROUND = { x0: -30, x1: 30, y0: -21.8, y1: 17.8 };

// HDR colour: above 1 it blooms
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k);

export function create3d(r, R) {
  const { COURT: C, hash } = R;
  const canvas = document.createElement('canvas');
  const gl = new THREE.WebGLRenderer({ canvas, antialias: LITE, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 0.9;
  gl.shadowMap.enabled = !LITE;
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

  const moon = buildSky(scene, hash);
  const skyline = buildSkyline(scene, hash);
  // the simple lit scenery, until (or unless) the baked rooftop has loaded
  const plain = new THREE.Group();
  scene.add(plain);
  buildDeck(plain, R);
  buildLamps(plain, R.LAMPS, LITE);
  buildCars(plain, R.CARS, hash);
  buildCourt(scene, C);
  buildNet(scene, C);
  buildLampGlows(scene, R.LAMPS);
  if (!PLAIN) {
    loadBaked(scene).then(() => {
      scene.remove(plain);
      gl.shadowMap.enabled = false;
      scene.environment = null;   // (only the plain cars' paint used it)
    }).catch((e) => console.warn('baked rooftop unavailable', e));
    loadSkyline(scene).then(() => { scene.remove(skyline, moon); })
      .catch((e) => console.warn('baked skyline unavailable', e));
  }
  const board = buildBoard(scene, R);
  const players = [0, 1].map(() => buildPlayer(scene));
  const ball = buildBall(scene);

  const cam = new THREE.PerspectiveCamera(50, 1, 0.3, 2400);
  // the composer draws into a multisampled target, so edges stay smooth
  let composer, bloom;
  function makeComposer(w, h, dpr) {
    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: 4 });
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

  const self = {
    ready: true, canvas,
    resize(r) {
      // fewer pixels than the flat view's Sharp: each one costs more here
      const dpr = Math.min(LITE ? 1 : 1.25, window.devicePixelRatio || 1);
      gl.setPixelRatio(dpr);
      gl.setSize(r.W, r.H);
      if (LITE) return;   // drawn straight to the screen: no bloom
      if (composer) composer.renderTarget1.dispose(), composer.renderTarget2.dispose();
      makeComposer(r.W, r.H, dpr);
    },
    draw(r, g, human, now) {
      setCamera(cam, r);
      const f = human === 1 ? -1 : 1;
      board.update(r, f);
      for (const p of g.players) players[p.side].update(r, g, p, r.view === 'first' && p.side === human, cam);
      ball.update(r, g, cam);
      if (LITE) gl.render(scene, cam); else composer.render();
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

function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
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
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1100, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })));
  const pts = [];
  for (let i = 0; i < 1400; i++) {
    const a = hash(i * 1.7) * Math.PI * 2, e = 0.05 + hash(i * 2.3 + 9) * 1.4;
    pts.push(Math.cos(a) * Math.cos(e) * 1000, Math.sin(e) * 1000, Math.sin(a) * Math.cos(e) * 1000);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe6ebff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 })));
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
  return g;
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

async function loadBaked(scene) {
  const tl = new THREE.TextureLoader();
  const tex = (f) => tl.loadAsync(BAKED + f).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
  const [ground, atlas, gltf] = await Promise.all([tex('ground.jpg'), tex('props.jpg'), new GLTFLoader().loadAsync(BAKED + 'props.glb')]);
  atlas.flipY = false;   // glTF's UVs run top-down
  const G = GROUND;
  const grain = concreteTex();
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.anisotropy = 4;
  const deck = flat(new THREE.PlaneGeometry(G.x1 - G.x0, G.y1 - G.y0), bakedMaterial(ground, 0.85, 0, { map: grain, repeat: [(G.x1 - G.x0) / 2.5, (G.y1 - G.y0) / 2.5], amount: 0.4, desat: 0.15 }), (G.x0 + G.x1) / 2, (G.y0 + G.y1) / 2, 0);
  // the roof beyond the baked part, dark
  const beyond = flat(new THREE.PlaneGeometry(90, G.y1 - G.y0), new THREE.MeshBasicMaterial({ color: 0x07070b }), 0, (G.y0 + G.y1) / 2, -0.01);
  const mat = bakedMaterial(atlas);
  gltf.scene.traverse((o) => { if (o.isMesh) o.material = mat; });
  scene.add(beyond, deck, gltf.scene);
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
  const LAT0 = -4, LAT1 = 14, R = 1000, NU = 96, NV = 6, DIM = 0.55;   // must match tools/rooftop-bake/skyline.py
  return new THREE.TextureLoader().loadAsync(BAKED + 'skyline.png').then((t) => {
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
  for (const [x1, y1, x2, y2, w0 = C.LW] of lines) {
    const w = Math.max(w0, 0.07);   // a touch wider than real, so far lines don't break up
    const len = Math.hypot(x2 - x1, y2 - y1) + w;
    const along = x1 === x2;
    scene.add(flat(new THREE.PlaneGeometry(along ? w : len, along ? len : w), mat, (x1 + x2) / 2, (y1 + y2) / 2, 0.011));
  }
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
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.78, 0.82), alphaMap: grid, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })));
  // the tape along the top and the posts
  const tapeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.82, 0.86, 0.9) });   // white, like the lines
  const pts = [];
  for (let i = 0; i <= N; i++) { const x = -X + (2 * X * i) / N; pts.push(new THREE.Vector3(x, top(x), 0)); }
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.03, 6), tapeMat));
  for (const x of [-X, X]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, top(x) + 0.05, 10), tapeMat);
    p.position.set(x, (top(x) + 0.05) / 2, 0);
    scene.add(p);
  }
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
const BOARD_DIM = 0.6;   // the one neon accent left, kept soft against the concrete
function buildBoard(scene, R) {
  const B = R.BOARD;
  const grp = new THREE.Group();
  const tex = new THREE.CanvasTexture(document.createElement('canvas'));
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(BOARD_DIM, BOARD_DIM, BOARD_DIM), transparent: true, fog: false, side: THREE.DoubleSide });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(B.w, B.h), mat);
  sign.position.y = B.z + B.h / 2;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, B.z, 0.5), new THREE.MeshStandardMaterial({ color: 0x1c1b2a, roughness: 0.6 }));
  post.position.y = B.z / 2;
  grp.add(sign, post);
  scene.add(grp);
  let lastSrc = null, lastKey;
  return {
    update(r, f) {
      grp.position.copy(V(f * B.x, f * B.y, 0));
      // the sign's left end is at (u = 0) and it turns by B.turn, far end to the right
      grp.rotation.y = B.turn + (f < 0 ? Math.PI : 0);
      const { src, on } = R.boardSource(r);
      if (src !== lastSrc || src.key == null || src.key !== lastKey) {
        tex.image = src; tex.needsUpdate = true;
        lastSrc = src; lastKey = src.key;
      }
      mat.color.setScalar(BOARD_DIM * on);
    },
  };
}

// ---------------- players ----------------
// Each player is drawn by characters.js onto its own canvas, PPM pixels to
// the metre, feet at (CW/2, FEET), and shown on a card standing at their
// feet, turned to face the camera, like the flat view's sprite.
const PPM = 80, CARD_W = 3.6, CARD_UP = 3.0, CARD_DOWN = 0.4;
function buildPlayer(scene) {
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.57, 0.63, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(card, shadow, ring);
  const q = new THREE.Quaternion();
  return {
    update(r, g, p, hidden, cam) {
      card.visible = shadow.visible = ring.visible = !hidden;
      if (hidden) return;
      const R = CT.R2D;
      const pos = R.proj(r, p.x, p.y, 0);
      const pose = R.playerPose(r, g, p, pos.behind ? { x: 0, y: 0, s: 1 } : pos);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.translate(cv.width / 2, CARD_UP * PPM);
      ctx.scale(PPM, PPM);
      CT.drawCharacter(ctx, p.ch.id, pose, PPM / 45);
      tex.needsUpdate = true;
      card.position.copy(V(p.x, p.y, 0));
      card.scale.setScalar(R.SPRITE_SCALE);
      // stand up facing the camera, like a sprite drawn upright on the screen
      cam.getWorldQuaternion(q);
      card.quaternion.copy(q);
      shadow.position.copy(V(p.x, p.y, 0.015));
      ring.position.copy(V(p.x, p.y, 0.016));
      ring.material.color.set(p.ch.colors.glow);
    },
  };
}

// ---------------- ball ----------------
const TRAIL_MAX = 40;
function buildBall(scene) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 1.15, 0.3) }));
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
    update(r, g, cam) {
      const b = g.ball, on = !!b.active;
      ball.visible = glow.visible = shadow.visible = trail.visible = on;
      if (!on) return;
      const f = r.cam.f;
      cp.copy(cam.position);
      ball.position.copy(V(b.pos.x, b.pos.y, b.pos.z));
      const dist = Math.max(0.4, ball.position.distanceTo(cp));
      // as in the flat view: twice life size, never under 2.8 px, capped up close
      const px = Math.min(r.H * 0.04, Math.max(2.8, (0.075 * f) / dist));
      const rad = (px * dist) / f;
      ball.scale.setScalar(rad);
      glow.position.copy(ball.position);
      glow.scale.setScalar(rad * 6);
      shadow.position.copy(V(b.pos.x, b.pos.y, 0.02));
      shadow.scale.setScalar(0.18 * 1.4);
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
        const w = Math.max(1.5 * dd / f, 0.08) * fr * 0.5;
        tpos[i * 6] = a.x + side.x * w; tpos[i * 6 + 1] = a.y + side.y * w; tpos[i * 6 + 2] = a.z + side.z * w;
        tpos[i * 6 + 3] = a.x - side.x * w; tpos[i * 6 + 4] = a.y - side.y * w; tpos[i * 6 + 5] = a.z - side.z * w;
        const c = fr * 0.45 * (i < n ? 1 : 0);
        for (const o of [0, 3]) { tcol[i * 6 + o] = 0.89 * c; tcol[i * 6 + o + 1] = 1.0 * c; tcol[i * 6 + o + 2] = 0.29 * c; }
      }
      tg.attributes.position.needsUpdate = true;
      tg.attributes.color.needsUpdate = true;
    },
  };
}
