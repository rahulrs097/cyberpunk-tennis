// Run with `npm test` (Node 20+, no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, levelOpts, makeBot, playSet, loadNet } = require('./engine');

// the engine runs in its own sandbox, so copy its objects out before deepEqual
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---------------- scoring ----------------
function win(CT, m, side, n) { let r; for (let i = 0; i < n; i++) r = CT.awardPoint(m, side); return r; }

test('a game goes 15, 30, 40, game', () => {
  const CT = loadEngine();
  const m = CT.createMatch(0);
  const labels = [];
  for (let i = 0; i < 3; i++) { CT.awardPoint(m, 0); labels.push(CT.pointLabel(m, 0)); }
  assert.deepEqual(plain(labels), ['15', '30', '40']);
  assert.equal(CT.awardPoint(m, 0), 'game');
  assert.deepEqual(plain(m.games), [1, 0]);
  assert.equal(m.server, 1, 'serve passes to the other player');
});

test('deuce and advantage', () => {
  const CT = loadEngine();
  const m = CT.createMatch(0);
  win(CT, m, 0, 3); win(CT, m, 1, 3);
  assert.equal(CT.matchCallout(m), 'Deuce');
  CT.awardPoint(m, 1);
  assert.equal(CT.pointLabel(m, 1), 'AD');
  CT.awardPoint(m, 0);
  assert.equal(CT.matchCallout(m), 'Deuce');
  CT.awardPoint(m, 0);
  assert.equal(CT.awardPoint(m, 0), 'game');
  assert.deepEqual(plain(m.games), [1, 0]);
});

test('a set needs six games and a two-game lead', () => {
  const CT = loadEngine();
  const m = CT.createMatch(0);
  for (let i = 0; i < 5; i++) { win(CT, m, 0, 4); win(CT, m, 1, 4); }
  assert.deepEqual(plain(m.games), [5, 5]);
  win(CT, m, 0, 4);
  assert.equal(m.over, false, '6-5 is not a set');
  assert.equal(win(CT, m, 0, 4), 'set');
  assert.equal(m.winner, 0);
});

test('6-6 goes to a first-to-7, win-by-2 tiebreak with the serve alternating every two points', () => {
  const CT = loadEngine();
  const m = CT.createMatch(0);
  for (let i = 0; i < 6; i++) { win(CT, m, 0, 4); win(CT, m, 1, 4); }
  assert.equal(m.tiebreak, true);
  const first = CT.currentServer(m);
  const servers = [];
  for (let i = 0; i < 6; i++) { servers.push(CT.currentServer(m)); CT.awardPoint(m, i % 2); }
  assert.deepEqual(plain(servers), [first, 1 - first, 1 - first, first, first, 1 - first]);
  // 3-3: to 6-6, then 8-6
  win(CT, m, 0, 3); win(CT, m, 1, 3);
  assert.equal(m.over, false);
  CT.awardPoint(m, 1);
  assert.equal(m.over, false, '7-6 is not enough');
  CT.awardPoint(m, 1);
  assert.equal(m.over, true);
  assert.equal(m.winner, 1);
  assert.deepEqual(plain(m.games), [6, 7]);
});

// ---------------- physics and shots ----------------
test('ball flight is deterministic', () => {
  const CT = loadEngine();
  const pos = { x: 1, y: -11, z: 1 }, vel = { x: -1, y: 25, z: 4 };
  const fly = () => plain(CT.flight(pos, vel, 0.6, 0.2));
  assert.deepEqual(fly(), fly());
  assert.ok(fly().land.y > 0, 'it crosses the net');
});

// A game with side 0 about to hit a ball at (x, y, z).
function atContact(CT, ch, x, y, z) {
  const g = CT.createGame({ p0: ch, p1: 'philosopher', control: ['human', 'cpu'] });
  const p = g.players[0];
  g.phase = 'rally';
  p.x = x - 0.8; p.y = y - 0.35; p.moving = false;
  g.ball = Object.assign(CT.makeBall(), { pos: { x, y, z }, vel: { x: 0, y: -15, z: -1 }, active: true, inFlight: true, bounces: 1, lastHitter: 1 });
  return { g, p };
}

test('a perfectly timed swipe lands in, whoever hits it and wherever it is aimed', () => {
  const CT = loadEngine();
  let n = 0;
  for (const ch of ['octopus', 'philosopher']) {
    for (const x of [-3.5, 0, 3.5]) {
      for (const z of [0.6, 1.0, 1.6]) {
        for (const landX of [-3.6, 0, 3.6]) {
          for (const pace of [0.2, 0.6, 1]) {
            for (const spinDir of [1, -1]) {
              const { g, p } = atContact(CT, ch, x, -12.5, z);
              const shot = CT._computeShot(g, p, { aim: 0, landX, pace, spinDir, curve: 0, depth: 1 }, 0);
              const fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
              assert.ok(fl.land.y > 0 && CT.inSingles(fl.land.x, fl.land.y),
                `${ch} from x=${x} z=${z} to ${landX} at pace ${pace} spin ${spinDir} landed at ${fl.land.x.toFixed(2)}, ${fl.land.y.toFixed(2)}`);
              n++;
            }
          }
        }
      }
    }
  }
  assert.equal(n, 324);
});

test('swiping two timing windows late misses more often than perfect timing', () => {
  const CT = loadEngine();
  let out = 0, total = 0;
  for (const x of [-3, 0, 3]) {
    for (const landX of [-3.6, 0, 3.6]) {
      for (const pace of [0.5, 0.8, 1]) {
        const { g, p } = atContact(CT, 'octopus', x, -12.5, 1.0);
        const shot = CT._computeShot(g, p, { aim: 0, landX, pace, spinDir: 1, curve: 0, depth: 1 }, 2 * p.ch.window.fh);
        const fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
        total++;
        if (!(fl.land.y > 0 && CT.inSingles(fl.land.x, fl.land.y)) || fl.netClear < 0) out++;
      }
    }
  }
  assert.ok(out > 0, 'mistiming should cost something');
  assert.ok(out < total, 'but not every ball');
});

test('a slow upward swipe lobs high and deep, and lands in', () => {
  const CT = loadEngine();
  const { g, p } = atContact(CT, 'octopus', 0, -12.5, 1.0);
  const shot = CT._computeShot(g, p, { aim: 0, landX: 0, pace: 0.3, spinDir: 1, curve: 0, depth: 1, lob: true }, 0);
  const fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side);
  assert.equal(shot.lob, true);
  const peak = shot.pos.z + (shot.vel.z * shot.vel.z) / (2 * 9.81);
  assert.ok(peak > 4.5, `lob peaks at ${peak}`);
  assert.ok(CT.inSingles(fl.land.x, fl.land.y) && fl.land.y > CT.COURT.SL, 'deep and in');
});

// Swipe a lob `late` seconds after the ball reaches the contact plane.
function lobLate(CT, input, late) {
  let hit = null;
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'feeder'], autoMove: [true, false], timeScale: 0.75,
    drill: { reps: 0, wing: 'fh' }, onEvent: (t, e) => { if (t === 'hit' && e.side === 0) hit = e; } });
  const p = g.players[0];
  let crossedAt = null;
  for (let i = 0; i < 60 * 10 && !hit; i++) {
    CT.updateGame(g, 1 / 60);
    if (crossedAt === null && p.cross) crossedAt = g.wall;
    if (crossedAt !== null && g.wall - crossedAt >= late) { CT.requestSwipe(g, 0, input); break; }
  }
  return hit;
}

test('a lob is timed from the middle of the slow swipe, so lifting the finger after contact is on time', () => {
  const CT = loadEngine();
  const lob = { aim: 0, pace: 0.2, spinDir: 1, curve: 0, depth: 1, lob: true };
  const timed = lobLate(CT, { ...lob, lead: 0.15 }, 0.15);
  assert.ok(timed && timed.spin === 'Lob' && timed.perfect, JSON.stringify(timed));
  const noLead = lobLate(CT, lob, 0.15);
  assert.ok(!noLead || !noLead.perfect, 'without the lead the same swipe is late');
});

// The ball machine's first feed, then a swipe `at` seconds after the ball
// reaches the player (negative = before, timed from the feed leaving).
function swipeFeed(CT, at) {
  const whiffs = [];
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'feeder'], autoMove: [true, false], timeScale: 0.75,
    drill: { reps: 0, wing: 'fh' }, onEvent: (t, e) => { if (t === 'whiff') whiffs.push(e); } });
  const p = g.players[0];
  for (let i = 0; i < 60 * 10 && !whiffs.length; i++) {
    CT.updateGame(g, 1 / 60);
    const fed = g.phase === 'rally' && g.ball.inFlight && g.ball.lastHitter === 1;
    if (at < 0 ? fed && g.time - g.lastHitT >= 0.05 : p.cross && g.wall >= p.cross.wall + at) CT.requestSwipe(g, 0, { aim: 0, pace: 0.6, spinDir: 1, curve: 0 });
    if (p.cross && p.cross.wall === undefined) p.cross.wall = g.wall;
  }
  return { p, whiffs };
}

test('a swipe that is far too early or too late still swings the racket', () => {
  const CT = loadEngine();
  for (const [at, reason] of [[-1, 'Too early'], [0.4, 'Too late']]) {
    const { p, whiffs } = swipeFeed(CT, at);
    assert.equal(whiffs[0] && whiffs[0].reason, reason);
    assert.ok(p.swing >= 0 && (p.swingWing === 'fh' || p.swingWing === 'bh'), `${reason}: swing ${p.swing} ${p.swingWing}`);
  }
});

// A fast ball (25 m/s) at side 0's forehand, swiped `late` game seconds after
// it reaches them. Returns what the swipe did: 'hit' or the whiff's reason.
function swipeLate(CT, late) {
  let did = null;
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], timeScale: 1,
    onEvent: (t, d) => { if (t === 'whiff') did = d.reason; if (t === 'hit' && d.side === 0) did = 'hit'; } });
  const p = g.players[0];
  g.phase = 'rally';
  p.x = 0; p.y = -12;
  g.ball = Object.assign(CT.makeBall(), { pos: { x: 0.8, y: -4, z: 0.9 }, vel: { x: 0, y: -25, z: 3 }, active: true, inFlight: true, bounces: 1, lastHitter: 1 });
  for (let i = 0; i < 240 && !did; i++) {
    CT.updateGame(g, 1 / 120);
    if (p.cross && g.time - p.cross.t >= late) { CT.requestSwipe(g, 0, { aim: 0, pace: 0.6, spinDir: 1, curve: 0 }); break; }
  }
  return did;
}

test('a late swipe at a ball that came right to you says too late, not out of reach', () => {
  const CT = loadEngine();
  assert.equal(swipeLate(CT, 0.1), 'hit');
  // inside the timing window, but the ball has flown on past the racket by now
  for (const late of [0.16, 0.2, 0.24]) assert.equal(swipeLate(CT, late), 'Too late', `${late} s late`);
});

test('a swipe at a serve before it bounces is too early, not ignored', () => {
  const CT = loadEngine(5);
  const whiffs = [];
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 1, ...levelOpts(CT, 'club'),
    onEvent: (t, d) => { if (t === 'whiff' && d.side === 0) whiffs.push(d.reason); } });
  const p = g.players[0];
  let swiped = false;
  for (let i = 0; i < 60 * 10 && !swiped; i++) {
    CT.updateGame(g, 1 / 60);
    const b = g.ball;
    if (g.phase === 'rally' && b.isServe && b.bounces === 0 && b.lastHitter === 1 && g.time - g.lastHitT > 0.1) {
      CT.requestSwipe(g, 0, { aim: 0, pace: 0.6, spinDir: 1, curve: 0 });
      swiped = true;
    }
  }
  assert.ok(swiped, 'the CPU served');
  assert.deepEqual(plain(whiffs), ['Too early']);
  assert.ok(p.swing >= 0, 'and the racket swings');
});

test('the landing mark shows where a serve will bounce from the moment it is struck', () => {
  const CT = loadEngine(5);
  let bounce = null;
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 1, ...levelOpts(CT, 'club'),
    onEvent: (t, d) => { if (t === 'bounce' && !bounce) bounce = d; } });
  let mark = null;
  for (let i = 0; i < 240 * 10 && !bounce; i++) {
    CT.updateGame(g, 1 / 240);
    if (g.phase === 'rally' && g.ball.isServe && !mark) {
      mark = CT.landingFor(g, 0);
      assert.equal(CT.landingFor(g, 1), null, 'not for the server');
    }
  }
  assert.ok(bounce, 'the serve bounced');
  assert.ok(mark, 'the mark showed before the bounce');
  assert.ok(Math.hypot(mark.x - bounce.x, mark.y - bounce.y) < 0.05, `mark ${mark.x},${mark.y} vs bounce ${bounce.x},${bounce.y}`);
  assert.equal(CT.landingFor(g, 0), null, 'and goes once it has bounced');
  // a serve on its way into the net shows none
  const g2 = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], firstServer: 1, ...levelOpts(CT, 'club') });
  while (!(g2.phase === 'rally' && g2.ball.isServe)) CT.updateGame(g2, 1 / 240);
  assert.ok(CT.landingFor(g2, 0));
  g2.ball.vel.z = -8;
  assert.equal(CT.landingFor(g2, 0), null);
});

test('a swipe so fast it overhits says so', () => {
  const CT = loadEngine();
  const shots = [];
  for (const over of [0, 0.5]) {
    const { g, p } = atContact(CT, 'octopus', 0, -12.5, 1);
    g.onEvent = (t, d) => { if (t === 'hit') shots.push(d); };
    CT._applyShot(g, p, CT._computeShot(g, p, { aim: 0, landX: 0, pace: 1, over, spinDir: 1, curve: 0, depth: 1 }, 0));
  }
  assert.deepEqual(shots.map((d) => d.overhit), [false, true]);
});

// Side 1 hits a ball that lands at (x, y) on side 0's half; where does an
// auto-moving side 0 run?
function chase(CT, x, y) {
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], autoMove: [true, false] });
  const p = g.players[0];
  g.phase = 'rally';
  p.x = 0; p.y = -11.5; p.reactUntil = 0;
  const pos = { x: 0, y: 10, z: 1 }, vel = { x: 0, y: -22, z: 2 };
  for (let i = 0; i < 40; i++) {
    const land = CT.flight(pos, vel, 0, 0).land;
    vel.x += (x - land.x) * 0.5; vel.z += (land.y - y) * 0.2;
  }
  g.ball = Object.assign(CT.makeBall(), { pos, vel, active: true, inFlight: true, bounces: 0, lastHitter: 1 });
  CT._cpuPlan(g, p);
  return p;
}

test('automove runs at a ball landing just out and lets it go, but not at one well out', () => {
  const CT = loadEngine();
  const edge = CT.COURT.SW;
  const inBall = chase(CT, edge - 0.3, -9);
  assert.ok(!inBall.leaving && inBall.tx > 3, `in: ${inBall.tx} ${inBall.leaving}`);
  const justOut = chase(CT, edge + 0.6, -9);
  assert.ok(justOut.leaving && justOut.tx > 3.5, `just out: ${justOut.tx} ${justOut.leaving}`);
  const wellOut = chase(CT, edge + 2, -9);
  assert.ok(wellOut.leaving && Math.abs(wellOut.tx) <= 2.2, `well out: ${wellOut.tx} ${wellOut.leaving}`);
  const long = chase(CT, 1, -CT.COURT.HL - 0.6);
  assert.ok(long.leaving && long.ty < -CT.COURT.HL, `long: ${long.ty}`);
});

test('a fast downward swipe still slices with real backspin', () => {
  const CT = loadEngine();
  for (const z of [0.8, 1.6]) {
    const { g, p } = atContact(CT, 'octopus', 0, -12.5, z);
    const shot = CT._computeShot(g, p, { aim: 0, landX: 0, pace: 1, spinDir: -1, curve: 0, depth: 1 }, 0);
    assert.ok(shot.spin < -0.2, `spin ${shot.spin} at z=${z}`);
  }
});

test('being jammed, stretched or on the run counts as mistiming', () => {
  const CT = loadEngine();
  const input = { aim: 0, landX: 0, pace: 0.7, spinDir: 1, curve: 0, depth: 1 };
  const clean = (() => { const { g, p } = atContact(CT, 'octopus', 0, -12.5, 1); return CT._computeShot(g, p, input, 0); })();
  assert.equal(clean.note, '');
  const jam = (() => { const { g, p } = atContact(CT, 'octopus', 0, -12.5, 1); p.x = 0; return CT._computeShot(g, p, input, 0); })();
  assert.equal(jam.note, 'Jammed');
  assert.ok(Math.abs(jam.e) > Math.abs(clean.e));
  const run = (() => { const { g, p } = atContact(CT, 'octopus', 0, -12.5, 1); p.moving = true; p.v = p.ch.speed; return CT._computeShot(g, p, input, 0); })();
  assert.equal(run.note, 'On the run');
});

test('back-to-back power groundstrokes tire you, but attacking the net does not', () => {
  const CT = loadEngine();
  const input = { aim: 0, landX: 0, pace: 0.9, spinDir: 1, curve: 0, depth: 1 };
  // stamina spent hitting these kinds one after another (swings included)
  const cost = (kinds) => {
    const { g, p } = atContact(CT, 'octopus', 0.6, -12.5, 1);
    const base = CT._computeShot(g, p, input, 0);
    for (const kind of kinds) CT._applyShot(g, p, { ...base, pos: { ...base.pos }, kind });
    return 100 - p.stamina;
  };
  const swings = (n) => 0.4 * n;
  // baseline power spam: 3 + 6 + 9
  assert.ok(Math.abs(cost(['power', 'power', 'power']) - (18 + swings(3))) < 1e-6);
  // approach, power volley, smash, power volley: only the approach costs extra
  assert.ok(Math.abs(cost(['power', 'powerVolley', 'overhead', 'powerVolley']) - (3 + swings(4))) < 1e-6);
  // a put-away at the net breaks the run, so the next power groundstroke starts at 3
  assert.ok(Math.abs(cost(['power', 'power', 'volley', 'power']) - (12 + swings(4))) < 1e-6);
});

// ---------------- whole sets ----------------
test('a CPU-vs-CPU set finishes with a valid score, and stamina runs down', () => {
  const CT = loadEngine(7);
  const r = playSet(CT, { p0: 'octopus', p1: 'philosopher', control: ['cpu', 'cpu'], extra: levelOpts(CT, 'club') });
  assert.ok(r.finished, 'the set ended');
  const [a, b] = r.games;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  assert.ok((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)), `score ${a}-${b}`);
  assert.ok(Math.min(...r.stats.minStamina) < 50, `lowest stamina ${r.stats.minStamina}`);
});

test('the levels get harder: the same player wins more games on Chill than on Pro', () => {
  const games = {};
  for (const level of ['chill', 'pro']) {
    const CT = loadEngine(11);
    const r = playSet(CT, { p0: 'octopus', p1: 'philosopher', control: ['bot', 'cpu'], skill: 0.7, extra: levelOpts(CT, level) });
    games[level] = r.games[0] - r.games[1];
  }
  assert.ok(games.chill > games.pro, JSON.stringify(games));
  assert.ok(games.chill > 0, 'an average player beats Chill');
});

// ---------------- tutorial ----------------
function drill(CT, d, play) {
  const ends = [];
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'feeder'], autoMove: [true, false], timeScale: 0.75,
    drill: { reps: 0, ...d }, onEvent: (t, e) => { if (t === 'drill') ends.push(e); } });
  const bot = play && makeBot(CT, g, 0, 0, () => 0.5);
  for (let i = 0; i < 60 * 30 && ends.length < 4; i++) { if (bot) bot(); CT.updateGame(g, 1 / 60); }
  return { g, ends };
}

test('the ball machine feeds the player and a good swipe counts as in', () => {
  const CT = loadEngine();
  for (const wing of ['fh', 'bh']) {
    const { ends } = drill(CT, { wing }, true);
    assert.equal(ends.length, 4);
    assert.ok(ends.every((e) => e.ok === true && e.text === 'In' && e.y > 0), JSON.stringify(ends));
    assert.ok(ends.every((e) => e.shot && e.shot.side === 0));
  }
});

test('the machine never returns a ball, and missing it is a failed rep', () => {
  const CT = loadEngine();
  const { g, ends } = drill(CT, { wing: 'fh' }, false);
  assert.ok(ends.length >= 2);
  assert.ok(ends.every((e) => e.ok === false && e.text === 'Missed'));
  assert.equal(g.match.games[0] + g.match.games[1], 0, 'the score never moves');
});

test('volley and smash drills: the player at the net hits the ball out of the air', () => {
  const CT = loadEngine();
  for (const [feed, kinds] of [['volley', ['volley', 'powerVolley']], ['smash', ['overhead']]]) {
    const { ends } = drill(CT, { feed, wing: 'fh' }, true);
    assert.equal(ends.length, 4);
    assert.ok(ends.every((e) => e.ok === true && e.shot && kinds.includes(e.shot.kind)), feed + ' ' + JSON.stringify(ends));
  }
});

test('serve drill: the player always serves, alternating courts', () => {
  const CT = loadEngine();
  const { ends } = drill(CT, { serve: true }, true);
  assert.equal(ends.length, 4);
  assert.ok(ends.every((e) => e.ok !== undefined));
  const sides = ends.filter((e) => e.ok).map((e) => Math.sign(e.x));
  assert.ok(sides.length >= 2);
  assert.ok(sides.includes(1) && sides.includes(-1), 'both service boxes');
});

// ---------------- online ----------------
test('a snapshot carries the match to the guest', () => {
  const CT = loadEngine(5);
  const host = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['cpu', 'cpu'] });
  for (let i = 0; i < 60 * 8; i++) CT.updateGame(host, 1 / 60);
  const guest = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['remote', 'human'], remote: true });
  CT.applySnapshot(guest, JSON.parse(JSON.stringify(CT.snapshot(host))));
  assert.equal(guest.phase, host.phase);
  assert.deepEqual(plain(guest.match.games), plain(host.match.games));
  assert.deepEqual(plain(guest.ball.pos), plain(host.ball.pos));
  assert.equal(guest.players[1].x, host.players[1].x);
});

// ---------------- bounce ----------------
// One bounce of a ball arriving at `speed` m/s, `deg` below horizontal.
function bounceOf(CT, speed, deg, spin) {
  const a = (deg * Math.PI) / 180;
  const b = Object.assign(CT.makeBall(), { vel: { x: 0, y: speed * Math.cos(a), z: -speed * Math.sin(a) }, spin });
  CT.bounce(b);
  return { keep: b.vel.y / (speed * Math.cos(a)), rest: b.vel.z / (speed * Math.sin(a)), spin: b.spin };
}

test('a flat ball bounces like a medium hard court (ITF test: 30 m/s at 16 degrees)', () => {
  const CT = loadEngine();
  const r = bounceOf(CT, 30, 16, 0);
  assert.ok(r.rest > 0.78 && r.rest < 0.86, `vertical restitution ${r.rest}`);
  assert.ok(r.keep > 0.62 && r.keep < 0.75, `keeps ${r.keep} of its pace`);
});

test('spin changes how much pace a bounce keeps, not how high it rebounds', () => {
  const CT = loadEngine();
  for (const [speed, deg] of [[25, 12], [18, 20], [9, 40]]) {
    const top = bounceOf(CT, speed, deg, 0.8), flat = bounceOf(CT, speed, deg, 0), slice = bounceOf(CT, speed, deg, -0.5);
    // (a fast, shallow ball slides right through, so slice and flat match there)
    assert.ok(top.keep > flat.keep && flat.keep >= slice.keep && top.keep > slice.keep, `${speed} m/s at ${deg}: ${top.keep} ${flat.keep} ${slice.keep}`);
    assert.equal(top.rest.toFixed(6), slice.rest.toFixed(6));
  }
});

test('a steep slice checks, a steep topspin ball kicks on, and both leave with topspin', () => {
  const CT = loadEngine();
  const slice = bounceOf(CT, 9, 40, -0.55), top = bounceOf(CT, 9, 40, 1.3);
  assert.ok(slice.keep < 0.4, `slice drop shot keeps ${slice.keep}`);
  assert.ok(top.keep > 0.95, `topspin lob keeps ${top.keep}`);
  for (const r of [slice, top, bounceOf(CT, 22, 11, -0.4)]) assert.ok(r.spin >= 0, `spin after the bounce ${r.spin}`);
});

// An online match over a link with `lag` seconds each way: the host runs the
// match and sends a snapshot every 50 ms; the guest (side 1, automove on)
// swings as the ball reaches its contact plane, the way a person on the guest
// phone would. Returns what the guest saw of each of its shots (how far the
// ball carried on past the swing, and the biggest correction a snapshot
// made), and what the host saw of them (how far the drawn ball got past the
// guest's racket, and its biggest move in one frame).
function onlineRally(CT, lag, frames) {
  const host = CT.createGame({ p0: 'octopus', p1: 'philosopher', timeScale: 1, control: ['cpu', 'remote'], autoMove: [false, true] });
  const guest = CT.createGame({ p0: 'octopus', p1: 'philosopher', timeScale: 1, control: ['remote', 'human'], remote: true, onEvent: () => {} });
  const toGuest = [], toHost = [];
  const dt = 1 / 60;
  let now = 0, swungAt = -1, swing = null, latest = null, hostHits = 0;
  const shots = [];
  const hostShots = [];
  let onHost = null, hostDrawn = null;
  host.onEvent = (type, d) => {
    if (type === 'hit' && d.side === 1) { hostHits++; if (latest) latest.hit = true; if (onHost) onHost.hitAt = now; }
    toGuest.push({ at: now + lag, ev: { type, d } });
  };
  for (let f = 0; f < frames; f++) {
    now += dt;
    const hv = hostDrawn, hPhase = host.phase;
    CT.updateGame(host, dt);
    while (toHost.length && toHost[0].at <= now) { const m = toHost.shift(); CT.requestSwipe(host, 1, m.input, m.err); }
    hostDrawn = { ...CT.viewBall(host).pos };
    // the host's drawn ball around each of the guest's shots: how far it gets
    // past the guest's racket, and its biggest move in one frame
    if (hPhase === 'rally' && host.phase === 'rally') {
      const q = hostDrawn;
      if (host.ball.lastHitter === 0) {
        if (!onHost) onHost = { past: 0, step: 0 };
        onHost.past = Math.max(onHost.past, q.y - (host.players[1].y - 0.35));
      }
      if (onHost) onHost.step = Math.max(onHost.step, Math.hypot(q.x - hv.x, q.y - hv.y, q.z - hv.z));
      if (onHost && onHost.hitAt !== undefined && now - onHost.hitAt > 0.4) { hostShots.push(onHost); onHost = null; }
    } else onHost = null;
    if (f % 3 === 0) toGuest.push({ at: now + lag, s: JSON.parse(JSON.stringify(CT.snapshot(host))) });
    CT.updateGame(guest, dt);
    while (toGuest.length && toGuest[0].at <= now) {
      const m = toGuest.shift();
      if (m.s) {
        const was = { ...guest.ball.pos };
        CT.applySnapshot(guest, m.s);
        const q = guest.ball.pos;
        if (swing) swing.jump = Math.max(swing.jump, Math.hypot(q.x - was.x, q.y - was.y, q.z - was.z));
      }
      else if (m.ev.type === 'whiff' && m.ev.d.side === 1 && CT.cancelPrediction) CT.cancelPrediction(guest);
    }
    const p = guest.players[1], b = guest.ball;
    // how far the guest's ball carries on past the swing point, towards the
    // back of their court
    if (swing) {
      swing.over = Math.max(swing.over, b.pos.y - swing.y);
      if (now - swing.t > 0.6) { shots.push(swing); swing = null; }
    }
    if (!swing && guest.phase === 'rally' && guest.lastHitT !== swungAt && b.lastHitter === 0 && p.cross && p.cross.t >= guest.lastHitT) {
      const tm = CT.swipeTiming(guest, 1);
      if (!tm || tm.whiff) continue;
      swungAt = guest.lastHitT;
      const input = { aim: 0, pace: 0.6, spinDir: 1, curve: 0, depth: 0.8 };
      if (CT.predictSwipe) CT.predictSwipe(guest, 1, input, tm.err);
      toHost.push({ at: now + lag, input, err: tm.err });
      swing = latest = { t: now, y: b.pos.y, over: 0, jump: 0, hit: false };
    }
  }
  return { shots, hostHits, hostShots };
}

test("online: the guest's shots leave its racket at once on both phones, with no jumps", () => {
  for (const lag of [0.05, 0.12, 0.2]) {
    const CT = loadEngine(7);
    const { shots, hostHits, hostShots } = onlineRally(CT, lag, 60 * 40);
    assert.ok(hostHits >= 3, `the host counted the guest's hits (${hostHits})`);
    const hit = shots.filter((s) => s.hit);
    assert.ok(hit.length >= 3);
    for (const s of hit) {
      assert.ok(s.over < 0.4, `lag ${lag}: ball carried ${s.over.toFixed(2)} m past the guest after the swing`);
      assert.ok(s.jump < 0.5, `lag ${lag}: ball jumped ${s.jump.toFixed(2)} m when the host's state arrived`);
    }
    // On the host, the ball waits at the guest's racket for their swipe and
    // then glides out, instead of flying on past them and teleporting back.
    assert.ok(hostShots.length >= 3);
    for (const s of hostShots) {
      assert.ok(s.past < 1.6, `lag ${lag}: host drew the ball ${s.past.toFixed(2)} m past the guest`);
      assert.ok(s.step < 1.2, `lag ${lag}: host's ball jumped ${s.step.toFixed(2)} m in one frame`);
    }
  }
});

// A link whose round trip is `rtt` ms (Infinity: stalled), pinged as main.js
// does. Returns the lag meter's state every 10 ms.
function lagRun(Net, m, clock, rtt, ms) {
  const states = [];
  for (const end = clock.t + ms; clock.t < end; clock.t += 10) {
    if (clock.t % Net.PING_EVERY === 0) { m.sent(clock.t); if (Number.isFinite(rtt)) clock.due.push([clock.t + rtt, clock.t]); }
    while (clock.due.length && clock.due[0][0] <= clock.t) m.answered(clock.due.shift()[1], clock.t);
    states.push({ t: clock.t, ...m.state(clock.t) });
  }
  return states;
}

test('online lag: the ping shows over 150 ms, red over 400, and pauses the match over 450 until it settles', () => {
  const Net = loadNet();
  const m = Net.createLagMeter(), clock = { t: 0, due: [] };
  const last = (st) => st[st.length - 1];
  let st = lagRun(Net, m, clock, 100, 3000);
  assert.deepEqual(plain([last(st).level, st.some((s) => s.held)]), [null, false]);
  st = lagRun(Net, m, clock, 250, 3000);
  assert.deepEqual(plain([last(st).level, st.some((s) => s.held)]), ['yellow', false]);
  st = lagRun(Net, m, clock, 420, 3000);
  assert.deepEqual(plain([last(st).level, st.some((s) => s.held)]), ['red', false]);
  // over 450: paused, as soon as a ping has been out that long
  const from = clock.t;
  st = lagRun(Net, m, clock, 600, 3000);
  const heldAt = st.find((s) => s.held).t - from;
  assert.ok(heldAt <= 500, `paused after ${heldAt} ms`);
  assert.ok(st.slice(st.indexOf(st.find((s) => s.held))).every((s) => s.held), 'and stays paused');
  // back to normal: plays on once it has been 450 or under for a second
  const back = clock.t;
  st = lagRun(Net, m, clock, 100, 4000);
  const calm = st.find((s) => s.ms <= 450).t, free = st.find((s) => !s.held).t;
  assert.ok(free - calm >= 1000 && free - back < 2500, `calm at ${calm - back} ms, playing at ${free - back} ms`);
  assert.equal(last(st).level, null);
  // a link that stops answering pauses within half a second or so
  const stall = clock.t;
  st = lagRun(Net, m, clock, Infinity, 2000);
  assert.ok(st.find((s) => s.held).t - stall <= 1000);
});

// ---------------- line calls ----------------
test('line margin: how far the ball missed the line, or how much of it stayed in', () => {
  const CT = loadEngine();
  const { SW, HL, SL } = CT.COURT, R = CT.PHYS.R;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(CT.lineMargin(0, HL + R + 0.04), 0.04), 'long by 4 cm');
  assert.ok(near(CT.lineMargin(-SW - R - 0.002, 3), 0.002), 'wide by 2 mm');
  assert.ok(near(CT.lineMargin(SW + R - 0.01, -5), -0.01), '1 cm of the ball on the line');
  assert.ok(CT.lineMargin(0, 5) < -1, 'mid-court is nowhere near');
  const box = { side: 1, sign: 1 };
  assert.ok(near(CT.lineMargin(2, SL + R + 0.05, box), 0.05), 'serve long by 5 cm');
  assert.ok(near(CT.lineMargin(-CT.COURT.LW / 2 - R - 0.03, 3, box), 0.03), 'serve wide of the centre line by 3 cm');
  // the margin makes the same call as the umpire
  for (const [x, y] of [[SW + R - 1e-6, 0], [SW + R + 1e-6, 0], [1, HL + R - 1e-6], [-SW - 0.02, -HL - 0.02]]) {
    assert.equal(CT.lineMargin(x, y) <= 0, CT.inSingles(x, y));
  }
  for (const [x, y] of [[-CT.COURT.LW / 2 - R + 1e-6, 3], [-CT.COURT.LW / 2 - R - 1e-6, 3], [SW, SL + R - 1e-6], [2, SL + R + 1e-6]]) {
    assert.equal(CT.lineMargin(x, y, box) <= 0, CT.inServiceBox(x, y, box));
  }
});

test('every first bounce over the net comes with a line call', () => {
  const CT = loadEngine(3);
  const calls = [];
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', ...levelOpts(CT, 'pro'), control: ['cpu', 'cpu'], onEvent: (t, d) => { if (t === 'lineCall') calls.push(d.m); } });
  for (let i = 0; i < 60 * 120; i++) CT.updateGame(g, 1 / 60);
  assert.ok(calls.length > 20, `saw ${calls.length} line calls`);
  assert.ok(calls.some((m) => m > 0) && calls.some((m) => m <= 0), 'both ins and outs');
});

// ---------------- achievements and stats ----------------
// Plays `seq` through real scoring and feeds a tracker for side 0 the 'point'
// events the engine would send. seq: one entry per point, 0/1 = who won it,
// 'A' = side 0 serves an ace, 'D' = side 0 double faults.
function trackSeq(CT, seq, mode = 'pro', firstServer = 0) {
  const m = CT.createMatch(firstServer);
  const t = CT.createAchievementTracker(0, mode);
  const res = [];
  for (const p of seq) {
    const server = CT.currentServer(m);
    const w = p === 'A' ? 0 : p === 'D' ? 1 : p;
    if (p === 'A' || p === 'D') assert.equal(server, 0, 'only the server aces or double faults');
    const tiebreak = m.tiebreak;
    const result = CT.awardPoint(m, w);
    res.push(t.point({ winner: w, text: p === 'A' ? 'Ace' : p === 'D' ? 'Double fault' : 'Winner', result, server, shots: 3, tiebreak, games: m.games.slice() }));
    if (m.over) break;
  }
  return { m, res, earned: res.flatMap((r) => r.earned) };
}
const holdGames = (n) => Array(n * 4).fill(0);

test('aces: tetra and penta ace need four or five aces in the same game', () => {
  const CT = loadEngine();
  // four aces, not all in a row, in one game: ace, lost, ace, ace, lost, ace (deuce), then ad and game
  let r = trackSeq(CT, ['A', 1, 'A', 'A', 1, 'A', 0, 0]);
  assert.deepEqual(plain(r.earned.filter((id) => /ace/i.test(id))), ['ace', 'ace', 'ace', 'ace', 'tetraAce']);
  // a love game of aces is a tetra ace; five aces in one game need deuce
  r = trackSeq(CT, ['A', 'A', 'A', 'A']);
  assert.ok(r.earned.includes('tetraAce') && r.earned.includes('loveGame'));
  r = trackSeq(CT, [1, 1, 1, 'A', 'A', 'A', 'A', 'A']);
  assert.ok(r.earned.includes('pentaAce') && r.earned.includes('tetraAce'));
  // aces split across two service games don't add up
  r = trackSeq(CT, ['A', 'A', 'A', 0, 1, 1, 1, 1, 'A', 'A', 0, 0]);
  assert.ok(!r.earned.includes('tetraAce'));
});

test('game achievements: game on, love game and breaker', () => {
  const CT = loadEngine();
  const r = trackSeq(CT, [0, 1, 0, 0, 0, /* receiving: */ 0, 0, 0, 0]);
  assert.deepEqual(plain(r.res[4].earned), ['game']);
  assert.deepEqual(plain(r.res[8].earned), ['game', 'loveGame', 'break']);
});

test('match achievements: a golden 6-0 set on Pro earns the lot, and only Pro counts for the Pro ones', () => {
  const CT = loadEngine();
  const pro = trackSeq(CT, holdGames(6)).earned;
  for (const id of ['match', 'proChampion', 'bagel', 'noLove', 'goldenSet']) assert.ok(pro.includes(id), id);
  assert.ok(!pro.includes('breadstick') && !pro.includes('tiebreak') && !pro.includes('comeback'));
  const club = trackSeq(CT, holdGames(6), 'club').earned;
  assert.ok(club.includes('match') && club.includes('noLove'));
  for (const a of CT.ACHIEVEMENTS.filter((x) => x.pro)) assert.ok(!club.includes(a.id), a.id);
  const online = trackSeq(CT, holdGames(6), 'online').earned;
  assert.ok(!online.includes('bagel'));
});

test('match achievements: breadstick, comeback, tiebreak, and no love is lost to a love game', () => {
  const CT = loadEngine();
  // lose a game to love, then win six: 6-1 breadstick, but not no love
  let r = trackSeq(CT, [1, 1, 1, 1, ...holdGames(6)]);
  assert.deepEqual(plain(r.m.games), [6, 1]);
  assert.ok(r.earned.includes('breadstick') && !r.earned.includes('noLove') && !r.earned.includes('goldenSet'));
  // 0-3 down, then win six in a row
  r = trackSeq(CT, [...Array(12).fill(1), ...holdGames(6)]);
  assert.deepEqual(plain(r.m.games), [6, 3]);
  assert.ok(r.earned.includes('comeback'));
  // trade games to 6-6, then take the tiebreak 7-0
  const trade = []; for (let i = 0; i < 6; i++) trade.push(0, 0, 0, 0, 1, 1, 1, 1);
  r = trackSeq(CT, [...trade, ...Array(7).fill(0)]);
  assert.deepEqual(plain(r.m.games), [7, 6]);
  assert.ok(r.earned.includes('tiebreak'));
  // losing a set earns no match achievements
  r = trackSeq(CT, Array(24).fill(1));
  assert.equal(r.m.winner, 1);
  assert.deepEqual(plain(r.earned), []);
});

test('achievements and stats are saved: counts, firsts, streaks and bests per level', () => {
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const CT = loadEngine(1, { localStorage });
  const rec = CT.loadAchievements();
  const t = CT.createAchievementTracker(0, 'club');
  assert.deepEqual(plain(CT.recordAchievements(rec, t.hit({ side: 0, kind: 'serve', kmh: 181 }), 'club')), []);
  const ace = { winner: 0, text: 'Ace', result: 'point', server: 0, shots: 1, tiebreak: false, games: [0, 0] };
  assert.deepEqual(plain(CT.recordAchievements(rec, t.point(ace), 'club')), ['ace'], 'first ace is new');
  assert.deepEqual(plain(CT.recordAchievements(rec, t.point(ace), 'club')), [], 'second is not');
  CT.recordAchievements(rec, { earned: ['match'], stats: { games: 6 }, best: { longestRally: 24 }, over: { won: true } }, 'club');
  CT.recordAchievements(rec, { earned: [], stats: {}, best: { longestRally: 9 }, over: { won: true } }, 'pro');
  CT.recordAchievements(rec, { earned: [], stats: {}, best: {}, over: { won: false } }, 'club');
  const again = CT.loadAchievements();
  assert.equal(again.earned.ace.n, 2);
  assert.equal(again.earned.match.n, 1);
  const all = CT.achievementStats(again, 'all'), club = CT.achievementStats(again, 'club');
  assert.deepEqual([all.played, all.won, all.streak, all.bestStreak, all.aces, all.fastestServe, all.longestRally], [3, 2, 0, 2, 2, 181, 24]);
  assert.deepEqual([club.played, club.won, club.bestStreak, club.games, club.longestRally], [2, 1, 1, 6, 24]);
  assert.equal(CT.achievementStats(again, 'online').played, 0);
});

test('the saved record is only written when something changed', () => {
  let writes = 0;
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { writes++; store[k] = String(v); } };
  const CT = loadEngine(1, { localStorage });
  const rec = CT.loadAchievements();
  const t = CT.createAchievementTracker(0, 'club');
  // the opponent's shots and our groundstrokes change nothing
  CT.recordAchievements(rec, t.hit({ side: 1, kind: 'ground', kmh: 90 }), 'club');
  CT.recordAchievements(rec, t.hit({ side: 0, kind: 'ground', kmh: 95 }), 'club');
  assert.equal(writes, 0);
  CT.recordAchievements(rec, { earned: [], stats: {}, best: { longestRally: 5 } }, 'club');
  assert.equal(writes, 1, 'a new best is saved');
  CT.recordAchievements(rec, { earned: [], stats: {}, best: { longestRally: 4 } }, 'club');
  assert.equal(writes, 1, 'a shorter rally is not');
});

test('in a real set the tracker counts the points, games and aces the engine scored', () => {
  const CT = loadEngine(11);
  const t = CT.createAchievementTracker(0, 'club');
  const tot = { points: 0, games: 0, aces: 0 };
  let won = 0, aces = 0, over = null;
  const g = CT.createGame({ p0: 'philosopher', p1: 'octopus', control: ['cpu', 'cpu'], ...levelOpts(CT, 'club'), onEvent: (type, d) => {
    if (type === 'point') {
      const res = t.point(d);
      for (const k in res.stats) tot[k] += res.stats[k];
      if (d.winner === 0) won++;
      if (d.winner === 0 && d.text === 'Ace') aces++;
      if (res.over) over = res.over;
    }
  } });
  for (let i = 0; i < 3600 * 60 && g.phase !== 'matchOver'; i++) CT.updateGame(g, 1 / 60);
  assert.equal(g.phase, 'matchOver');
  assert.equal(tot.points, won);
  assert.equal(tot.games, g.match.games[0]);
  assert.equal(tot.aces, aces);
  assert.deepEqual(plain(over), { won: g.match.winner === 0 });
});

test('rocket serve: a perfect full-pace serve reaches 200 km/h, a tired or soft one does not', () => {
  // serve once and play until it's returned or the point ends; what did the serve earn?
  const serve = (pace, stamina) => {
    const CT = loadEngine(3);
    const t = CT.createAchievementTracker(0, 'club');
    const got = { earned: [], fastestServe: 0 };
    let done = false;
    const add = (res) => { got.earned.push(...res.earned); got.fastestServe = Math.max(got.fastestServe, res.best.fastestServe || 0); };
    const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'cpu'], ...levelOpts(CT, 'club'),
      onEvent: (type, d) => {
        if (done || (type !== 'hit' && type !== 'point')) return;
        add(t[type](d));
        done = type === 'point' || d.side === 1;
      } });
    g.players[0].stamina = stamina;
    for (let i = 0; i < 1200 && !done; i++) {
      if (g.phase === 'preServe' && g.phaseWall > 0.5) CT.requestToss(g, 0);
      if (g.phase === 'toss' && g.peakT !== null && g.time >= g.peakT) CT.requestSwipe(g, 0, { aim: 0, pace, over: 0, spinDir: 1, curve: 0 });
      CT.updateGame(g, 1 / 60);
    }
    return got;
  };
  const big = serve(1, 100);
  assert.ok(big.fastestServe >= 200, `${big.fastestServe} km/h`);
  assert.deepEqual(plain(big.earned), ['rocket']);
  assert.deepEqual(plain(serve(0.7, 100).earned), []);
  assert.deepEqual(plain(serve(1, 40).earned), []);
});

test('rocket serve and fastest serve only count once the serve lands in', () => {
  const CT = loadEngine();
  const t = CT.createAchievementTracker(0, 'club');
  const serve = (kmh) => t.hit({ side: 0, kind: 'serve', kmh });
  const point = (winner, text) => t.point({ winner, text, result: 'point', server: 0, shots: 1, tiebreak: false, games: [0, 0] });
  // nothing until it's in play
  assert.deepEqual(plain(serve(210)), { earned: [], stats: {}, best: {}, over: null });
  // a double fault: neither serve counts
  serve(150);
  let r = point(1, 'Double fault');
  assert.deepEqual(plain(r.earned), []);
  assert.equal(r.best.fastestServe, undefined);
  // a big first serve that faults, then a second serve that's returned: only the second counts
  serve(212); serve(160);
  r = t.hit({ side: 1, kind: 'ground', kmh: 90 });
  assert.deepEqual(plain([r.earned, r.best]), [[], { fastestServe: 160 }]);
  // a rocket that's returned, and one that's an ace
  serve(205);
  assert.deepEqual(plain(t.hit({ side: 1, kind: 'ground', kmh: 90 }).earned), ['rocket']);
  serve(208);
  r = point(0, 'Ace');
  assert.deepEqual(plain(r.earned), ['ace', 'rocket']);
  assert.equal(r.best.fastestServe, 208);
});
