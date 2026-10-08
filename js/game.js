// The match engine: players, serving, hitting, line calls and the CPU.
// Side 0 plays from the bottom of the screen (y < 0), side 1 from the top.
// Inputs come in through requestMove / requestToss / requestSwipe so a network
// controller can drive either side later; the CPU uses the same shot pipeline.
// The only randomness in the game is in cpuChooseShot / cpuChooseServe.
(function () {
  const CT = (window.CT = window.CT || {});
  const { COURT, PHYS, clamp, lerp } = CT;

  const POWER_Z = 1.3;          // balls above this can be hit as power shots
  const CONTACT_AHEAD = 0.35;   // ideal contact point in front of the body
  const OUTER = 2.5;            // a swipe more than this many windows off whiffs
  const REACT = 0.24;           // split-step: seconds before an auto-moving player can react to a shot
  const ACCEL = 8;              // m/s² from a standstill to top speed
  const AIM_FULL = 0.6;         // a swipe this many radians off straight aims at the sideline
  const NET_ZONE = 7.5;         // a player this close to the net is at the net
  // An online guest's swipe arrives a round trip after they saw the ball, so
  // the host waits this long (s) past the guest's latest swing before calling
  // a ball the guest was about to hit a winner.
  const LAG_ALLOW = 0.3;

  // Seconds to run `dist` metres from a standstill at top speed `sp`.
  function runTime(dist, sp) {
    const dA = (sp * sp) / (2 * ACCEL);
    return dist < dA ? Math.sqrt((2 * dist) / ACCEL) : (dist - dA) / sp + sp / ACCEL;
  }
  const fwdOf = (side) => (side === 0 ? 1 : -1);
  const rand = (a, b) => a + Math.random() * (b - a);   // CPU shot selection only

  function createPlayer(side, ch) {
    return {
      side, fwd: fwdOf(side), ch,
      x: 0, y: -fwdOf(side) * ch.home, tx: 0, ty: -fwdOf(side) * ch.home,
      stamina: 100, cap: 100, run: 0, streak: 0,
      swing: -1, swingWing: 'fh', moving: false, anim: side * 1.7,
      prevRel: null, cross: null, pending: null, plan: null,
      v: 0, dirX: 0, dirY: 0, reactUntil: 0,
    };
  }

  function createGame(opts) {
    const g = {
      timeScale: opts.timeScale || 0.62,
      time: 0,
      wall: 0,
      acc: 0,
      players: [createPlayer(0, CT.CHARACTERS[opts.p0]), createPlayer(1, CT.CHARACTERS[opts.p1])],
      control: opts.control || ['human', 'cpu'],
      autoMove: opts.autoMove || [false, false],
      ball: CT.makeBall(),
      match: CT.createMatch(opts.firstServer != null ? opts.firstServer : 0),
      phase: 'preServe',
      phaseWall: 0,
      peakT: null,
      serveBox: null,
      lastHitT: -1,
      marks: [],
      trail: [],
      events: [],
      onEvent: opts.onEvent || (() => {}),
      lastShot: null,
      // A remote copy (the guest's phone in an online match) only moves the
      // ball and players between the host's snapshots; the host owns the rules.
      remote: !!opts.remote,
    };
    startPoint(g, true);
    return g;
  }

  // CPU sides always run themselves; a human side does when automove is on.
  // A tap still overrides the run until the next shot.
  function autoMoves(g, side) { return g.control[side] === 'cpu' || !!g.autoMove[side]; }

  function emit(g, type, data) { g.onEvent(type, data || {}); }
  function staminaF(p) { return p.stamina / 100; }
  // Tired legs: top speed falls to 55% on empty.
  function moveSpeed(p) { return p.ch.speed * (0.55 + 0.45 * staminaF(p)); }

  // ---------------- point setup ----------------
  function startPoint(g, fresh) {
    const m = g.match;
    const server = CT.currentServer(m);
    const recv = 1 - server;
    const deuce = CT.deuceSide(m);
    const S = g.players[server], Rp = g.players[recv];
    const rs = deuce ? 1 : -1;                    // + = server's right
    S.x = S.fwd * rs * 0.7; S.y = -S.fwd * (COURT.HL + 0.3);
    const boxSign = deuce ? Rp.fwd : -Rp.fwd;     // receiver's deuce box is on their right
    Rp.x = boxSign * 2.5; Rp.y = -Rp.fwd * Rp.ch.returnDepth;
    // A short breather between points; a proper rest at the changeover
    // (after every odd game). Never above the cap.
    const gamesPlayed = m.games[0] + m.games[1];
    const changeover = gamesPlayed !== g.lastGames && gamesPlayed % 2 === 1;
    g.lastGames = gamesPlayed;
    for (const p of g.players) {
      p.tx = p.x; p.ty = p.y; p.swing = -1; p.pending = null; p.plan = null;
      p.cross = null; p.prevRel = null; p.streak = 0; p.v = 0; p.atNet = false; p.netSpot = null;
      if (!fresh) p.stamina = Math.min(p.cap, p.stamina + (changeover ? 25 : 8));
    }
    g.serveBox = { side: recv, sign: boxSign };
    g.server = server;
    g.ball = CT.makeBall();
    g.trail = [];
    g.phase = 'preServe';
    g.phaseWall = 0;
    g.peakT = null;
    g.peakBall = null;
    g.held = null;
    emit(g, 'serveReady', { server, first: m.firstServe });
  }

  function requestToss(g, side) {
    if (g.phase !== 'preServe' || g.server !== side) return false;
    const S = g.players[side];
    const b = g.ball;
    b.pos = { x: S.x + S.fwd * 0.25, y: S.y + S.fwd * 0.35, z: 1.5 };
    b.vel = { x: 0, y: 0, z: 5.3 };
    b.spin = 0; b.side = 0;
    b.active = true; b.inFlight = false; b.bounces = 0; b.lastHitter = -1;
    g.phase = 'toss';
    g.phaseWall = 0;
    g.peakT = null;
    g.peakBall = null;
    emit(g, 'toss', { side });
    return true;
  }

  function requestMove(g, side, x, y) {
    const p = g.players[side];
    if (g.phase === 'matchOver') return;
    if ((g.phase === 'preServe' || g.phase === 'toss') && g.server === side) return;
    p.tx = clamp(x, -7.5, 7.5);
    const f = clamp(p.fwd * y, -15.6, -0.7);
    p.ty = p.fwd * f;
    // Asking for a spot near the net means coming in: automove keeps heading
    // there after the next shot instead of drifting back to the baseline.
    p.netSpot = -f < NET_ZONE ? { x: p.tx, y: p.ty } : null;
    if (p.netSpot) p.atNet = true;
  }

  // ---------------- hitting ----------------
  function windowFor(p, wing) {
    return p.ch.window[wing] * (0.35 + 0.65 * staminaF(p));
  }

  function canReach(g, p) {
    const b = g.ball;
    return Math.abs(b.pos.x - p.x) <= p.ch.reach &&
      b.pos.z <= p.ch.maxZ &&
      Math.abs(p.fwd * (b.pos.y - p.y)) <= 2.8;
  }

  function incomingTo(g, p) {
    const b = g.ball;
    return g.phase === 'rally' && b.active && b.inFlight && !b.netted &&
      b.lastHitter !== p.side && !(b.isServe && b.bounces === 0);
  }

  // Seconds of game time until the ball crosses p's contact plane, or null.
  function predictCross(g, p, maxT) {
    const b = CT.cloneBall(g.ball);
    const plane = p.fwd * p.y + CONTACT_AHEAD;
    let prev = p.fwd * b.pos.y - plane, t = 0, bounces = b.bounces;
    while (t < maxT) {
      const ev = CT.stepBall(b, PHYS.DT);
      t += PHYS.DT;
      if (ev === 'net') return null;
      if (ev === 'bounce') { bounces++; if (bounces >= 2) return null; }
      const rel = p.fwd * b.pos.y - plane;
      if (prev > 0 && rel <= 0) {
        if (g.ball.isServe && bounces === 0) return null;
        return { t, x: b.pos.x, y: b.pos.y, z: b.pos.z, bounced: bounces > 0 };
      }
      prev = rel;
    }
    return null;
  }

  // Build launch parameters for p hitting the ball where it is now.
  // input: { aim (rad, + = hitter's right), pace 0..1, over 0..1, spinDir ±1, curve -1..1,
  //          depth 0..1, landX (world x to aim at; the CPU's alternative to aim) }
  function computeShot(g, p, input, err) {
    const ch = p.ch, b = g.ball, f = staminaF(p), fwd = p.fwd;
    const pos = { x: b.pos.x, y: b.pos.y, z: Math.max(b.pos.z, 0.08) };
    const isServe = g.phase === 'toss';
    const localX = (pos.x - p.x) * fwd;
    const wing = isServe ? 'fh' : (localX >= -0.05 ? 'fh' : 'bh');
    let kind;
    if (isServe) kind = 'serve';
    else if (pos.z >= ch.overheadZ) kind = 'overhead';
    else if (b.bounces === 0) kind = pos.z >= POWER_Z ? 'powerVolley' : 'volley';
    else if (pos.z >= POWER_Z) kind = 'power';
    else kind = 'ground';

    const W = windowFor(p, wing);
    const e = clamp(err / W, -OUTER, OUTER);
    // Late forehands drift to the hitter's right, late backhands to the left.
    const drift = e * 0.085 * (wing === 'fh' ? 1 : -1);
    const powerF = Math.max(0.7, 1 - 0.1 * Math.pow(Math.abs(e), 1.5));
    const pace = clamp(input.pace, 0, 1), over = clamp(input.over || 0, 0, 1);
    const capF = 0.68 + 0.32 * f;   // tired arms: up to a third less pace
    let speed, spin, margin, minClear = 0.12, depthLine = COURT.HL;
    let side = clamp(input.curve || 0, -1, 1);

    if (kind === 'serve') {
      speed = lerp(30, ch.serve, pace) * capF;
      spin = input.spinDir > 0 ? lerp(0.9, 0.15, pace) : -lerp(0.5, 0.1, pace);
      margin = 0.45 + (1 - pace) * 1.3 - over * 1.6;
      depthLine = COURT.SL;
      minClear = 0.06;
    } else if (kind === 'overhead') {
      speed = ch.pace.fh * 1.25 * (0.85 + 0.15 * pace);
      spin = 0.12;
      margin = 2.2 - over * 2;
      side *= 0.3;
    } else {
      speed = lerp(ch.paceMin, ch.pace[wing], pace) * capF;
      const sm = ch.spin[wing];
      spin = lerp(sm, sm * 0.12, pace);
      if (input.spinDir < 0) spin = -spin * 0.75;
      margin = input.spinDir < 0 ? 1.8 + 2.4 * (1 - pace) : 0.7 + 2.8 * (1 - pace);
      margin -= over * 2.5;
      if (kind === 'power') {
        // A high ball can be driven down hard and flat.
        speed *= 1.22; spin *= 0.5; margin *= 0.7;
      }
      if (kind === 'volley') { speed *= 0.72; spin *= 0.3; }
      // a volley above power height can be punched down hard
      if (kind === 'powerVolley') { speed *= 1.1; spin *= 0.3; margin *= 0.7; }
    }

    // launch at angle `ang` to land `along` metres down the court
    const solve = (ang, spd, along, clear) => CT.solveLaunch(pos, { x: fwd * Math.sin(ang), y: fwd * Math.cos(ang) },
      spd, spin, side, Math.max(1.5, along) / Math.cos(ang), clear);
    let target = depthLine - margin;
    let sol;
    if (kind === 'serve') {
      const box = g.serveBox;
      const T = { x: box.sign * COURT.SW * 0.5, y: fwd * (COURT.SL - 1.6) };
      const a0 = Math.atan2(fwd * (T.x - pos.x), fwd * (T.y - pos.y));
      const a = a0 + clamp(input.aim, -0.8, 0.8) * 0.45 + drift;
      sol = solve(a, speed * powerF, target - fwd * pos.y - (1 - powerF) * 9, minClear - (1 - powerF) * 0.7);
    } else {
      // Short swipes aim short (down to ~3 m past the net) and come off softer
      // so they can actually land there.
      const depth = input.depth === undefined ? 1 : clamp(input.depth, 0, 1);
      target = lerp(3.2, target, depth);
      speed *= lerp(0.5, 1, depth);
      // The swipe angle picks a spot between the sidelines (straight = the
      // middle), so a well-timed angled shot stays in wherever it's hit from.
      const edge = COURT.SW - 0.45;
      const landX = input.landX !== undefined ? clamp(input.landX, -edge, edge)
        : fwd * edge * clamp(input.aim / AIM_FULL, -1, 1);
      const along = target - fwd * pos.y;
      // Solve the well-timed shot first: re-aim for sidespin curl, and when
      // clearing the net would carry it past the baseline, take pace off.
      let aimX = landX, spd = speed, a = 0;
      for (let i = 0; i < 6; i++) {
        a = Math.atan2(fwd * (aimX - pos.x), along);
        sol = solve(a, spd, along, minClear);
        const land = sol.landing.land;
        let again = false;
        if (Math.abs(land.x - landX) > 0.25) { aimX -= land.x - landX; again = true; }
        if (target <= depthLine - 0.3 && fwd * land.y > depthLine - 0.25) { spd *= 0.9; again = true; }
        if (!again) break;
      }
      // Then mistiming costs power and pushes it off line: the ball comes off
      // slower, shorter and a little lower (mostly it misses wide or long).
      if (Math.abs(drift) > 0.002 || powerF < 0.999) {
        sol = solve(a + drift, spd * powerF, along - (1 - powerF) * 9, minClear - (1 - powerF) * 0.7);
        sol.vel.z -= (1 - powerF) * 2;
      }
    }
    const vel = sol.vel;
    return { pos, vel, spin, side, kind, wing, err, e, powerF };
  }

  function applyShot(g, p, shot) {
    const b = g.ball;
    b.pos = { ...shot.pos };
    b.vel = shot.vel; b.spin = shot.spin; b.side = shot.side;
    b.active = true; b.inFlight = true; b.bounces = 0; b.netted = false;
    b.lastHitter = p.side;
    b.isServe = shot.kind === 'serve';
    g.held = null;
    if (shot.kind === 'power' || shot.kind === 'powerVolley') { p.streak++; p.stamina = Math.max(0, p.stamina - 3 * p.streak); }
    else if (shot.kind === 'ground' || shot.kind === 'volley') p.streak = 0;
    p.swing = 0;
    p.swingWing = shot.kind === 'overhead' ? 'oh' : shot.kind === 'serve' ? 'serve' : shot.wing;
    g.phase = 'rally';
    g.lastHitT = g.time;
    for (const q of g.players) { q.prevRel = null; q.cross = null; q.pending = null; }
    const kmh = Math.round(Math.hypot(b.vel.x, b.vel.y, b.vel.z) * 3.6);
    const info = {
      side: p.side, kind: shot.kind, wing: shot.wing, kmh,
      spin: shot.spin > 0.35 ? 'Topspin' : shot.spin < -0.1 ? 'Slice' : 'Flat',
      curve: Math.abs(shot.side) > 0.2 ? (shot.side * p.fwd > 0 ? 'curls right' : 'curls left') : '',
      errMs: Math.round(shot.err * 1000),
      perfect: Math.abs(shot.e) < 0.35,
    };
    g.lastShot = info;
    // where will it land? used for the landing marker
    const fl = CT.flight(b.pos, b.vel, b.spin, b.side);
    g.predLand = fl.land;
    const other = g.players[1 - p.side];
    // auto-moving players need a moment to read the shot; a human moving
    // themselves already has their own reaction time
    // (returners split-step as the server swings, so they react faster)
    if (autoMoves(g, other.side)) { other.reactUntil = g.time + (b.isServe ? 0.08 : REACT); cpuPlan(g, other); }
    if (autoMoves(g, p.side)) cpuRecover(g, p);
    emit(g, 'hit', info);
  }

  function tryHit(g, p, input, err) {
    if (!canReach(g, p)) { emit(g, 'whiff', { side: p.side, reason: 'Out of reach' }); return false; }
    const shot = computeShot(g, p, input, err);
    applyShot(g, p, shot);
    return true;
  }

  // A swipe from a controller. `input` as in computeShot.
  // `errOverride` (seconds, + = late) is timing already judged on the guest's
  // phone against the ball it saw, so network delay doesn't make it late.
  function requestSwipe(g, side, input, errOverride) {
    if (g.remote) return;
    const p = g.players[side];
    const b = g.ball;
    const given = typeof errOverride === 'number';
    if (g.phase === 'toss' && g.server === side) {
      let peak = g.peakT;
      if (peak === null) peak = g.time + Math.max(0, b.vel.z) / PHYS.G;
      const err = given ? errOverride : (g.time - peak) / g.timeScale;
      if (Math.abs(err) > OUTER * windowFor(p, 'fh')) {
        emit(g, 'whiff', { side, reason: err < 0 ? 'Too early, wait for the top of the toss' : 'Too late' });
        return;
      }
      // the guest hit the toss where they saw it, which is higher than it is here by now
      if (given && g.peakBall) {
        const tb = rewound(g.peakBall, err * g.timeScale);
        if (tb) g.ball = tb;
      }
      applyShot(g, p, computeShot(g, p, input, err));
      return;
    }
    if (!incomingTo(g, p)) return;
    const Wout = OUTER * Math.max(windowFor(p, 'fh'), windowFor(p, 'bh'));
    if (given) {
      if (errOverride > Wout) { emit(g, 'whiff', { side, reason: 'Too late' }); return; }
      if (errOverride < -Wout) { emit(g, 'whiff', { side, reason: 'Too early' }); return; }
      // the ball may already have reached them here while the swipe was in flight
      if (p.cross && p.cross.t >= g.lastHitT) hitAsSeen(g, p, input, errOverride);
      else p.pending = { t: g.time, input, err: errOverride };
      return;
    }
    if (p.cross && p.cross.t >= g.lastHitT) {
      const err = (g.time - p.cross.t) / g.timeScale;
      if (err <= Wout) { tryHit(g, p, input, err); return; }
      emit(g, 'whiff', { side, reason: 'Too late' });
      return;
    }
    const c = predictCross(g, p, 3);
    if (!c) { emit(g, 'whiff', { side, reason: 'Nothing to hit' }); return; }
    if (c.t / g.timeScale > Wout) { emit(g, 'whiff', { side, reason: 'Too early' }); return; }
    p.pending = { t: g.time, input };
  }

  // The ball `dt` seconds of game time after state `b`, or null if it bounces
  // twice (or hits the net) on the way.
  function rewound(b, dt) {
    const c = CT.cloneBall(b);
    for (let t = 0; t < dt; t += PHYS.DT) {
      const ev = CT.stepBall(c, PHYS.DT);
      if (ev === 'net') return null;
      if (ev === 'bounce' && c.inFlight && ++c.bounces >= 2) return null;
    }
    return c;
  }

  // An online guest's swipe for a ball that has already reached them on this
  // phone. They saw the ball a trip late and the swipe took another trip to
  // arrive, so hit it from where they met it: the contact plane plus their
  // lateness, with the player where they were then.
  function hitAsSeen(g, p, input, err) {
    const at = p.cross;
    const b = rewound(at.ball, Math.max(0, err) * g.timeScale);
    if (!b) { emit(g, 'whiff', { side: p.side, reason: 'Too late' }); return; }
    const x = p.x, y = p.y, now = g.ball;
    g.ball = b; p.x = at.px; p.y = at.py;
    const hit = tryHit(g, p, input, err);
    // keep running from where they really are
    p.x = x; p.y = y;
    if (!hit) g.ball = now;
  }

  // ---------------- CPU ----------------
  function cpuRecover(g, c) {
    const opp = g.players[1 - c.side];
    c.plan = null;
    if (c.netSpot) {
      c.atNet = true;
      c.tx = c.netSpot.x; c.ty = c.netSpot.y;
      return;
    }
    // Once in the front half of the court, hold the net instead of
    // retreating: cover the line the ball went down, a few metres back.
    if (-c.fwd * c.y < 7.5) {
      c.atNet = true;
      const bx = g.ball.active ? g.ball.pos.x : 0;
      c.tx = clamp(c.x * 0.4 + bx * 0.4, -3, 3);
      c.ty = -c.fwd * clamp(-c.fwd * c.y, 2.6, 4.2);
      return;
    }
    c.atNet = false;
    c.tx = clamp(opp.x * 0.15, -1.5, 1.5);
    c.ty = -c.fwd * c.ch.home;
  }

  function cpuPlan(g, c) {
    const b = CT.cloneBall(g.ball);
    const ch = c.ch, fwd = c.fwd, R = fwd;   // R: +x is the CPU's right when fwd = 1
    const speed = moveSpeed(c);
    let t = 0, bounces = b.bounces;
    const cands = [];
    let step = 0;
    while (t < 4.5) {
      const ev = CT.stepBall(b, PHYS.DT);
      t += PHYS.DT; step++;
      if (ev === 'net') { cpuRecover(g, c); return; }
      if (ev === 'bounce') {
        if (bounces === 0) {
          const onMySide = fwd * b.pos.y < 0;
          const good = g.ball.isServe ? CT.inServiceBox(b.pos.x, b.pos.y, g.serveBox) : CT.inSingles(b.pos.x, b.pos.y);
          if (!onMySide || !good) { cpuRecover(g, c); c.leaving = true; return; }
        }
        bounces++;
        if (bounces >= 2) break;
      }
      if (step % 3) continue;
      if (fwd * b.pos.y >= 0 || fwd * b.vel.y >= 0) continue;
      const bounced = bounces > 0;
      const z = b.pos.z;
      if (bounced) { if (z < 0.25 || z > ch.maxZ) continue; }
      else {
        if (g.ball.isServe) continue;
        if (z < (c.atNet ? 0.3 : 0.45) || z > ch.maxZ) continue;
        if (fwd * b.pos.y < -8 && z < ch.overheadZ) continue;   // only volley near the net
      }
      for (const wing of ['fh', 'bh']) {
        const ws = wing === 'fh' ? 1 : -1;
        let px = b.pos.x - ws * R * 0.75;
        let py = b.pos.y - fwd * CONTACT_AHEAD;
        if (fwd * py > -0.8 || fwd * py < -16.5) continue;
        const dist = Math.hypot(px - c.x, py - c.y);
        const slack = t - ((c.reactUntil - g.time) + runTime(dist, speed) + 0.12);
        let q = -Math.abs(z - 1.0) + (bounced ? 0.4 : 0);
        // at the net: volley it rather than backing up for the bounce
        if (c.atNet) q += bounced ? -1.5 : 0.8;
        if (!bounced && z >= POWER_Z + 0.1 && z < ch.overheadZ) q += 0.6;   // power volley height
        // Punish high balls: smash them out of the air, or take them at
        // shoulder height after the bounce for a power shot.
        if (z >= ch.overheadZ && !bounced) q += 2.2;
        else if (bounced && z >= POWER_Z + 0.1) q += 1.0 + 0.5 * (z - POWER_Z);
        q -= Math.max(0, -fwd * py - ch.home) * 0.25;   // don't drift too far back
        if (ch.id === 'octopus') q += 0.05 * t + (wing === 'bh' ? 0.05 : 0);
        else q += -0.1 * t + (wing === 'fh' ? 0.08 : 0);
        q -= dist * 0.05;
        cands.push({ t, x: px, y: py, z, slack, q, wing });
      }
    }
    c.leaving = false;
    if (!cands.length) { cpuRecover(g, c); return; }
    let best = null;
    for (const k of cands) if (k.slack >= 0.15 && (!best || k.q > best.q)) best = k;
    if (!best) for (const k of cands) if (!best || k.slack > best.slack) best = k;
    c.plan = best;
    c.tx = best.x; c.ty = best.y;
  }

  function cpuChooseShot(g, c) {
    const opp = g.players[1 - c.side];
    const b = g.ball;
    const fwd = c.fwd;
    const slack = c.plan ? c.plan.slack : 0;
    const style = c.ch.id === 'octopus' ? { lo: 0.5, hi: 0.85, slice: 0.07 } : { lo: 0.45, hi: 0.95, slice: 0.12 };
    let pace = rand(style.lo, style.hi);
    if (slack < 0.2) pace *= 0.75;
    if (b.pos.z < 0.5) pace *= 0.85;
    let spinDir = (b.pos.z < 0.42 || slack < 0.05) ? -1 : (Math.random() < style.slice ? -1 : 1);
    const r = Math.random();
    const away = opp.x > 0 ? -1 : 1;
    let tx;
    if (r < 0.55) tx = away * rand(1.4, 3.5);
    else if (r < 0.8) tx = rand(-1.4, 1.4);
    else tx = -away * rand(1.4, 3.3);
    if (slack < 0.2) tx *= 0.5;   // stretched: play it back through the middle
    const curve = rand(-0.25, 0.25);
    let input = null;
    for (let i = 0; i < 6; i++) {
      input = { aim: 0, landX: tx, pace, over: 0, spinDir, curve };
      const shot = computeShot(g, c, input, 0);
      const land = CT.flight(shot.pos, shot.vel, shot.spin, shot.side).land;
      const safe = fwd * land.y > 0.3 && Math.abs(land.x) < COURT.SW - 0.25 && Math.abs(land.y) < COURT.HL - 0.3;
      if (safe) break;
      pace = Math.max(0.15, pace - 0.12);
      tx *= 0.7;
    }
    return input;
  }

  function cpuChooseServe(g, c) {
    const first = g.match.firstServe;
    let pace = first ? rand(0.7, 1.0) : rand(0.35, 0.6);
    let aim = rand(-0.22, 0.22);
    const spinDir = first && Math.random() < 0.6 ? -1 : 1;
    const curve = rand(-0.3, 0.3);
    let input = null;
    for (let i = 0; i < 8; i++) {
      input = { aim, pace, over: 0, spinDir, curve };
      const shot = computeShot(g, c, input, 0);
      const land = CT.flight(shot.pos, shot.vel, shot.spin, shot.side).land;
      if (CT.inServiceBox(land.x, land.y, { side: g.serveBox.side, sign: g.serveBox.sign }) &&
        Math.abs(land.x) > 0.15 && Math.abs(land.x) < COURT.SW - 0.15 && Math.abs(land.y) < COURT.SL - 0.2) break;
      pace = Math.max(0.2, pace - 0.1);
      aim *= 0.6;
    }
    // Timing on the toss, so some serves miss: a big first serve is mistimed
    // more often than a careful second one.
    const W = windowFor(c, 'fh');
    input.err = (Math.random() + Math.random() - 1) * W * (first ? 2.6 * pace : 1.1);
    return input;
  }

  // Deterministic lateness from being rushed or tired, in seconds.
  // `pace` is the pace the CPU chose for this shot: going big is riskier.
  function cpuTimingError(g, c, wing, pace) {
    const slack = c.plan ? c.plan.slack : 0;
    let n = slack >= 0.5 ? 0 : ((0.5 - slack) / 0.5) * 1.4;
    n += Math.pow(pace, 3) * 0.8;
    n += Math.abs(g.ball.pos.z - 1.0) * 0.6;
    n += (1 - staminaF(c)) * 0.5;
    // pace on the incoming ball rushes the swing too
    const v = Math.hypot(g.ball.vel.x, g.ball.vel.y, g.ball.vel.z);
    n += Math.max(0, (v - 16) / 10) * 0.6;
    // scaled so CPU rallies last about as long as before mistimed shots
    // started finding the net
    return Math.min(n, 1.6) * 0.8 * windowFor(c, wing);
  }

  function cpuThink(g, c) {
    if (g.phase === 'preServe' && g.server === c.side && g.phaseWall > 1.1) requestToss(g, c.side);
  }

  // ---------------- simulation ----------------
  function pointTo(g, w, text, detail) {
    if (g.phase === 'pointOver' || g.phase === 'matchOver') return;
    g.held = null;
    const res = CT.awardPoint(g.match, w);
    g.phase = 'pointOver';
    g.phaseWall = 0;
    for (const p of g.players) p.pending = null;
    emit(g, 'point', { winner: w, text, detail, result: res });
  }

  function fault(g, text) {
    const m = g.match;
    if (m.firstServe) {
      m.firstServe = false;
      g.phase = 'fault';
      g.phaseWall = 0;
      emit(g, 'fault', { text });
    } else {
      pointTo(g, 1 - g.server, 'Double fault', text);
    }
  }

  function onBounce(g) {
    const b = g.ball;
    g.marks.push({ x: b.pos.x, y: b.pos.y, age: 0 });
    emit(g, 'bounce', { x: b.pos.x, y: b.pos.y });
    if (g.phase !== 'rally') { b.bounces++; return; }
    const h = b.lastHitter, r = 1 - h;
    if (b.bounces === 0) {
      const inOppHalf = fwdOf(h) * b.pos.y > 0;
      if (b.isServe) {
        if (b.netted || !inOppHalf) fault(g, 'Net');
        else if (!CT.inServiceBox(b.pos.x, b.pos.y, g.serveBox)) fault(g, 'Fault');
        else b.bounces = 1;
        return;
      }
      if (b.netted || !inOppHalf) { pointTo(g, r, 'Net'); return; }
      if (!CT.inSingles(b.pos.x, b.pos.y)) { pointTo(g, r, 'Out'); return; }
      b.bounces = 1;
      return;
    }
    b.bounces++;
    if (g.held) return;
    // An online guest may already have swung at this ball on their phone:
    // give their swipe time to arrive before calling it.
    const rp = g.players[r];
    if (g.control[r] === 'remote' && rp.cross && rp.cross.t >= g.lastHitT) {
      const Wout = OUTER * Math.max(windowFor(rp, 'fh'), windowFor(rp, 'bh'));
      const until = rp.cross.t + (Wout + LAG_ALLOW) * g.timeScale;
      if (g.time < until) { g.held = { w: h, text: b.isServe ? 'Ace' : 'Winner', until }; return; }
    }
    pointTo(g, h, b.isServe ? 'Ace' : 'Winner');
  }

  function updatePlayers(g, dt) {
    for (const p of g.players) {
      p.anim += dt;
      if (p.swing >= 0) { p.swing += dt / 0.28; if (p.swing > 1.2) p.swing = -1; }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      const sp = moveSpeed(p);
      if (d > 0.02 && g.time >= p.reactUntil) {
        const ux = dx / d, uy = dy / d;
        // turning sharply means slowing down first
        if (ux * p.dirX + uy * p.dirY < 0.3) p.v *= 0.3;
        p.dirX = ux; p.dirY = uy;
        p.v = Math.min(sp, p.v + ACCEL * dt);
        const step = Math.min(d, p.v * dt);
        p.x += ux * step; p.y += uy * step;
        p.moving = true;
        if (g.phase === 'rally') {
          p.run += step;
          p.stamina = Math.max(0, p.stamina - step * p.ch.drain);
          p.cap = Math.max(45, 100 - p.run * p.ch.capDrain);
          p.stamina = Math.min(p.stamina, p.cap);
        }
      } else {
        p.moving = false;
        if (d <= 0.02) p.v = 0;
        // a breather between points restores far more than standing mid-rally
        p.stamina = Math.min(p.cap, p.stamina + (g.phase === 'rally' ? 0.6 : 1.5) * dt);
      }
    }
  }

  function checkCrossings(g) {
    const b = g.ball;
    for (const p of g.players) {
      if (!incomingTo(g, p) || p.fwd * b.pos.y > 0) { p.prevRel = null; continue; }
      const rel = p.fwd * b.pos.y - (p.fwd * p.y + CONTACT_AHEAD);
      if (p.prevRel !== null && p.prevRel > 0 && rel <= 0) {
        p.cross = { t: g.time, x: b.pos.x, y: b.pos.y, z: b.pos.z, ball: CT.cloneBall(b), px: p.x, py: p.y };
        if (g.control[p.side] === 'cpu') {
          if (c_hasPlan(p) && canReach(g, p)) {
            const input = cpuChooseShot(g, p);
            const wing = (b.pos.x - p.x) * p.fwd >= -0.05 ? 'fh' : 'bh';
            tryHit(g, p, input, cpuTimingError(g, p, wing, input.pace));
            return;
          }
        } else if (p.pending) {
          const err = p.pending.err !== undefined ? p.pending.err : (p.pending.t - g.time) / g.timeScale;
          const input = p.pending.input;
          p.pending = null;
          tryHit(g, p, input, err);
          return;
        }
      }
      p.prevRel = rel;
    }
  }
  function c_hasPlan(p) { return !!p.plan && !p.leaving; }

  // The guest's copy between snapshots: ball flight and running only, plus the
  // moments its swipe timing is judged against (toss peak, contact plane).
  function stepRemote(g, dt) {
    g.time += dt;
    updatePlayers(g, dt);
    const b = g.ball;
    if (!b.active) return;
    const vz = b.vel.z;
    const ev = CT.stepBall(b, dt);
    if (g.phase === 'toss' && vz > 0 && b.vel.z <= 0) g.peakT = g.time;
    if (ev === 'bounce' && g.phase === 'rally') b.bounces++;
    for (const p of g.players) {
      if (!incomingTo(g, p) || p.fwd * b.pos.y > 0) { p.prevRel = null; continue; }
      const rel = p.fwd * b.pos.y - (p.fwd * p.y + CONTACT_AHEAD);
      if (p.prevRel !== null && p.prevRel > 0 && rel <= 0) p.cross = { t: g.time, x: b.pos.x, y: b.pos.y, z: b.pos.z };
      p.prevRel = rel;
    }
  }

  function stepOnce(g, dt) {
    if (g.remote) { stepRemote(g, dt); return; }
    g.time += dt;
    updatePlayers(g, dt);
    const b = g.ball;
    if (b.active) {
      const vzBefore = b.vel.z;
      const ev = CT.stepBall(b, dt);
      if (g.phase === 'toss') {
        if (vzBefore > 0 && b.vel.z <= 0) {
          g.peakT = g.time;
          g.peakBall = CT.cloneBall(b);
          if (g.control[g.server] === 'cpu') {
            const c = g.players[g.server];
            const input = cpuChooseServe(g, c);
            applyShot(g, c, computeShot(g, c, input, input.err));
          }
        } else if (b.vel.z < 0 && b.pos.z < 1.25) {
          emit(g, 'whiff', { side: g.server, reason: 'Re-toss' });
          startPoint(g, true);
        }
        return;
      }
      if (ev === 'net') emit(g, 'net', {});
      if (ev === 'bounce') onBounce(g);
      if (g.phase === 'rally') checkCrossings(g);
      if (Math.abs(b.pos.y) > 40 || Math.abs(b.pos.x) > 25) b.active = false;
    }
    if (g.held && g.phase === 'rally' && g.time >= g.held.until) pointTo(g, g.held.w, g.held.text);
    for (const p of g.players) if (g.control[p.side] === 'cpu') cpuThink(g, p);
  }

  function update(g, wallDt) {
    wallDt = Math.min(wallDt, 0.05);
    g.wall += wallDt;
    g.phaseWall += wallDt;
    g.acc += wallDt * g.timeScale;
    while (g.acc >= PHYS.DT) { stepOnce(g, PHYS.DT); g.acc -= PHYS.DT; }
    for (const mk of g.marks) mk.age += wallDt;
    g.marks = g.marks.filter((mk) => mk.age < 1.2);
    if (g.ball.active) {
      g.trail.push({ ...g.ball.pos });
      if (g.trail.length > 10) g.trail.shift();
    }
    if (g.remote) return;
    if (g.phase === 'fault' && g.phaseWall > 1.1) {
      const m = g.match;
      startPoint(g, true);
      m.firstServe = false;
    }
    if (g.phase === 'pointOver' && g.phaseWall > 1.9) {
      if (g.match.over) { g.phase = 'matchOver'; emit(g, 'matchOver', { winner: g.match.winner }); }
      else startPoint(g, false);
    }
  }

  // Data the HUD needs about the human's incoming ball.
  function incomingInfo(g, side) {
    const p = g.players[side];
    if (!incomingTo(g, p)) return null;
    const c = predictCross(g, p, 3);
    return c ? { t: c.t / g.timeScale, x: c.x, y: c.y, z: c.z, reach: Math.abs(c.x - p.x) <= p.ch.reach && c.z <= p.ch.maxZ } : null;
  }

  // ---------------- online ----------------
  const SNAP_PLAYER = ['x', 'y', 'tx', 'ty', 'stamina', 'cap', 'run', 'streak', 'swing', 'swingWing', 'moving', 'v', 'dirX', 'dirY', 'reactUntil'];

  // Everything the guest needs to draw the match, sent ~20 times a second.
  function snapshot(g) {
    return {
      time: g.time, phase: g.phase, server: g.server, serveBox: g.serveBox,
      peakT: g.peakT, lastHitT: g.lastHitT, match: g.match,
      ball: CT.cloneBall(g.ball), predLand: g.predLand || null, lastShot: g.lastShot,
      players: g.players.map((p) => { const o = {}; for (const k of SNAP_PLAYER) o[k] = p[k]; return o; }),
    };
  }

  function applySnapshot(g, s) {
    const fresh = s.lastHitT !== g.lastHitT || s.phase !== g.phase;
    g.time = s.time; g.phase = s.phase; g.server = s.server; g.serveBox = s.serveBox;
    g.peakT = s.peakT; g.lastHitT = s.lastHitT; g.match = s.match;
    g.ball = s.ball; g.predLand = s.predLand; g.lastShot = s.lastShot;
    s.players.forEach((q, i) => Object.assign(g.players[i], q));
    if (fresh) for (const p of g.players) { p.cross = null; p.prevRel = null; }
  }

  // On the guest: how early (-) or late (+) a swipe is right now, judged
  // against the ball on this screen. null = nothing to swing at.
  function swipeTiming(g, side) {
    const p = g.players[side], b = g.ball;
    if (g.phase === 'toss' && g.server === side) {
      const peak = g.peakT !== null ? g.peakT : g.time + Math.max(0, b.vel.z) / PHYS.G;
      return { err: (g.time - peak) / g.timeScale };
    }
    if (!incomingTo(g, p)) return null;
    if (p.cross && p.cross.t >= g.lastHitT) return { err: (g.time - p.cross.t) / g.timeScale };
    const c = predictCross(g, p, 3);
    if (!c) return { whiff: 'Nothing to hit' };
    return { err: -c.t / g.timeScale };
  }

  CT.snapshot = snapshot;
  CT.applySnapshot = applySnapshot;
  CT.swipeTiming = swipeTiming;
  CT.createGame = createGame;
  CT._computeShot = computeShot;   // for tests
  CT.updateGame = update;
  CT.requestMove = requestMove;
  CT.requestToss = requestToss;
  CT.requestSwipe = requestSwipe;
  CT.incomingInfo = incomingInfo;
  CT.fwdOf = fwdOf;
  CT.setAutoMove = (g, side, on) => { g.autoMove[side] = !!on; };
})();
