// Run with `npm test` (Node 20+, no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, levelOpts, makeBot, playSet } = require('./engine');

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
