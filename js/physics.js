// Court geometry, ball physics and the shot solver.
// World units are metres and seconds. x = across the court, y = along it
// (net at y = 0, the bottom player's half is y < 0), z = height.
// Everything here is deterministic: the same inputs always give the same flight.
(function () {
  const CT = (window.CT = window.CT || {});

  const COURT = {
    HL: 11.885,        // half length (net to baseline)
    SW: 4.115,         // singles half width
    DW: 5.485,         // doubles half width
    SL: 6.40,          // net to service line
    LW: 0.05,          // line width (the baselines are twice that)
    NET_C: 0.914,      // net height at the centre strap
    NET_P: 1.07,       // net height at the posts
    POST_X: 6.4,
  };

  const PHYS = {
    G: 9.81,
    R: 0.033,          // ball radius
    K_DRAG: 0.014,     // quadratic air drag
    K_MAG: 0.26,       // topspin dip (per unit spin, per m/s)
    K_SIDE: 0.10,      // sidespin curve
    DT: 1 / 240,       // fixed simulation step
    // Bounce on a medium-pace hard court (ITF court pace rating ~35).
    E: 0.81,           // vertical coefficient of restitution
    MU: 0.6,           // ball-court sliding friction
    ALPHA: 0.55,       // ball moment of inertia, I / (m R^2)
    K_AIR: 0.0363,     // rho * A / 2m: turns a lift coefficient into m^-1
  };

  function netHeight(x) {
    return COURT.NET_C + (COURT.NET_P - COURT.NET_C) * Math.min(1, Math.abs(x) / COURT.POST_X);
  }

  function makeBall() {
    return {
      pos: { x: 0, y: 0, z: 1 },
      vel: { x: 0, y: 0, z: 0 },
      spin: 0,         // + topspin, - backspin (roughly -1..1.2)
      side: 0,         // + curves to the hitter's right
      active: false,
      inFlight: false, // false while being tossed
      bounces: 0,
      lastHitter: -1,
      isServe: false,
      netted: false,
    };
  }

  function cloneBall(b) {
    return {
      pos: { ...b.pos }, vel: { ...b.vel }, spin: b.spin, side: b.side,
      active: b.active, inFlight: b.inFlight, bounces: b.bounces, lastHitter: b.lastHitter,
      isServe: b.isServe, netted: b.netted,
    };
  }

  // Game spin is a Magnus strength (accel = K_MAG * spin * speed). Convert it
  // to the speed of the ball's surface (omega * R) and back, through the lift
  // coefficient a real ball would need: C_L = S / (1 + 2S), S = omega R / v.
  function spinToSurface(spin, v) {
    const cl = CT.clamp(PHYS.K_MAG * spin / (PHYS.K_AIR * Math.max(v, 1)), -1 / 3, 1 / 3);
    return v * cl / (1 - 2 * Math.abs(cl));
  }
  function surfaceToSpin(wr, v) {
    const S = wr / Math.max(v, 1);
    return PHYS.K_AIR * Math.max(v, 1) * (S / (1 + 2 * Math.abs(S))) / PHYS.K_MAG;
  }

  // The bounce (Cross / Brody): the court returns E of the vertical speed,
  // and friction at the contact patch slows the ball's bottom surface. It
  // either slides through the bounce (losing MU * (1 + E) * vz of forward
  // speed) or grips and leaves rolling, whichever happens first. Topspin
  // turns the bottom backwards so the ball grips early and keeps its pace;
  // backspin makes it slide hard, so a steep slice checks and a flat one
  // skids through. Nearly every ball leaves the court with topspin.
  function bounce(b) {
    const v = b.vel;
    const vh = Math.sqrt(v.x * v.x + v.y * v.y), vzIn = -v.z;
    const wr = spinToSurface(b.spin, vh);
    const u = vh - wr;                                  // contact patch slip
    const toRoll = PHYS.ALPHA * u / (1 + PHYS.ALPHA);
    const slide = PHYS.MU * (1 + PHYS.E) * vzIn;
    const dv = Math.abs(toRoll) <= slide ? toRoll : Math.sign(u) * slide;
    const vhOut = Math.max(0, vh - dv);
    if (vh > 1e-6) { v.x *= vhOut / vh; v.y *= vhOut / vh; }
    v.z = vzIn * PHYS.E;
    b.spin = surfaceToSpin(wr + dv / PHYS.ALPHA, vhOut);
    b.side *= 0.3;
  }

  // Advance one fixed step. Returns 'bounce', 'net' or null.
  function stepBall(b, dt, opts) {
    const v = b.vel, p = b.pos;
    // (sqrt, not Math.hypot: this runs thousands of times per shot solved,
    // and hypot is several times slower)
    const h2 = v.x * v.x + v.y * v.y;
    const vh = Math.sqrt(h2), sp = Math.sqrt(h2 + v.z * v.z);
    let ax = -PHYS.K_DRAG * sp * v.x;
    let ay = -PHYS.K_DRAG * sp * v.y;
    let az = -PHYS.G - PHYS.K_DRAG * sp * v.z;
    az += -PHYS.K_MAG * b.spin * vh;
    if (vh > 0.1 && b.side) {
      // right-hand perpendicular of the direction of travel
      const px = v.y / vh, py = -v.x / vh;
      ax += PHYS.K_SIDE * b.side * sp * px;
      ay += PHYS.K_SIDE * b.side * sp * py;
    }
    v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
    const prevY = p.y;
    p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;

    let ev = null;
    if (!(opts && opts.noNet) && b.inFlight && !b.netted && Math.sign(prevY) !== Math.sign(p.y) && prevY !== 0) {
      if (Math.abs(p.x) < COURT.POST_X && p.z < netHeight(p.x) + PHYS.R) {
        // Into the tape: the ball dies and drops back on the hitter's side.
        p.y = Math.sign(prevY) * 0.06;
        v.y = -v.y * 0.08; v.x *= 0.3; v.z = Math.min(v.z, 0) * 0.3;
        b.spin = 0; b.side = 0; b.netted = true;
        ev = 'net';
      }
    }
    if (p.z < PHYS.R && v.z < 0) {
      p.z = PHYS.R;
      bounce(b);
      if (ev !== 'net') ev = 'bounce';
    }
    return ev;
  }

  // Fly a ball from a launch state until it first lands. No net collision:
  // instead it reports how far above the tape it passed.
  function flight(pos, vel, spin, side) {
    const b = makeBall();
    b.pos = { ...pos }; b.vel = { ...vel }; b.spin = spin; b.side = side; b.inFlight = true;
    let netClear = null, t = 0;
    const y0 = pos.y;
    while (t < 5) {
      const prevY = b.pos.y;
      const ev = stepBall(b, PHYS.DT, { noNet: true });
      t += PHYS.DT;
      if (netClear === null && Math.sign(prevY) !== Math.sign(b.pos.y) && prevY !== 0) {
        netClear = b.pos.z - netHeight(b.pos.x);
      }
      if (ev === 'bounce') break;
    }
    if (netClear === null) netClear = Math.sign(y0) === Math.sign(b.pos.y) ? -9 : 9;
    return { land: { x: b.pos.x, y: b.pos.y }, t, netClear };
  }

  // Find x in [lo, hi] where an increasing f(x) crosses zero, by regula
  // falsi (Illinois): a handful of flights instead of a long bisection.
  // fr(x) returns { f, r }. It stops once 0 <= f < tol (or |f| < tol when
  // `either` is set), and returns the point found with its result r. When
  // there's no crossing it returns the nearer end, as a bisection would.
  function findRoot(fr, lo, hi, tol, either) {
    let A = fr(lo), B = fr(hi);
    if (A.f >= 0) return { x: lo, r: A.r };
    if (B.f < 0) return { x: hi, r: B.r };
    let a = lo, b = hi, fa = A.f, fb = B.f, last = 0;
    for (let i = 0; i < 40 && b - a > 1e-6; i++) {
      let x = (a * fb - b * fa) / (fb - fa);
      if (!(x > a && x < b)) x = (a + b) / 2;
      const X = fr(x);
      if (X.f >= 0 ? X.f < tol : either && -X.f < tol) return { x, r: X.r };
      if (X.f < 0) { a = x; fa = X.f; if (last < 0) fb /= 2; last = -1; } else { b = x; fb = X.f; B = X; if (last > 0) fa /= 2; last = 1; }
    }
    return { x: b, r: B.r };
  }

  // Find the vertical launch speed that sends a ball with horizontal speed
  // `speedH` along `dir` to land `dist` metres away (to within a centimetre),
  // clearing the net by at least `minClear`. If the net forces a higher
  // launch the ball lands longer.
  function solveLaunch(pos, dir, speedH, spin, side, dist, minClear) {
    const vx = dir.x * speedH, vy = dir.y * speedH;
    const along = (r) => (r.land.x - pos.x) * dir.x + (r.land.y - pos.y) * dir.y;
    const fly = (vz) => flight(pos, { x: vx, y: vy, z: vz }, spin, side);
    let s = findRoot((vz) => { const r = fly(vz); return { f: along(r) - dist, r }; },
      -15, Math.max(2, Math.min(20, speedH * 0.95)), 0.01, true);
    if (s.r.netClear < minClear) {
      s = findRoot((vz) => { const r = fly(vz); return { f: r.netClear - minClear, r }; },
        s.x, Math.max(s.x + 0.01, Math.min(24, speedH * 1.1)), 0.002, false);
    }
    return { vel: { x: vx, y: vy, z: s.x }, landing: s.r };
  }

  function inSingles(x, y) {
    return Math.abs(x) <= COURT.SW + PHYS.R && Math.abs(y) <= COURT.HL + PHYS.R;
  }

  // box: { side: 0|1 (whose half), sign: +1|-1 (which half of x) }
  function inServiceBox(x, y, box) {
    const inY = box.side === 0 ? (y <= 0 && y >= -COURT.SL - PHYS.R) : (y >= 0 && y <= COURT.SL + PHYS.R);
    // (the centre service line straddles x = 0 and belongs to both boxes)
    const c = COURT.LW / 2 + PHYS.R;
    const inX = box.sign > 0 ? (x >= -c && x <= COURT.SW + PHYS.R) : (x <= c && x >= -COURT.SW - PHYS.R);
    return inX && inY;
  }

  // How far (m) the edge of a ball bouncing at x, y missed the outside of the
  // nearest line: positive when out, negative (by how much of the ball was
  // still in) when in. Same call as inSingles / inServiceBox.
  function lineMargin(x, y, box) {
    const ax = box ? box.sign * x : Math.abs(x), ay = Math.abs(y);
    const x0 = box ? -COURT.LW / 2 : -Infinity, x1 = COURT.SW, y1 = box ? COURT.SL : COURT.HL;
    const past = Math.max(x0 - ax, ax - x1, ay - y1);   // beyond the outer edge of a line (<0 inside)
    return past - PHYS.R;
  }

  CT.COURT = COURT;
  CT.PHYS = PHYS;
  CT.netHeight = netHeight;
  CT.makeBall = makeBall;
  CT.cloneBall = cloneBall;
  CT.stepBall = stepBall;
  CT.bounce = bounce;
  CT.flight = flight;
  CT.solveLaunch = solveLaunch;
  CT.findRoot = findRoot;
  CT.inSingles = inSingles;
  CT.inServiceBox = inServiceBox;
  CT.lineMargin = lineMargin;
  CT.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  CT.lerp = (a, b, t) => a + (b - a) * t;
})();
