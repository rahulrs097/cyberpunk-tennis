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
  const g = CT.createGame({ p0: 'octopus', p1: 'philosopher', control: ['human', 'feeder'], autoMove: [true, false], timeScale: 0.65,
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
