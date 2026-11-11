// Touch input (js/input.js): what a finger path means, and what the host
// accepts from an online guest. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./engine');

// a straight swipe from (x0, y0) by (dx, dy) px over `ms`, on a 400 px screen
function path(dx, dy, ms, bow = 0, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, b = bow * Math.sin(Math.PI * f);
    pts.push({ x: 200 + dx * f + b, y: 600 + dy * f, t: ms * f });
  }
  return pts;
}

test('input: a short quick touch is a tap, a held one is nothing, a longer one is a swipe', () => {
  const { Input } = loadEngine();
  assert.equal(Input.gesture(5, 120), 'tap');
  assert.equal(Input.gesture(29, 399), 'tap');
  assert.equal(Input.gesture(5, 900), 'none');
  assert.equal(Input.gesture(30, 900), 'swipe');
  assert.equal(Input.gesture(200, 100), 'swipe');
});

test('input: swipe up is topspin, down is slice with the aim mirrored and a smash aim that is not', () => {
  const { Input } = loadEngine();
  const up = Input.swipeToInput(path(60, -200, 150), 400);
  assert.equal(up.spinDir, 1);
  assert.ok(up.aim > 0.2, 'up and to the right aims right');
  assert.equal(up.smash, undefined);
  const down = Input.swipeToInput(path(60, 200, 150), 400);
  assert.equal(down.spinDir, -1);
  assert.ok(down.aim < -0.2, 'a slice swiped down-right goes left');
  assert.ok(down.smash.aim > 0.2, 'but a smash swiped down-right goes right');
});

test('input: faster swipes hit harder, longer swipes go deeper, and only a wild flick is an overhit', () => {
  const { Input } = loadEngine();
  const slow = Input.swipeToInput(path(0, -160, 400), 400), fast = Input.swipeToInput(path(0, -160, 100), 400);
  assert.ok(slow.pace < fast.pace);
  assert.equal(fast.pace, 1);
  assert.equal(fast.over, 0);
  assert.ok(Input.swipeToInput(path(0, -300, 70), 400).over > 0, 'over 7 screens a second');
  const short = Input.swipeToInput(path(0, -50, 100), 400), long = Input.swipeToInput(path(0, -180, 300), 400);
  assert.ok(short.depth < 0.2 && long.depth === 1, JSON.stringify([short.depth, long.depth]));
});

test('input: a slow long upward swipe is a lob that always goes deep; a bowed path adds sidespin', () => {
  const { Input } = loadEngine();
  const lob = Input.swipeToInput(path(0, -140, 400), 400);
  assert.equal(lob.lob, true);
  assert.equal(lob.depth, 1);
  assert.ok(Math.abs(lob.lead - 0.2) < 1e-9);
  assert.equal(Input.swipeToInput(path(0, 140, 400), 400).lob, false, 'downward is never a lob');
  assert.equal(Input.swipeToInput(path(0, -140, 150), 400).lob, false, 'too fast');
  assert.equal(Math.abs(Input.swipeToInput(path(0, -200, 150), 400).curve), 0);
  const bowed = Input.swipeToInput(path(0, -200, 150, 40), 400);
  assert.ok(Math.abs(bowed.curve) > 0.5);
});

test('input: the spot a swipe points at is passed through', () => {
  const { Input } = loadEngine();
  const i = Input.swipeToInput(path(60, 200, 150), 400, (aim) => aim * 10);
  assert.ok(Math.abs(i.landX - i.aim * 10) < 1e-9);
  assert.ok(Math.abs(i.smash.landX - i.smash.aim * 10) < 1e-9);
});

test('input: a guest shot is checked: numbers are clamped and nonsense is dropped', () => {
  const { Input } = loadEngine();
  assert.equal(Input.cleanInput(undefined), null);
  assert.equal(Input.cleanInput('swipe'), null);
  assert.equal(Input.cleanInput({ aim: 0, pace: 'fast' }), null);
  assert.equal(Input.cleanInput({ aim: NaN, pace: 1 }), null);
  const c = Input.cleanInput({ aim: 9, pace: 50, over: -3, spinDir: -7, curve: 4, depth: 2, landX: 1e9, lob: 'yes', lead: 5, run: 9,
    smash: { aim: -9, landX: 'x' }, roll: true, clear: -5, err: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(c)), { aim: Math.PI / 2, pace: 1, over: 0, spinDir: -1, curve: 1, lob: false, depth: 1, landX: 20, lead: 1, run: 1,
    smash: { aim: -Math.PI / 2 } });
  const ok = Input.swipeToInput(path(60, -200, 150), 400, () => 2.5);
  assert.deepEqual(JSON.parse(JSON.stringify(Input.cleanInput(ok))), JSON.parse(JSON.stringify(ok)), 'a real swipe passes unchanged');
  assert.equal(Input.cleanErr('0'), null);
  assert.equal(Input.cleanErr(Infinity), null);
  assert.equal(Input.cleanErr(0.03), 0.03);
  assert.equal(Input.cleanSpot({ x: 1, y: NaN }), null);
  assert.deepEqual({ ...Input.cleanSpot({ x: 1e6, y: -3 }) }, { x: 30, y: -3 });
});

test('input: no guest message can break the rally on the host', () => {
  const CT = loadEngine(5);
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'remote'], autoMove: [true, true] });
  const bad = [undefined, null, {}, { pace: 'x' }, { aim: NaN, pace: NaN }, { aim: 1e308, pace: -1e308, depth: Infinity, landX: -Infinity }];
  let n = 0;
  for (let i = 0; i < 60 * 40; i++) {
    if (g.phase === 'preServe' && g.phaseWall > 0.8) CT.requestToss(g, g.server);
    if (g.phase === 'toss' && g.peakT !== null && g.time >= g.peakT) CT.requestSwipe(g, g.server, { aim: 0, pace: 0.6, spinDir: 1, curve: 0 });
    if (g.phase === 'rally' && i % 7 === 0) {
      const m = bad[n++ % bad.length], input = CT.Input.cleanInput(m), err = CT.Input.cleanErr(m && m.err);
      if (input && err !== null) CT.requestSwipe(g, 1, input, err);
      const sane = CT.Input.cleanInput({ aim: 1e308, pace: 1e308 });
      CT.requestSwipe(g, 1, sane, CT.Input.cleanErr(0));
    }
    CT.updateGame(g, 1 / 60);
    for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(g.ball.pos[k]) && Number.isFinite(g.ball.vel[k]), 'ball ' + k + ' at frame ' + i);
  }
});
