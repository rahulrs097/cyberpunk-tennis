// Cardboard VR: head tracking maths and the look-and-press controls (js/vr.js).
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

// The eye of the bottom player, looking down the court.
function eyeOf(g, yaw, pitch) {
  const p = g.players[0];
  return { x: p.x, y: p.y - 0.5, z: 1.65, yaw, pitch };
}

test('looking at the far court sets the target; watching the ball on your side keeps it', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'] });
  const p = g.players[0];
  // the far left corner, deep
  const dx = -3 - p.x, dy = 10 - (p.y - 0.5);
  const deep = CT.VR.updateAim(g, 0, eyeOf(g, Math.atan2(dx, dy), Math.atan2(-1.65, Math.hypot(dx, dy))), null);
  near(deep.x, -3, 0.01, 'aims left'); near(deep.y, 10, 0.01, 'deep');
  assert.equal(deep.kind, 'drive');
  // just over the net: a drop shot
  const dy2 = 3.5 - (p.y - 0.5);
  const drop = CT.VR.updateAim(g, 0, eyeOf(g, 0, Math.atan2(-1.65, dy2)), deep);
  assert.equal(drop.kind, 'drop');
  // up into the sky: a lob
  assert.equal(CT.VR.updateAim(g, 0, eyeOf(g, 0.1, 0.3), deep).kind, 'lob');
  // down at your own baseline, or off to the side: the target stays put
  assert.equal(CT.VR.updateAim(g, 0, eyeOf(g, 0, -0.6), deep), deep);
  assert.equal(CT.VR.updateAim(g, 0, eyeOf(g, 1.5, -0.1), deep), deep);
});

function atContact(CT, x, y, z) {
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'] });
  const p = g.players[0];
  g.phase = 'rally';
  p.x = x - 0.8; p.y = y - 0.35; p.moving = false;
  g.ball = Object.assign(CT.makeBall(), { pos: { x, y, z }, vel: { x: 0, y: -15, z: -1 }, active: true, inFlight: true, bounces: 1, lastHitter: 1 });
  return { g, p };
}

test('a well-timed press and release lands where you looked, harder the longer you held', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const speeds = [];
  for (const hold of [0.05, 0.35, 0.8]) {
    for (const ax of [-3, 0, 3]) {
      const { g, p } = atContact(CT, 0, -12.5, 1.0);
      const input = CT.VR.shotInput(g, 0, { x: ax, y: 10, kind: 'drive', depth: 1 }, hold);
      const shot = CT._computeShot(g, p, input, 0);
      const fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
      assert.ok(CT.inSingles(fl.land.x, fl.land.y) && fl.land.y > 0, `hold ${hold} to ${ax} landed ${fl.land.x}, ${fl.land.y}`);
      near(fl.land.x, ax, 0.6, 'lands near the target');
      if (ax === 0) speeds.push(Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z));
    }
  }
  assert.ok(speeds[0] < speeds[1] && speeds[1] < speeds[2], `pace grows with the hold: ${speeds}`);
});

test('looking short plays a sliced drop, looking up a lob, and both land in', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  let { g, p } = atContact(CT, 0, -12.5, 1.0);
  let input = CT.VR.shotInput(g, 0, { x: 1, y: 3.5, kind: 'drop', depth: 0.05 }, 0.5);
  assert.equal(input.spinDir, -1);
  let shot = CT._computeShot(g, p, input, 0);
  let fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
  assert.ok(CT.inSingles(fl.land.x, fl.land.y) && fl.land.y > 0 && fl.land.y < CT.COURT.SL, `drop landed at ${fl.land.y}`);
  ({ g, p } = atContact(CT, 0, -12.5, 1.0));
  input = CT.VR.shotInput(g, 0, { x: -2, y: 10.4, kind: 'lob', depth: 1 }, 0.5);
  shot = CT._computeShot(g, p, input, 0);
  fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
  assert.equal(shot.lob, true);
  assert.ok(CT.inSingles(fl.land.x, fl.land.y) && fl.land.y > CT.COURT.SL, `lob landed at ${fl.land.y}`);
});

test('a serve goes towards the side of the box you looked at', () => {
  const CT = loadEngine(1, {}, ['vr.js']);
  const xs = [];
  for (const ax of [-3.8, 3.8]) {
    const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 0 });
    CT.requestToss(g, 0);
    while (g.peakT === null) CT.updateGame(g, 1 / 120);
    CT.requestSwipe(g, 0, CT.VR.shotInput(g, 0, { x: ax, y: 5, kind: 'drive', depth: 0.3 }, 0.4));
    assert.ok(g.predLand, 'the serve was struck');
    xs.push(g.predLand.x);
  }
  assert.ok(xs[0] < xs[1], `left look serves left of a right look: ${xs}`);
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
