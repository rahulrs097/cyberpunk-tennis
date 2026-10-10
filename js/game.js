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
  const NET_ZONE = 7.5;
  // Between points you get back this share of what you're missing (more at a
  // changeover), so long rallies leave you tired for the next few points.
  const STAMINA_POINT = 0.3;
  const STAMINA_CHANGEOVER = 0.6;
  const STAMINA_STILL = 0.4;     // per second standing still mid-rally
  const STAMINA_SWING = 0.4;     // every shot
  // An online guest's swipe arrives a round trip after they saw the ball, so
  // the host waits this long (s) past the guest's latest swing before calling
  // a ball the guest was about to hit a winner.
  const LAG_ALLOW = 0.3;

  // Seconds to run `dist` metres from a standstill at top speed `sp`.
  function runTime(dist, sp) {
    const dA = (sp * sp) / (2 * ACCEL);
    return dist < dA ? Math.sqrt((2 * dist) / ACCEL) : (dist - dA) / sp + sp / ACCEL;
  }
  // running back towards your own baseline is slower than running forwards
  const backF = (uy, fwd) => 1 - 0.35 * Math.max(0, -uy * fwd);
  const fwdOf = (side) => (side === 0 ? 1 : -1);
  const rand = (a, b) => a + Math.random() * (b - a);   // CPU shot selection only

  function createPlayer(side, ch) {
    return {
      side, fwd: fwdOf(side), ch,
      x: 0, y: -fwdOf(side) * ch.home, tx: 0, ty: -fwdOf(side) * ch.home,
      stamina: 100, cap: 100, run: 0, streak: 0,
      swing: -1, swingWing: 'fh', moving: false, anim: side * 1.7,
      prevRel: null, cross: null, pending: null, plan: null,
      v: 0, dirX: 0, dirY: 0, reactUntil: 0, speedF: 1,
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
      // seconds a human server gets to start their toss (online matches);
      // null = no clock
      serveClock: opts.serveClock || null,
      serveWait: 0,
      // scales the CPU's timing errors: lower = a stronger CPU
      cpuErr: opts.cpuErr || 1,
      // how fast the CPU reads a shot, and how far it shades its recovery
      // towards the side the opponent can angle it to (both rise with level)
      cpuReact: opts.cpuReact || REACT,
      cpuCover: opts.cpuCover || 0.15,
      // the CPU's legs, and how hard and deep it hits (1 = full; lower levels
      // run slower and leave shorter, softer balls to attack)
      cpuSpeed: opts.cpuSpeed || 1,
      cpuPace: opts.cpuPace || 1,
      cpuDepth: opts.cpuDepth || 1,
      // Tutorial drills: side 1 is a ball machine ('feeder' control) that feeds
      // side 0 and never returns. Each rep ends at the first bounce with a
      // 'drill' event instead of a point. { serve: true } = side 0 serves.
      drill: opts.drill || null,
    };
    g.players.forEach((p, i) => { if (g.control[i] === 'cpu') p.speedF = g.cpuSpeed; });
    startPoint(g, true);
    return g;
  }

  // CPU sides always run themselves; a human side does when automove is on.
  // A tap still overrides the run until the next shot.
  function autoMoves(g, side) { return g.control[side] === 'cpu' || !!g.autoMove[side]; }

  function emit(g, type, data) { g.onEvent(type, data || {}); }
  function staminaF(p) { return p.stamina / 100; }
  // Tired legs: top speed falls to 55% on empty.
  function moveSpeed(p) { return p.ch.speed * p.speedF * (0.55 + 0.45 * staminaF(p)); }

  // ---------------- point setup ----------------
  // keepClock: a re-toss, which doesn't restart the serve clock
  function startPoint(g, fresh, keepClock) {
    const m = g.match;
    const server = CT.currentServer(m);
    const recv = 1 - server;
    const deuce = CT.deuceSide(m);
    if (g.drill) { startRep(g); return; }
    const S = g.players[server], Rp = g.players[recv];
    const rs = deuce ? 1 : -1;                    // + = server's right
    S.x = S.fwd * rs * 0.7; S.y = -S.fwd * (COURT.HL + 0.3);
    const boxSign = deuce ? Rp.fwd : -Rp.fwd;     // receiver's deuce box is on their right
    Rp.x = boxSign * 2.5; Rp.y = -Rp.fwd * Rp.ch.returnDepth;
    // A short breather between points; a proper rest at the changeover
    // (after every odd game). Never above the cap. This is all the rest there
    // is between points: standing around before serving doesn't add to it.
    const gamesPlayed = m.games[0] + m.games[1];
    const changeover = gamesPlayed !== g.lastGames && gamesPlayed % 2 === 1;
    g.lastGames = gamesPlayed;
    for (const p of g.players) {
      p.tx = p.x; p.ty = p.y; p.swing = -1; p.pending = null; p.plan = null;
      p.cross = null; p.prevRel = null; p.streak = 0; p.v = 0; p.atNet = false; p.netSpot = null;
      if (!fresh) p.stamina = Math.min(p.cap, p.stamina + (p.cap - p.stamina) * (changeover ? STAMINA_CHANGEOVER : STAMINA_POINT));
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
    if (!keepClock) g.serveWait = 0;
    emit(g, 'serveReady', { server, first: m.firstServe });
  }

  // A tutorial rep: the player serves, or waits on the baseline for a feed.
  function startRep(g) {
    const m = g.match, P = g.players[0], F = g.players[1];
    m.server = 0; m.firstServe = true;
    for (const p of g.players) {
      p.swing = -1; p.pending = null; p.plan = null; p.cross = null; p.prevRel = null;
      p.streak = 0; p.v = 0; p.atNet = false; p.netSpot = null; p.stamina = 100; p.cap = 100;
    }
    F.x = 0; F.y = 11; F.tx = F.x; F.ty = F.y;
    g.server = g.drill.serve ? 0 : 1;
    g.ball = CT.makeBall();
    g.trail = [];
    g.peakT = null; g.peakBall = null; g.held = null; g.serveWait = 0;
    g.phaseWall = 0;
    if (g.drill.serve) {
      const deuce = (g.drill.reps || 0) % 2 === 0;
      P.x = (deuce ? 1 : -1) * 0.7; P.y = -(COURT.HL + 0.3);
      g.serveBox = { side: 1, sign: deuce ? -1 : 1 };
      g.phase = 'preServe';
    } else {
      P.x = 0; P.y = -P.ch.home;
      g.phase = 'feed';
    }
    P.tx = P.x; P.ty = P.y;
    emit(g, 'serveReady', { server: g.server, first: true });
  }

  // The ball machine feeds an easy ball to the player's `wing` side.
  function feedBall(g) {
    const P = g.players[0], F = g.players[1], wing = g.drill.wing || 'fh';
    const b = CT.makeBall();
    b.pos = { x: F.x, y: F.y - 0.5, z: 1.0 };
    b.active = true; b.inFlight = true; b.bounces = 1;
    g.ball = b;
    g.phase = 'rally';
    const landX = clamp(P.x + (wing === 'fh' ? 1 : -1) * 0.9, -3, 3);
    const shot = computeShot(g, F, { aim: 0, landX, pace: 0.2, spinDir: 1, curve: 0, depth: 0.75, clear: 0.6 }, 0);
    applyShot(g, F, shot);
  }

  function drillEnd(g, ok, text, at) {
    if (g.phase === 'pointOver') return;
    g.drill.reps = (g.drill.reps || 0) + 1;
    g.held = null;
    g.phase = 'pointOver';
    g.phaseWall = 0;
    for (const p of g.players) p.pending = null;
    emit(g, 'drill', { ok, text, x: at ? at.x : null, y: at ? at.y : null, shot: g.lastShot && g.lastShot.side === 0 ? g.lastShot : null });
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
    return p.ch.window[wing] * (0.55 + 0.45 * staminaF(p));
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
    // Where you are matters as well as when you swing: a ball jammed into
    // your body, one at full stretch, or one hit on the run is harder to
    // strike cleanly, so it counts as extra mistiming.
    let balance = 0, note = '';
    if (!isServe) {
      const d = Math.abs(localX), far = ch.reach * 0.6;
      if (kind !== 'overhead' && d < 0.3) { balance += ((0.3 - d) / 0.3) * 0.6; note = 'Jammed'; }
      if (d > far) { balance += ((d - far) / (ch.reach - far)) * 0.8; note = 'Stretched'; }
      const run = p.moving ? p.v / ch.speed : 0;
      if (run > 0.3) { balance += ((run - 0.3) / 0.7) * 0.7; if (!note) note = 'On the run'; }
    }
    const e0 = err / W;
    const e = clamp(e0 + (e0 < 0 ? -balance : balance), -OUTER, OUTER);
    // Late forehands drift to the hitter's right, late backhands to the left.
    const drift = e * 0.085 * (wing === 'fh' ? 1 : -1);
    const powerF = Math.max(0.7, 1 - 0.1 * Math.pow(Math.abs(e), 1.5));
    const pace = clamp(input.pace, 0, 1), over = clamp(input.over || 0, 0, 1);
    const capF = 0.68 + 0.32 * f;   // tired arms: up to a third less pace
    let speed, spin, margin, minClear = input.clear || 0.12, depthLine = COURT.HL;
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
      // A slice keeps real backspin even when swiped fast (a flat topspin
      // drive loses its spin with pace, but a hard slice still skids and stays
      // low), and comes off a little slower.
      if (input.spinDir < 0) { spin = -lerp(0.55, 0.3, pace); speed *= 0.9; }
      margin = input.spinDir < 0 ? 1.8 + 2.4 * (1 - pace) : 0.7 + 2.8 * (1 - pace);
      margin -= over * 2.5;
      if (kind === 'power') {
        // A high ball can be driven down hard and flat.
        speed *= 1.22; spin *= spin > 0 ? 0.5 : 0.8; margin *= 0.7;
      }
      if (kind === 'volley') { speed *= 0.72; spin *= 0.3; }
      // a volley above power height can be punched down hard
      if (kind === 'powerVolley') { speed *= 1.1; spin *= 0.3; margin *= 0.7; }
      // a topspin lob: up over a player at the net and down deep
      if (input.lob) { speed = lerp(18, 20, pace) * capF; spin = 1.3; margin = 1.5; side = 0; }
    }

    // launch at angle `ang` to land `along` metres down the court
    const solve = (ang, spd, along, clear) => CT.solveLaunch(pos, { x: fwd * Math.sin(ang), y: fwd * Math.cos(ang) },
      spd, spin, side, Math.max(1.5, along) / Math.cos(ang), clear);
    // A lob goes up first: fix how hard it's launched upward and find the
    // forward speed that lands it `along` metres down the court.
    const lobUp = lerp(13, 15, clamp(input.pace, 0, 1));
    const solveLob = (ang, along, up) => {
      const dir = { x: fwd * Math.sin(ang), y: fwd * Math.cos(ang) }, dist = Math.max(1.5, along) / Math.cos(ang);
      let lo = 2, hi = 25, r = null;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        r = CT.flight(pos, { x: dir.x * mid, y: dir.y * mid, z: up }, spin, side);
        if ((r.land.x - pos.x) * dir.x + (r.land.y - pos.y) * dir.y < dist) lo = mid; else hi = mid;
      }
      const v = (lo + hi) / 2;
      return { vel: { x: dir.x * v, y: dir.y * v, z: up }, landing: CT.flight(pos, { x: dir.x * v, y: dir.y * v, z: up }, spin, side) };
    };
    const isLob = !!input.lob && kind !== 'serve' && kind !== 'overhead';
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
      const landX = Number.isFinite(input.landX) ? clamp(input.landX, -edge, edge)
        : fwd * edge * clamp(input.aim / AIM_FULL, -1, 1);
      const along = target - fwd * pos.y;
      // Solve the well-timed shot first: re-aim for sidespin curl, and when
      // clearing the net would carry it past the baseline, take pace off.
      let aimX = landX, spd = speed, a = 0;
      for (let i = 0; i < 12; i++) {
        a = Math.atan2(fwd * (aimX - pos.x), along);
        sol = isLob ? solveLob(a, along, lobUp) : solve(a, spd, along, minClear);
        const land = sol.landing.land;
        let again = false;
        if (Math.abs(land.x - landX) > 0.25) { aimX -= land.x - landX; again = true; }
        if (target <= depthLine - 0.3 && fwd * land.y > depthLine - 0.25) { spd *= 0.85; again = true; }
        if (!again) break;
      }
      // Then mistiming costs power and pushes it off line: the ball comes off
      // slower, shorter and a little lower (mostly it misses wide or long).
      if (Math.abs(drift) > 0.002 || powerF < 0.999) {
        sol = isLob ? solveLob(a + drift, along - (1 - powerF) * 9, lobUp * powerF)
          : solve(a + drift, spd * powerF, along - (1 - powerF) * 9, minClear - (1 - powerF) * 0.7);
        if (isLob) { const vel = sol.vel; return { pos, vel, spin, side, kind, wing, err, e, powerF, lob: true, note }; }
        // (a soft ball, like a scoop off a drop shot, dips by less)
        sol.vel.z -= (1 - powerF) * 2 * Math.min(1, spd / 25);
      }
    }
    const vel = sol.vel;
    return { pos, vel, spin, side, kind, wing, err, e, powerF, lob: isLob, note };
  }

  function applyShot(g, p, shot) {
    const b = g.ball;
    b.pos = { ...shot.pos };
    b.vel = shot.vel; b.spin = shot.spin; b.side = shot.side;
    b.active = true; b.inFlight = true; b.bounces = 0; b.netted = false;
    b.lastHitter = p.side;
    b.isServe = shot.kind === 'serve';
    g.held = null;
    p.stamina = Math.max(0, p.stamina - STAMINA_SWING);
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
      spin: shot.lob ? 'Lob' : shot.spin > 0.35 ? 'Topspin' : shot.spin < 0 ? 'Slice' : 'Flat',
      curve: Math.abs(shot.side) > 0.2 ? (shot.side * p.fwd > 0 ? 'curls right' : 'curls left') : '',
      errMs: Math.round(shot.err * 1000),
      perfect: Math.abs(shot.e) < 0.35,
      note: Math.abs(shot.e) >= 0.35 ? shot.note : '',
    };
    g.lastShot = info;
    // where will it land? used for the landing marker
    const fl = CT.flight(b.pos, b.vel, b.spin, b.side);
    g.predLand = fl.land;
    const other = g.players[1 - p.side];
    // auto-moving players need a moment to read the shot; a human moving
    // themselves already has their own reaction time
    // (returners split-step as the server swings, so they react faster)
    if (autoMoves(g, other.side)) { other.reactUntil = g.time + (b.isServe ? 0.08 : g.control[other.side] === 'cpu' ? g.cpuReact : REACT); cpuPlan(g, other); }
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
    const cover = g.control[c.side] === 'cpu' ? g.cpuCover : 0.15;
    c.tx = clamp(opp.x * cover, -2.2, 2.2);
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
        // a ball dropping below the tape right by the net can't be volleyed back over
        if (z < CT.netHeight(b.pos.x) + 0.1 && fwd * b.pos.y > -2) continue;
      }
      for (const wing of ['fh', 'bh']) {
        const ws = wing === 'fh' ? 1 : -1;
        let px = b.pos.x - ws * R * 0.75;
        let py = b.pos.y - fwd * CONTACT_AHEAD;
        if (fwd * py > -0.8 || fwd * py < -16.5) continue;
        const dist = Math.hypot(px - c.x, py - c.y);
        const slack = t - ((c.reactUntil - g.time) + runTime(dist, speed * backF((py - c.y) / Math.max(dist, 1e-6), fwd)) + 0.12);
        let q = -Math.abs(z - 1.0) + (bounced ? 0.4 : 0);
        // at the net: volley it rather than backing up for the bounce
        if (c.atNet) q += bounced ? -1.5 : 0.8;
        if (!bounced && z >= POWER_Z + 0.1 && z < ch.overheadZ) q += 0.6;   // power volley height
        // Punish high balls: smash them out of the air, or take them at
        // shoulder height after the bounce for a power shot.
        if (z >= ch.overheadZ && !bounced) q += 2.2;
        else if (bounced && z >= POWER_Z + 0.1) q += 1.0 + 0.5 * (z - POWER_Z);
        q -= Math.max(0, -fwd * py - ch.home) * 0.25;   // don't drift too far back
        q += ch.tactics.late * t + (wing === 'fh' ? ch.tactics.fhPref : 0);
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

  // The CPU picks a shot the way its character plays (`ch.tactics`).
  function cpuChooseShot(g, c) {
    const opp = g.players[1 - c.side];
    const b = g.ball;
    const fwd = c.fwd;
    const T = c.ch.tactics;
    const slack = c.plan ? c.plan.slack : 0;
    const edge = COURT.SW - 0.45;
    let pace = rand(T.pace[0], T.pace[1]) * g.cpuPace;
    if (slack < 0.2) pace *= 0.75;
    // a low ball (dug out of a drop shot, say) has to be lifted, not hit
    if (b.pos.z < 0.5) pace *= 0.6;
    let spinDir = (b.pos.z < 0.42 || slack < 0.05) ? -1 : (Math.random() < T.slice ? -1 : 1);
    // the opponent's weaker wing is the one with the narrower timing window
    const weakSide = (opp.ch.window.fh < opp.ch.window.bh ? 1 : -1) * opp.fwd;
    const away = opp.x > 0 ? -1 : 1;
    const oppAtNet = -opp.fwd * opp.y < NET_ZONE;
    // a tired opponent gets run from side to side
    const oppTired = staminaF(opp) < 0.4;
    let tx, lob = false;
    if (oppAtNet) {
      // they're at the net: lob over them or pass them
      if (Math.random() < T.lob) { lob = true; tx = rand(-1.5, 1.5); }
      else { tx = away * edge * rand(0.75, 1); pace = Math.max(pace, 0.7); }
    } else if (Math.abs(opp.x) > (oppTired ? 1 : 1.8) && Math.random() < T.openCourt + (oppTired ? 0.3 : 0)) {
      tx = away * edge * rand(0.7, 1);            // into the open court
    } else if (Math.random() < T.weakWing) {
      tx = weakSide * edge * rand(0.55, 0.9);     // at the weaker wing
    } else {
      tx = rand(-edge, edge) * 0.8;
    }
    // an easy ball with plenty of time: go for it, away from them
    if (!lob && slack > 0.6 && b.pos.z > 0.8) { pace = Math.max(pace, T.pace[1] * g.cpuPace); tx = away * edge; }
    tx *= T.safe;
    if (slack < 0.2 && !lob) tx *= 0.5;           // stretched: play it back through the middle
    // A short ball with time to spare: hit an approach and follow it in.
    const fromNet = -fwd * c.y;
    const approach = !lob && T.approach > 0 && fromNet < 10 && slack > 0.15 && b.pos.z > 0.6 &&
      Math.random() < T.approach;
    if (approach) { pace = Math.max(pace, 0.75); tx = (Math.random() < 0.5 ? weakSide : away) * edge * 0.85; spinDir = 1; }
    const curve = rand(-0.25, 0.25);
    let input = null;
    for (let i = 0; i < 6; i++) {
      // the CPU plays with a safe margin over the net
      input = { aim: 0, landX: tx, pace, over: 0, spinDir, curve, lob, clear: 0.4, depth: approach ? 1 : g.cpuDepth };
      const shot = computeShot(g, c, input, 0);
      const fl = CT.flight(shot.pos, shot.vel, shot.spin, shot.side), land = fl.land;
      const safe = fwd * land.y > 0.3 && fl.netClear > 0.3 && Math.abs(land.x) < COURT.SW - 0.25 && Math.abs(land.y) < COURT.HL - 0.3;
      if (safe) break;
      pace = Math.max(0.15, pace - 0.12);
      tx *= 0.7;
    }
    if (approach) c.netSpot = { x: clamp(tx * 0.3, -1.5, 1.5), y: -fwd * 3.6 };
    return input;
  }

  function cpuChooseServe(g, c) {
    const first = g.match.firstServe;
    let pace = (first ? rand(0.7, 1.0) : rand(0.35, 0.6)) * g.cpuPace;
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
    if (first && Math.random() < c.ch.tactics.serveVolley) c.netSpot = { x: 0, y: -c.fwd * 4.2 };
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
    // smashing while still backpedalling (chasing down a lob) is hard to time
    if (g.ball.pos.z >= c.ch.overheadZ && c.moving && c.dirY * c.fwd < -0.5) n += 0.8;
    // pace on the incoming ball rushes the swing too
    const v = Math.hypot(g.ball.vel.x, g.ball.vel.y, g.ball.vel.z);
    n += Math.max(0, (v - 16) / 10) * 0.6;
    // g.cpuErr sets the difficulty (1 = Club)
    return Math.min(n, 1.6) * g.cpuErr * windowFor(c, wing);
  }

  function cpuThink(g, c) {
    if (g.phase === 'preServe' && g.server === c.side && g.phaseWall > 1.1) requestToss(g, c.side);
  }

  // ---------------- simulation ----------------
  function pointTo(g, w, text, detail) {
    if (g.phase === 'pointOver' || g.phase === 'matchOver') return;
    // (a feed that misses the court doesn't count either way)
    if (g.drill) { drillEnd(g, g.ball.lastHitter === 1 && w === 0 ? null : w === 0, w === 0 ? text : 'Missed'); return; }
    g.held = null;
    const res = CT.awardPoint(g.match, w);
    g.phase = 'pointOver';
    g.phaseWall = 0;
    for (const p of g.players) p.pending = null;
    emit(g, 'point', { winner: w, text, detail, result: res });
  }

  function fault(g, text) {
    const m = g.match;
    if (g.drill) { drillEnd(g, false, text === 'Net' ? 'Net' : 'Fault', g.ball.pos); return; }
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
        else if (g.drill) drillEnd(g, true, 'In', b.pos);
        else b.bounces = 1;
        return;
      }
      if (b.netted || !inOppHalf) { pointTo(g, r, 'Net'); return; }
      if (!CT.inSingles(b.pos.x, b.pos.y)) { pointTo(g, r, 'Out'); return; }
      if (g.drill && h === 0) { drillEnd(g, true, 'In', b.pos); return; }
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
        p.v = Math.min(sp * backF(uy, p.fwd), p.v + ACCEL * dt);
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
        // catching your breath mid-rally; between points the fixed breather
        // in startPoint is all you get
        if (g.phase === 'rally') p.stamina = Math.min(p.cap, p.stamina + STAMINA_STILL * dt);
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
          startPoint(g, true, true);
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
    if (g.phase === 'preServe' || g.phase === 'toss') g.serveWait += wallDt;
    g.acc += wallDt * g.timeScale;
    while (g.acc >= PHYS.DT) { stepOnce(g, PHYS.DT); g.acc -= PHYS.DT; }
    for (const mk of g.marks) mk.age += wallDt;
    g.marks = g.marks.filter((mk) => mk.age < 1.2);
    if (g.ball.active) {
      g.trail.push({ ...g.ball.pos });
      if (g.trail.length > 10) g.trail.shift();
    }
    if (g.remote) return;
    if (g.serveClock && g.phase === 'preServe' && g.control[g.server] !== 'cpu' && g.serveWait > g.serveClock) {
      fault(g, 'Serve clock');
    }
    if (g.phase === 'fault' && g.phaseWall > 1.1) {
      const m = g.match;
      startPoint(g, true);
      m.firstServe = false;
    }
    if (g.phase === 'feed' && g.phaseWall > 0.9) feedBall(g);
    if (g.phase === 'pointOver' && g.phaseWall > (g.drill ? 1.3 : 1.9)) {
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
      time: g.time, phase: g.phase, server: g.server, serveBox: g.serveBox, serveWait: g.serveWait,
      peakT: g.peakT, lastHitT: g.lastHitT, match: g.match,
      ball: CT.cloneBall(g.ball), predLand: g.predLand || null, lastShot: g.lastShot,
      players: g.players.map((p) => { const o = {}; for (const k of SNAP_PLAYER) o[k] = p[k]; return o; }),
    };
  }

  function applySnapshot(g, s) {
    const fresh = s.lastHitT !== g.lastHitT || s.phase !== g.phase;
    g.time = s.time; g.phase = s.phase; g.server = s.server; g.serveBox = s.serveBox; g.serveWait = s.serveWait;
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

  // The menu's levels: ball speed (game time per real second) and how the CPU
  // plays. err scales its timing errors, react is how long it takes to read a
  // shot (s), cover is how far it shades towards the angle.
  CT.CPU_LEVELS = {
    chill: { timeScale: 0.65, err: 1.2, react: 0.34, cover: 0.1, speed: 0.82, pace: 0.8, depth: 0.8 },
    club: { timeScale: 0.8, err: 1.15, react: 0.3, cover: 0.15, speed: 0.87, pace: 0.82, depth: 0.85 },
    pro: { timeScale: 1, err: 0.65, react: 0.12, cover: 0.4, speed: 1, pace: 1, depth: 1 },
  };

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
