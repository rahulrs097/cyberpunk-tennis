// Cardboard VR: head tracking maths and the one-button auto shots (js/vr.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./engine');

const deg = (r) => (r * 180) / Math.PI;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('the phone held upright faces straight ahead, in portrait or sideways in a headset', () => {
  const { VR } = loadEngine(1, {}, ['vr.js']);
  const up = VR.screenPose(0, 90, 0, 0);
  near(deg(up.pitch), 0, 0.01, 'portrait pitch'); near(deg(up.roll), 0, 0.01, 'portrait roll');
  const side = VR.screenPose(0, 0, -90, 90);
  near(deg(side.pitch), 0, 0.01, 'landscape pitch'); near(deg(side.roll), 0, 0.01, 'landscape roll');
  // tilting the top of the phone back looks up; turning left is negative yaw
  near(deg(VR.screenPose(0, 110, 0, 0).pitch), 20, 0.01, 'looking up');
  near(deg(VR.screenPose(30, 90, 0, 0).yaw), -30, 0.01, 'turning left');
});

test('recentring makes the way you face straight down the court', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const h = CT.VR.createHead();
  h.raw = { yaw: 1.2, pitch: -0.1, roll: 0.05 };
  CT.VR.recentre(h);
  near(CT.VR.headPose(h).yaw, 0, 1e-9, 'after recentre');
  h.raw = { yaw: 1.5, pitch: -0.1, roll: 0.05 };
  near(CT.VR.headPose(h).yaw, 0.3, 1e-9, 'turned right');
});

function atContact(CT, x, y, z) {
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'] });
  const p = g.players[0];
  g.phase = 'rally';
  p.x = x - 0.8; p.y = y - 0.35; p.moving = false;
  g.ball = Object.assign(CT.makeBall(), { pos: { x, y, z }, vel: { x: 0, y: -15, z: -1 }, active: true, inFlight: true, bounces: 1, lastHitter: 1 });
  return { g, p };
}
const landOf = (CT, g, p, input) => {
  const shot = CT._computeShot(g, p, input, 0);
  return { shot, land: CT.flight(shot.pos, shot.vel, shot.spin, shot.side).land };
};
// a seeded stand-in for Math.random
const seeded = (seed) => { seed = (seed * 48271 + 99991) % 2147483647; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); };

test('a well-timed button press picks a shot that lands in; a power shot goes harder', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const speed = { normal: [], power: [] };
  for (let i = 1; i <= 40; i++) {
    for (const power of [false, true]) {
      const { g, p } = atContact(CT, 0, -12.5, 1.0);
      g.players[1].x = (i % 5) - 2;
      const { shot, land } = landOf(CT, g, p, CT.VR.autoShot(g, 0, power, seeded(i)));
      assert.ok(CT.inSingles(land.x, land.y) && land.y > 0, `${power ? 'power' : 'normal'} shot ${i} landed ${land.x}, ${land.y}`);
      speed[power ? 'power' : 'normal'].push(Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z));
    }
  }
  assert.ok(Math.min(...speed.power) > Math.max(...speed.normal) * 0.95, 'power shots are the hard ones');
});

test('auto shots go away from the opponent, and over them when they come in', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  let lobs = 0;
  for (let i = 1; i <= 30; i++) {
    const { g } = atContact(CT, 0, -12.5, 1.0);
    g.players[1].x = 3; g.players[1].y = 11;
    const input = CT.VR.autoShot(g, 0, true, seeded(i));
    assert.ok(input.landX < 0, 'a power shot goes to the open side');
    g.players[1].y = 2.5;
    if (CT.VR.autoShot(g, 0, false, seeded(i)).lob) lobs++;
  }
  assert.ok(lobs > 5 && lobs < 25, `some lobs at a net-rusher: ${lobs}/30`);
});

test('an auto serve lands in the box, a power serve harder', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  for (let i = 1; i <= 12; i++) {
    for (const power of [false, true]) {
      const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 0 });
      CT.requestToss(g, 0);
      while (g.peakT === null) CT.updateGame(g, 1 / 120);
      CT.requestSwipe(g, 0, CT.VR.autoShot(g, 0, power, seeded(i)));
      assert.ok(g.predLand, 'the serve was struck');
      const box = g.serveBox, L = g.predLand;
      assert.ok(Math.sign(L.x) === box.sign && Math.abs(L.x) <= CT.COURT.SW && L.y > 0 && L.y <= CT.COURT.SL, `serve ${i} landed ${L.x}, ${L.y}`);
    }
  }
});

test('the moment to let go counts down to the top of the toss, and to the ball reaching you', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 0 });
  assert.equal(CT.VR.timeToHit(g, 0, null), null);
  CT.requestToss(g, 0);
  CT.updateGame(g, 1 / 60);
  const first = CT.VR.timeToHit(g, 0, null).t;
  assert.ok(first > 0.2, `toss starts ${first}s from its top`);
  let t = first;
  while (g.peakT === null) { CT.updateGame(g, 1 / 120); t = CT.VR.timeToHit(g, 0, null).t; }
  near(t, 0, 0.02, 'zero at the top');
  const info = { t: 0.4, reach: false };
  g.phase = 'rally';
  assert.deepEqual({ ...CT.VR.timeToHit(g, 0, info) }, { t: 0.4, reach: false });
});

// ---------------- WebXR (js/xr.js) ----------------
// A quaternion turning by `a` radians about an axis.
const quat = (ax, a) => ({ x: ax[0] * Math.sin(a / 2), y: ax[1] * Math.sin(a / 2), z: ax[2] * Math.sin(a / 2), w: Math.cos(a / 2) });
const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

test('a headset pose reads as the same yaw, pitch and roll as the phone', () => {
  const { XR } = loadEngine(1, {}, ['vr.js', 'xr.js']);
  const id = XR.angles({ x: 0, y: 0, z: 0, w: 1 });
  near(id.yaw, 0, 1e-9, 'straight ahead yaw'); near(id.pitch, 0, 1e-9, 'pitch'); near(id.roll, 0, 1e-9, 'roll');
  // turning right is a negative turn about +y in WebXR, and reads as + yaw
  near(deg(XR.angles(quat([0, 1, 0], -0.5)).yaw), deg(0.5), 1e-6, 'turned right');
  near(deg(XR.angles(quat([1, 0, 0], 0.3)).pitch), deg(0.3), 1e-6, 'looking up');
  // tilting the head left turns it anticlockwise about the view (+z)
  near(deg(XR.angles(quat([0, 0, 1], 0.2)).roll), deg(0.2), 1e-6, 'tilted left');
  // all three at once come back apart
  const q = qmul(qmul(quat([0, 1, 0], -0.7), quat([1, 0, 0], 0.25)), quat([0, 0, 1], -0.15));
  const a = XR.angles(q);
  near(a.yaw, 0.7, 1e-6, 'yaw'); near(a.pitch, 0.25, 1e-6, 'pitch'); near(a.roll, -0.15, 1e-6, 'roll');
});

test('moving in the room moves you on the court, from where you recentred', () => {
  const { XR } = loadEngine(1, {}, ['vr.js', 'xr.js']);
  // recentred facing -z: a step to -z is forward, +x is right, +y up
  const o = XR.courtOffset({ x: 0.3, y: 0.1, z: -0.4 }, [0, 0, 0], 0);
  near(o.right, 0.3, 1e-9, 'right'); near(o.fwd, 0.4, 1e-9, 'forward'); near(o.up, 0.1, 1e-9, 'up');
  // recentred facing +x (turned right a quarter): a step to +x is forward
  const t = XR.courtOffset({ x: 1.5, y: 1, z: 2 }, [1, 1, 2], Math.PI / 2);
  near(t.fwd, 0.5, 1e-9, 'forward after a turn'); near(t.right, 0, 1e-9, 'no sideways');
  // and you can't walk off the court
  assert.ok(XR.courtOffset({ x: 9, y: 0, z: 0 }, [0, 0, 0], 0).right <= 1.2);
});

test('the shader maps each eye pixel back onto the picture it was drawn in', () => {
  const { XR } = loadEngine(1, {}, ['vr.js', 'xr.js']);
  // a symmetric 90 degree eye, slightly off-centre like a real lens
  const P = new Array(16).fill(0); P[0] = 1; P[5] = 1; P[8] = 0.1; P[9] = -0.05; P[11] = -1;
  const fit = XR.canvasFit([{ projectionMatrix: P }]);
  assert.ok(fit.f > 0 && fit.w === 600 && fit.h >= 500, 'canvas fit');
  // the picture covers a bit more than the eye sees, on every side
  const k = (fit.w / 2) / fit.f;
  assert.ok(k > 1.1 * 1.0, `picture reaches tan ${k}`);
  const lookup = (q, drawn, nx, ny) => {
    const m = XR.warpMatrix(q, drawn);
    const v = [nx / P[0] + P[8] / P[0], ny / P[5] + P[9] / P[5], -1];
    const d = [0, 1, 2].map((i) => m[i] * v[0] + m[3 + i] * v[1] + m[6 + i] * v[2]);
    return { u: 0.5 + (fit.f / fit.w) * d[0] / d[2], v: 0.5 - (fit.f / fit.h) * d[1] / d[2] };
  };
  // drawn this frame from the same pose: the eye's own middle ray lands
  // where the lens centre is in the picture
  const q = qmul(quat([0, 1, 0], -0.4), quat([1, 0, 0], 0.2));
  const now = lookup(q, { yaw: 0.4, pitch: 0.2 }, -P[8], -P[9]);
  near(now.u, 0.5, 1e-6, 'middle u'); near(now.v, 0.5, 1e-6, 'middle v');
  // drawn a frame ago, 0.05 rad further left: what's ahead now sits right of the old middle
  const late = lookup(q, { yaw: 0.35, pitch: 0.2 }, -P[8], -P[9]);
  assert.ok(late.u > 0.5, `turned since: ${late.u}`);
  // a rolled head: the ray to the right of the eye lands up or down the picture, not sideways only
  const rolled = qmul(q, quat([0, 0, 1], 0.3));
  const side = lookup(rolled, { yaw: 0.4, pitch: 0.2 }, 0.5 - P[8], -P[9]);
  assert.ok(side.v < 0.5, `rolled left, the right of the view is higher in the picture: ${side.v}`);
});
