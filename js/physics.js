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
    NET_C: 0.914,      // net height at the centre strap
    NET_P: 1.07,       // net height at the posts
    POST_X: 6.4,
  };

  const PHYS = {
    G: 9.81,
    R: 0.033,          // ball radius
    K_DRAG: 0.0165,    // quadratic air drag
    K_MAG: 0.26,       // topspin dip (per unit spin, per m/s)
    K_SIDE: 0.10,      // sidespin curve
    DT: 1 / 240,       // fixed simulation step
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

  // Advance one fixed step. Returns 'bounce', 'net' or null.
  function stepBall(b, dt, opts) {
    const v = b.vel, p = b.pos;
    const sp = Math.hypot(v.x, v.y, v.z);
    const vh = Math.hypot(v.x, v.y);
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
      const s = b.spin;
      const rest = s >= 0 ? 0.74 * (1 + 0.14 * s) : 0.74 * (1 + 0.32 * s);
      v.z = -v.z * rest;
      const keep = s >= 0 ? 0.79 + 0.07 * s : 0.73 + 0.06 * s;
      v.x *= keep; v.y *= keep;
      b.spin *= 0.4; b.side *= 0.3;
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

  // Find the vertical launch speed that sends a ball with horizontal speed
  // `speedH` along `dir` to land `dist` metres away, clearing the net by at
  // least `minClear`. If the net forces a higher launch the ball lands longer.
  function solveLaunch(pos, dir, speedH, spin, side, dist, minClear) {
    const vx = dir.x * speedH, vy = dir.y * speedH;
    const along = (r) => (r.land.x - pos.x) * dir.x + (r.land.y - pos.y) * dir.y;
    let lo = -15, hi = Math.max(2, Math.min(20, speedH * 0.95));
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const r = flight(pos, { x: vx, y: vy, z: mid }, spin, side);
      if (along(r) < dist) lo = mid; else hi = mid;
    }
    let vz = (lo + hi) / 2;
    let r = flight(pos, { x: vx, y: vy, z: vz }, spin, side);
    if (r.netClear < minClear) {
      let a = vz, bTop = Math.max(vz + 0.01, Math.min(24, speedH * 1.1));
      for (let i = 0; i < 22; i++) {
        const mid = (a + bTop) / 2;
        const rr = flight(pos, { x: vx, y: vy, z: mid }, spin, side);
        if (rr.netClear < minClear) a = mid; else bTop = mid;
      }
      vz = bTop;
      r = flight(pos, { x: vx, y: vy, z: vz }, spin, side);
    }
    return { vel: { x: vx, y: vy, z: vz }, landing: r };
  }

  function inSingles(x, y) {
    return Math.abs(x) <= COURT.SW + PHYS.R && Math.abs(y) <= COURT.HL + PHYS.R;
  }

  // box: { side: 0|1 (whose half), sign: +1|-1 (which half of x) }
  function inServiceBox(x, y, box) {
    const inY = box.side === 0 ? (y <= 0 && y >= -COURT.SL - PHYS.R) : (y >= 0 && y <= COURT.SL + PHYS.R);
    const inX = box.sign > 0 ? (x >= -PHYS.R && x <= COURT.SW + PHYS.R) : (x <= PHYS.R && x >= -COURT.SW - PHYS.R);
    return inX && inY;
  }

  CT.COURT = COURT;
  CT.PHYS = PHYS;
  CT.netHeight = netHeight;
  CT.makeBall = makeBall;
  CT.cloneBall = cloneBall;
  CT.stepBall = stepBall;
  CT.flight = flight;
  CT.solveLaunch = solveLaunch;
  CT.inSingles = inSingles;
  CT.inServiceBox = inServiceBox;
  CT.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  CT.lerp = (a, b, t) => a + (b - a) * t;
})();
