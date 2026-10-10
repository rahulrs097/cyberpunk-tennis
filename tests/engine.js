// Loads the game engine (no DOM) into a fresh sandbox for tests and the
// balance simulation, plus a scripted player that swipes like a person.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILES = ['physics.js', 'characters.js', 'match.js', 'game.js'];

// Math.random is the CPU's only randomness; seeding it makes runs repeatable.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadEngine(seed = 1) {
  const math = Object.create(Math);
  math.random = seeded(seed);
  const sandbox = { Math: math, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }
  sandbox.CT.rand = math.random;
  return sandbox.CT;
}

// The CPU levels, as main.js picks them from the menu.
function levelOpts(CT, level) {
  const L = CT.CPU_LEVELS[level];
  return { timeScale: L.timeScale, cpuErr: L.err, cpuReact: L.react, cpuCover: L.cover, cpuSpeed: L.speed, cpuPace: L.pace, cpuDepth: L.depth };
}

// A scripted player on `side`. skill = timing spread in timing windows
// (0.4 = skilled, 0.7 = average). Moves with automove and aims away from
// the opponent, like a person would.
function makeBot(CT, g, side, skill, rnd) {
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); };
  const p = g.players[side], opp = g.players[1 - side];
  let plan = null, lastHit = -2;
  return function tick() {
    if (g.phase === 'preServe' && g.server === side && g.phaseWall > 0.8) { CT.requestToss(g, side); plan = null; return; }
    if (g.phase === 'toss' && g.server === side) {
      if (g.peakT === null) return;
      if (!plan) plan = { e: Math.abs(gauss()) * skill * 0.5 * p.ch.window.fh };
      if ((g.time - g.peakT) / g.timeScale >= plan.e) {
        CT.requestSwipe(g, side, { aim: (rnd() - 0.5) * 0.6, pace: 0.6 + rnd() * 0.3, spinDir: 1, curve: 0 });
        plan = null;
      }
      return;
    }
    if (g.phase !== 'rally' || g.lastHitT === lastHit) return;
    const info = CT.incomingInfo(g, side);
    if (!plan) {
      if (!info) return;
      const wing = (info.x - p.x) * p.fwd >= 0 ? 'fh' : 'bh';
      const away = opp.x > 0 ? -1 : 1;
      const edge = CT.COURT.SW - 0.45;
      const landX = rnd() < 0.6 ? away * edge * (0.6 + 0.4 * rnd()) : (rnd() - 0.5) * edge;
      plan = {
        hitT: g.lastHitT,
        e: gauss() * skill * p.ch.window[wing],
        input: { aim: 0, landX, pace: 0.55 + rnd() * 0.4, spinDir: rnd() < 0.85 ? 1 : -1, curve: 0, depth: 0.85 + rnd() * 0.15 },
      };
    }
    if (plan.hitT !== g.lastHitT) { plan = null; return; }
    const crossed = p.cross && p.cross.t >= g.lastHitT;
    // (an early swipe whose moment fell between two frames goes as soon as it can)
    const fire = plan.e < 0 ? crossed || (info && info.t <= -plan.e)
      : crossed && (g.time - p.cross.t) / g.timeScale >= plan.e;
    if (fire) { CT.requestSwipe(g, side, plan.input); lastHit = g.lastHitT; plan = null; }
  };
}

// Play one set. control: ['bot'|'cpu', 'cpu']. Returns games, points and stats.
function playSet(CT, opts) {
  const rnd = CT.rand;
  const stats = { points: 0, endings: {}, minStamina: [100, 100], tiredPoints: [0, 0], shots: 0 };
  const g = CT.createGame({
    p0: opts.p0, p1: opts.p1,
    control: opts.control.map((c) => (c === 'bot' ? 'human' : 'cpu')),
    autoMove: opts.control.map((c) => c === 'bot'),
    ...opts.extra,
    onEvent: (t, d) => {
      if (t === 'point') {
        stats.points++;
        // by who won the point: 'Out:0' is an out ball hit by side 1
        const k = d.text + ':' + d.winner;
        stats.endings[k] = (stats.endings[k] || 0) + 1;
        g.players.forEach((p, i) => { if (p.stamina < 35) stats.tiredPoints[i]++; });
      }
      if (t === 'hit') stats.shots++;
    },
  });
  const bots = opts.control.map((c, i) => (c === 'bot' ? makeBot(CT, g, i, opts.skill, rnd) : null));
  let wall = 0;
  while (g.phase !== 'matchOver' && wall < 3600) {
    for (const b of bots) if (b) b();
    CT.updateGame(g, 1 / 60);
    wall += 1 / 60;
    g.players.forEach((p, i) => { stats.minStamina[i] = Math.min(stats.minStamina[i], p.stamina); });
  }
  stats.endStamina = g.players.map((p) => p.stamina);
  return { games: g.match.games.slice(), winner: g.match.winner, finished: g.phase === 'matchOver', stats, game: g };
}

module.exports = { loadEngine, levelOpts, makeBot, playSet };
