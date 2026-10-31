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
