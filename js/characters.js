// Character stats and procedurally drawn neon sprites.
// Sprites are drawn in metres with the origin at the player's feet and -y up,
// so the renderer only has to translate and scale by the perspective factor.
(function () {
  const CT = (window.CT = window.CT || {});

  const CHARACTERS = {
    octopus: {
      id: 'octopus',
      name: 'Octopus',
      after: 'Daniil Medvedev',
      blurb: 'Lives deep behind the baseline. Long tentacles, a flat backhand, and stamina for days.',
      height: 1.98,
      speed: 5.0,          // top running speed, m/s
      reach: 1.9,          // lateral reach from the body
      overheadZ: 2.45,     // balls above this are smashed
      maxZ: 3.25,          // highest ball he can touch
      pace: { fh: 34, bh: 35 },      // speed caps, m/s
      paceMin: 24,                   // slowest rally ball: Octopus keeps it low and flat
      spin: { fh: 0.42, bh: 0.34 },  // spin caps
      serve: 58,
      window: { fh: 0.075, bh: 0.10 }, // timing windows, seconds of real time
      drain: 0.5,          // stamina per metre run
      capDrain: 0.03,      // hard-cap loss per metre run
      home: 13.4,          // rally depth (distance from the net)
      returnDepth: 14.2,
      colors: { main: '#8f5bff', glow: '#28f0d6', dark: '#2a1257', accent: '#ff3fa4' },
    },
    philosopher: {
      id: 'philosopher',
      name: 'Philosopher',
      after: 'Stefanos Tsitsipas',
      blurb: 'Heavy topspin forehand, one-handed backhand, and quick feet. Thinks before every point.',
      height: 1.93,
      speed: 5.4,
      reach: 1.7,
      overheadZ: 2.35,
      maxZ: 3.1,
      pace: { fh: 38, bh: 32 },
      paceMin: 19,
      spin: { fh: 0.85, bh: 0.65 },
      serve: 56,
      window: { fh: 0.10, bh: 0.065 },
      drain: 0.6,
      capDrain: 0.036,
      home: 12.7,
      returnDepth: 13.3,
      colors: { main: '#ece6ff', glow: '#ffc23d', dark: '#3a2f63', accent: '#3fd2ff' },
    },
  };

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Pose fields (all optional except t/facing): t (seconds), facing 'front'|'back',
  // swing (-1 or 0..1.2) + wing, toss, speed 0..1 (smoothed running speed),
  // lean -1..1 (screen-sideways velocity), stride (radians, advances with distance run),
  // prep 0..1 + prepWing (backswing as the ball arrives), lod (0..2 detail level).
  function readPose(pose) {
    return {
      t: pose.t,
      spd: pose.speed != null ? pose.speed : pose.running ? 1 : 0,
      lean: pose.lean || 0,
      st: pose.stride != null ? pose.stride : pose.t * 9,
      lod: pose.lod != null ? pose.lod : 2,
    };
  }

  // shortest-way angle blend
  function lerpAng(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // Hand position and racket angle (canvas radians, 0 = +x, -PI/2 = up) at
  // progress e of a stroke. R is +1 when the player's right hand is screen-right;
  // (sx, sy) is the middle of the shoulders.
  function strokeAt(wing, e, R, sx, sy) {
    const L = CT.lerp;
    let hx, hy, a;
    if (wing === 'serve' || wing === 'oh') {
      if (wing === 'oh') e = 0.15 + 0.85 * e;          // smash starts from the trophy pose
      if (e < 0.3) {
        const u = e / 0.3;
        hx = R * L(0.16, 0.2, u); hy = L(-0.12, -0.62, u); a = L(1.9, -1.5, u);
      } else {
        const u = easeOut((e - 0.3) / 0.7);
        hx = R * L(0.2, -0.3, u); hy = L(-0.62, 0.5, u); a = L(-1.5, 2.1, u);
      }
      return { hx: sx + hx, hy: sy + hy, ang: R > 0 ? a : Math.PI - a };
    }
    // ground strokes: back and low, through contact at the side, up over the other shoulder
    const side = wing === 'fh' ? R : -R;
    const arc = Math.sin(e * Math.PI);
    a = L(0.5, -2.4, e);
    hx = side * (L(0.6, -0.3, e) + 0.1 * arc);
    hy = L(0.45, -0.18, e) + 0.12 * arc;
    return { hx: sx + hx, hy: sy + hy, ang: side > 0 ? a : Math.PI - a };
  }

  // How the whole body moves with the stroke: coil 1 = turned side-on with the
  // racket back, -1 = unwound after the follow-through. side = screen side of the stroke.
  function swingState(pose, R) {
    if (pose.swing >= 0) {
      const e = easeOut(Math.min(1, pose.swing));
      if (pose.wing === 'serve' || pose.wing === 'oh') {
        const crouch = e < 0.3 ? CT.lerp(0.02, -0.05, e / 0.3) : CT.lerp(-0.05, 0.05, (e - 0.3) / 0.7);
        return { coil: 0, side: R, crouch, e, up: e < 0.4 ? 1 : 0 };
      }
      return { coil: Math.cos(e * Math.PI), side: pose.wing === 'fh' ? R : -R, crouch: 0.08 * Math.sin(e * Math.PI), e, up: 0 };
    }
    if (pose.toss) return { coil: 0.5, side: R, crouch: 0.08, e: 0, up: 1 };
    const p = clamp01(pose.prep || 0);
    if (p > 0) return { coil: easeOut(p), side: pose.prepWing === 'bh' ? -R : R, crouch: 0.06 * p, e: 0, up: 0 };
    return { coil: 0, side: R, crouch: 0, e: 0, up: 0 };
  }

  function racketPose(pose, R, sx, sy, P) {
    if (pose.swing >= 0) return strokeAt(pose.wing, easeOut(Math.min(1, pose.swing)), R, sx, sy);
    if (pose.toss) {
      const bob = Math.sin(pose.t * 5) * 0.015;
      return { hx: sx + R * 0.3, hy: sy - 0.22 + bob, ang: R > 0 ? -2.45 : Math.PI + 2.45 };
    }
    // ready position: racket out in front, bobbing; pumped a little when running
    const bob = Math.sin(pose.t * 6) * 0.03 * (1 - P.spd) + Math.sin(P.st) * 0.07 * P.spd;
    const ready = {
      hx: sx + R * (0.32 + 0.04 * P.spd), hy: sy + 0.42 + bob,
      ang: R > 0 ? CT.lerp(-1.15, -0.55, P.spd) : Math.PI - CT.lerp(-1.15, -0.55, P.spd),
    };
    const p = clamp01(pose.prep || 0);
    if (p <= 0) return ready;
    // take the racket back with a little loop as the ball arrives
    const back = strokeAt(pose.prepWing === 'bh' ? 'bh' : 'fh', 0, R, sx, sy);
    const q = easeOut(p);
    return {
      hx: CT.lerp(ready.hx, back.hx, q),
      hy: CT.lerp(ready.hy, back.hy, q) - 0.22 * Math.sin(q * Math.PI),
      ang: lerpAng(ready.ang, back.ang, q),
    };
  }

  // Where the free hand goes: balancing, pointing at the ball, tossing.
  function offHand(pose, sw, R, sx, sy, P) {
    if (pose.toss) return [sx - R * 0.1, sy - 0.66 + Math.sin(pose.t * 5) * 0.02];
    if (pose.swing >= 0 && (pose.wing === 'serve' || pose.wing === 'oh')) {
      const u = clamp01(sw.e * 1.8);
      return [sx - R * CT.lerp(0.1, 0.18, u), sy + CT.lerp(-0.6, 0.42, u)];
    }
    if (pose.swing >= 0) {
      const s = sw.side;
      if (s === R) return [sx + s * CT.lerp(0.18, -0.36, sw.e), sy + CT.lerp(0.05, 0.3, sw.e)];   // forehand
      return [sx + s * CT.lerp(0.25, -0.45, sw.e), sy + CT.lerp(0.35, 0.12, sw.e)];                 // backhand
    }
    const p = clamp01(pose.prep || 0);
    const rest = [sx - R * 0.36, sy + 0.4 + Math.sin(pose.t * 4) * 0.02 - Math.sin(P.st) * 0.08 * P.spd];
    if (p <= 0) return rest;
    const point = sw.side === R ? [sx + R * 0.12, sy + 0.08] : [sx - R * 0.05, sy + 0.38];
    return [CT.lerp(rest[0], point[0], p), CT.lerp(rest[1], point[1], p)];
  }

  // Two-bone joint (elbow or knee) between a and c. The joint bends towards
  // (dx, dy); flat < 1 foreshortens the bend for a limb seen from the front.
  function joint(ax, ay, cx, cy, l1, l2, dx, dy, flat) {
    const vx = cx - ax, vy = cy - ay;
    const d = Math.hypot(vx, vy) || 1e-4;
    let along, h;
    if (d >= l1 + l2) { along = d * l1 / (l1 + l2); h = 0; }
    else { along = (l1 * l1 - l2 * l2 + d * d) / (2 * d); h = Math.sqrt(Math.max(0, l1 * l1 - along * along)); }
    let nx = -vy / d, ny = vx / d;
    if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
    return [ax + (vx / d) * along + nx * h * flat, ay + (vy / d) * along + ny * h * flat];
  }

  function cubic(p0, p1, p2, p3, q) {
    const a = (1 - q) * (1 - q) * (1 - q), b = 3 * (1 - q) * (1 - q) * q, c = 3 * (1 - q) * q * q, d = q * q * q;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
  }
  function quad(p0, p1, p2, q) {
    const a = (1 - q) * (1 - q), b = 2 * (1 - q) * q, c = q * q;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  }

  // Adds a limb that tapers from w0 to w1 (half-widths) along pts to the current path.
  function taper(ctx, pts, w0, w1) {
    const n = pts.length, L = [], Rt = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const m = Math.hypot(tx, ty) || 1e-4;
      tx /= m; ty /= m;
      const w = CT.lerp(w0, w1, i / (n - 1));
      L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
      Rt.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
    }
    ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
    const e = pts[n - 1];
    ctx.arc(e[0], e[1], w1, Math.atan2(L[n - 1][1] - e[1], L[n - 1][0] - e[0]), Math.atan2(Rt[n - 1][1] - e[1], Rt[n - 1][0] - e[0]));
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(Rt[i][0], Rt[i][1]);
    ctx.closePath();
  }

  function mix(h1, h2, t) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const ch = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  function drawRacket(ctx, hx, hy, ang, frame, strings, lod) {
    const L = 0.42, hl = 0.17, hw = 0.13;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1530';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(-0.06, 0); ctx.lineTo(L, 0); ctx.stroke();
    ctx.translate(L + hl, 0);
    ctx.fillStyle = strings;
    ctx.beginPath(); ctx.ellipse(0, 0, hl, hw, 0, 0, Math.PI * 2); ctx.fill();
    if (lod > 0) {
      // a hint of string bed
      const sb = ctx.shadowBlur;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = strings;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(-hl * 0.85, 0); ctx.lineTo(hl * 0.85, 0);
      ctx.moveTo(-hl * 0.45, -hw * 0.85); ctx.lineTo(-hl * 0.45, hw * 0.85);
      ctx.moveTo(hl * 0.3, -hw * 0.9); ctx.lineTo(hl * 0.3, hw * 0.9);
      ctx.stroke();
      ctx.shadowBlur = sb;
    }
    // frame and throat in one glowing stroke
    ctx.strokeStyle = frame;
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.ellipse(0, 0, hl, hw, 0, 0, Math.PI * 2);
    ctx.moveTo(-hl, 0); ctx.lineTo(-hl - 0.12, 0);
    ctx.stroke();
    ctx.restore();
  }

  // Fading arc behind the racket head while it swings.
  function drawSwoosh(ctx, pose, R, sx, sy, color) {
    if (!(pose.swing >= 0 && pose.swing < 0.75)) return;
    const e1 = easeOut(Math.min(1, pose.swing));
    const e0 = Math.max(0, e1 - 0.38);
    const head = (e) => {
      const s = strokeAt(pose.wing, e, R, sx, sy);
      return [s.hx + Math.cos(s.ang) * 0.59, s.hy + Math.sin(s.ang) * 0.59];
    };
    const fade = 1 - pose.swing / 0.75;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    let prev = head(e0);
    for (let i = 1; i <= 5; i++) {
      const p = head(CT.lerp(e0, e1, i / 5));
      ctx.globalAlpha = fade * (0.1 + 0.12 * i);
      ctx.lineWidth = 0.04 + 0.035 * i;
      ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      prev = p;
    }
    ctx.restore();
  }

  function glowStroke(ctx, color, width, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
  }

  // ---------------- Octopus ----------------
  const octoShades = {};
  function drawOctopus(ctx, pose, k) {
    const c = CHARACTERS.octopus.colors;
    const sh = octoShades.back ? octoShades : Object.assign(octoShades, {
      back: mix(c.main, c.dark, 0.55), mid: mix(c.main, c.dark, 0.25), hi: mix(c.main, '#ffffff', 0.35),
    });
    const R = pose.facing === 'back' ? 1 : -1;
    const P = readPose(pose);
    const { t, spd, lean, st, lod } = P;
    const sw = swingState(pose, R);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // springy gait: the mantle hops once per step and squashes as it lands
    const hop = spd * 0.07 * Math.abs(Math.sin(st));
    const sq = Math.sin(t * 2.2) * 0.02 * (1 - spd) + spd * 0.05 * Math.cos(2 * st);
    const bodyX = lean * 0.07;
    const tilt = lean * 0.2 - sw.side * sw.coil * 0.07;
    const bottom = -0.95 + sw.crouch * 0.8 - hop;
    const cs = Math.cos(tilt), sn = Math.sin(tilt), wx = 1 + sq, wy = 1 - sq;
    const M = (lx, ly) => [bodyX + lx * wx * cs - ly * wy * sn, bottom + lx * wx * sn + ly * wy * cs];

    // six walking tentacles, outer pair at the back; alternate pairs step together
    const tent = [];
    for (let i = 0; i < 6; i++) {
      const u = (i - 2.5) / 2.5;
      const sg = u < 0 ? -1 : 1;
      const ph = st + (i % 2) * Math.PI + u * 0.4;
      const lift = spd * 0.16 * Math.max(0, Math.sin(ph));
      const wave = Math.sin(t * 2.4 + i * 1.1) * 0.04 * (1 - spd * 0.5);
      const base = M(u * 0.2, -0.02);
      const tipX = u * 0.66 + bodyX * 0.4 + spd * lean * 0.26 * Math.cos(ph) + wave;
      const tipY = -0.02 - lift;
      const c1 = [base[0] + u * 0.3 - lean * 0.08, base[1] + 0.22];
      const c2 = [tipX * 1.12 - lean * 0.16 * spd - wave, -0.32 - lift * 0.5];
      const tip = [tipX, tipY];
      const pts = [];
      for (let s = 0; s <= 8; s++) pts.push(cubic(base, c1, c2, tip, s / 8));
      // the tip flicks outwards along the ground
      pts.push([tipX + sg * 0.06, tipY - 0.012], [tipX + sg * 0.1, tipY - 0.045 - Math.abs(wave) * 0.4]);
      tent.push({ pts, rank: Math.abs(u) });
    }
    const ranks = [[1, sh.back], [0.6, sh.mid], [0.2, c.main]];
    ctx.shadowBlur = 0;
    for (const [rank, fill] of ranks) {
      ctx.beginPath();
      for (const tt of tent) if (Math.abs(tt.rank - rank) < 0.01) taper(ctx, tt.pts, 0.1 - rank * 0.014, 0.018);
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = c.dark; ctx.lineWidth = 0.022; ctx.stroke();
    }
    if (lod > 0) {
      // glowing suckers down each tentacle
      ctx.beginPath();
      for (const tt of tent) {
        for (const s of [2, 4, 6]) {
          const p = tt.pts[s];
          const r = 0.026 - s * 0.0024;
          ctx.moveTo(p[0] + r, p[1]); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = c.glow; ctx.fill();
    }

    // mantle (tall, Medvedev-lanky)
    ctx.save();
    ctx.translate(bodyX, bottom);
    ctx.rotate(tilt);
    ctx.scale(wx, wy);
    const top = -1.03;
    const g = ctx.createLinearGradient(-0.3, top, 0.2, 0);
    g.addColorStop(0, sh.hi);
    g.addColorStop(0.45, c.main);
    g.addColorStop(1, c.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.25, 0);
    ctx.bezierCurveTo(-0.37, -0.4, -0.31, top, 0, top);
    ctx.bezierCurveTo(0.31, top, 0.37, -0.4, 0.25, 0);
    ctx.quadraticCurveTo(0, 0.07, -0.25, 0);
    ctx.fill();
    // rim light and the collar where the tentacles join, one glow pass
    ctx.save();
    glowStroke(ctx, c.glow, 0.025, 10 * k);
    ctx.moveTo(0.24, -0.03);
    ctx.ellipse(0, -0.03, 0.24, 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // soft highlight on the dome
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 0.03;
    ctx.beginPath(); ctx.arc(-0.02, -0.72, 0.24, -2.6, -1.75); ctx.stroke();
    if (lod > 0) {
      // pulsing chromatophore spots
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 3.1);
      ctx.fillStyle = c.accent;
      ctx.beginPath();
      const spots = pose.facing === 'front'
        ? [[-0.2, -0.62, 0.02], [0.21, -0.58, 0.018], [-0.14, -0.82, 0.016], [0.15, -0.85, 0.02], [0, -0.92, 0.015], [-0.22, -0.22, 0.016], [0.22, -0.2, 0.018]]
        : [[-0.18, -0.7, 0.02], [0.19, -0.62, 0.02], [-0.12, -0.9, 0.016], [0.2, -0.86, 0.015], [-0.2, -0.35, 0.018], [0.2, -0.3, 0.016]];
      for (const [x, y, r] of spots) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (pose.facing === 'front') {
      // visor with two eye lights that follow where he's heading
      ctx.fillStyle = '#0b0618';
      ctx.beginPath();
      ctx.ellipse(0, -0.37, 0.235, 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = c.accent; ctx.shadowBlur = 12 * k;
      ctx.fillStyle = c.accent;
      const look = Math.max(-0.06, Math.min(0.06, lean * 0.06 + sw.side * sw.coil * 0.03 + Math.sin(t * 0.7) * 0.015));
      const blink = t % 4.3 < 0.12 ? 0.25 : 1;
      ctx.beginPath();
      ctx.ellipse(-0.09 + look, -0.37, 0.048, 0.03 * blink, 0, 0, Math.PI * 2);
      ctx.ellipse(0.09 + look, -0.37, 0.048, 0.03 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // circuitry down the back of the mantle
      glowStroke(ctx, c.glow, 0.014, 6 * k);
      ctx.beginPath();
      ctx.moveTo(0, -0.95); ctx.lineTo(0, -0.2);
      ctx.moveTo(0, -0.65); ctx.lineTo(0.1, -0.55); ctx.lineTo(0.1, -0.3);
      ctx.moveTo(0, -0.5); ctx.lineTo(-0.11, -0.4); ctx.lineTo(-0.11, -0.15);
      ctx.moveTo(0.1, -0.3); ctx.arc(0.1, -0.3 + 0.02, 0.02, -Math.PI / 2, Math.PI * 1.5);
      ctx.moveTo(-0.11, -0.15); ctx.arc(-0.11, -0.15 + 0.02, 0.02, -Math.PI / 2, Math.PI * 1.5);
      ctx.stroke();
    }
    ctx.restore();

    // the racket tentacle whips round with the swing; the free one balances or tosses
    const sh0 = M(0, -0.2);
    const sx = sh0[0], sy = sh0[1];
    const rp = racketPose(pose, R, sx, sy, P);
    let oh = offHand(pose, sw, R, sx, sy, P);
    if (pose.swing < 0 && !pose.toss && !(pose.prep > 0)) {
      // the free tentacle hangs out to the side for balance, rippling
      oh = [sx - R * (0.46 + 0.05 * P.spd), sy + 0.12 + Math.sin(t * 4) * 0.04 - Math.sin(st) * 0.07 * spd];
    }
    const arm = (base, hand, out, bend) => {
      const ctrl = [base[0] + out * 0.22 + bend, Math.min(base[1], hand[1]) + Math.abs(hand[1] - base[1]) * 0.5 + 0.1];
      const pts = [];
      for (let s = 0; s <= 8; s++) pts.push(quad(base, ctrl, hand, s / 8));
      return pts;
    };
    const rArm = arm(M(R * 0.24, -0.2), [rp.hx, rp.hy], R, -sw.side * sw.coil * 0.14);
    const oArm = arm(M(-R * 0.24, -0.2), oh, -R, 0);
    ctx.beginPath();
    taper(ctx, oArm, 0.07, 0.028);
    taper(ctx, rArm, 0.08, 0.034);
    ctx.fillStyle = c.main; ctx.fill();
    ctx.strokeStyle = c.dark; ctx.lineWidth = 0.022; ctx.stroke();

    drawSwoosh(ctx, pose, R, sx, sy, c.glow);
    ctx.save();
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    drawRacket(ctx, rp.hx, rp.hy, rp.ang, c.glow, 'rgba(40,240,214,0.18)', lod);
    ctx.restore();
  }

  // ---------------- Philosopher ----------------
  function drawPhilosopher(ctx, pose, k) {
    const c = CHARACTERS.philosopher.colors;
    const R = pose.facing === 'back' ? 1 : -1;
    const front = pose.facing === 'front';
    const P = readPose(pose);
    const { t, spd, lean, st, lod } = P;
    const sw = swingState(pose, R);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const skin = '#c98f6b', skinDark = '#a8714f';

    // hips: athletic crouch at rest, a bounce per step when running, lower through contact
    const bounce = spd * 0.05 * Math.abs(Math.sin(st));
    const hipY = -0.93 + 0.05 * (1 - spd) + sw.crouch - bounce;
    const hipX = lean * 0.04 + Math.sin(t * 1.6) * 0.008 * (1 - spd);
    const tilt = lean * 0.14 - sw.side * sw.coil * 0.04;
    const cs = Math.cos(tilt), sn = Math.sin(tilt);
    const G = (lx, ly) => [hipX + lx * cs - ly * sn, hipY + lx * sn + ly * cs];

    // shoulders narrow as the body turns side-on
    const shw = 0.21 * (1 - 0.22 * Math.abs(sw.coil));
    const shift = -sw.side * sw.coil * 0.05;
    const SR = G(shift + R * shw, -0.56), SL = G(shift - R * shw, -0.56);
    const sx = (SR[0] + SL[0]) / 2, sy = (SR[1] + SL[1]) / 2;
    const head = G(shift * 0.6, -0.8);

    // legs: two-bone, knees bowed out a little, feet lifting with the stride
    const greaves = [], legs = [];
    for (const s of [-1, 1]) {
      const ph = st + (s > 0 ? 0 : Math.PI);
      const hip = G(s * 0.09, 0);
      const fx = s * (0.16 + sw.crouch * 0.6) + hipX * 0.3 + spd * lean * 0.16 * Math.cos(ph);
      const fy = -spd * 0.16 * Math.max(0, Math.sin(ph));
      const knee = joint(hip[0], hip[1], fx, fy, 0.47, 0.47, s, 0.3, 0.45);
      legs.push({ s, hip, knee, foot: [fx, fy] });
      greaves.push([CT.lerp(knee[0], fx, 0.3), CT.lerp(knee[1], fy, 0.3), CT.lerp(knee[0], fx, 0.82), CT.lerp(knee[1], fy, 0.82)]);
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = skin;
    for (const l of legs) {
      ctx.lineWidth = 0.115;
      ctx.beginPath(); ctx.moveTo(l.hip[0], l.hip[1]); ctx.lineTo(l.knee[0], l.knee[1]); ctx.stroke();
      ctx.lineWidth = 0.092;
      ctx.beginPath(); ctx.moveTo(l.knee[0], l.knee[1]); ctx.lineTo(l.foot[0], l.foot[1] - 0.03); ctx.stroke();
    }
    // sandals with straps
    ctx.fillStyle = '#4a2e18';
    ctx.beginPath();
    for (const l of legs) { ctx.moveTo(l.foot[0] + l.s * 0.02 + 0.08, l.foot[1] - 0.02); ctx.ellipse(l.foot[0] + l.s * 0.02, l.foot[1] - 0.02, 0.08, 0.032, 0, 0, Math.PI * 2); }
    ctx.fill();
    if (lod > 0) {
      ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 0.014;
      ctx.beginPath();
      for (const l of legs) {
        const [x, y] = l.foot;
        ctx.moveTo(x - 0.045, y - 0.07); ctx.lineTo(x + 0.045, y - 0.1);
        ctx.moveTo(x - 0.045, y - 0.12); ctx.lineTo(x + 0.045, y - 0.15);
      }
      ctx.stroke();
    }
    ctx.save();
    glowStroke(ctx, c.accent, 0.04, 8 * k);
    ctx.beginPath();
    for (const q of greaves) { ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3]); }
    ctx.stroke();
    ctx.restore();

    // chiton: skirt swings against the movement, bodice turns with the shoulders
    const flare = -lean * 0.08 + spd * 0.03 * Math.sin(2 * st);
    const hemY = 0.24 - spd * 0.03;
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.rotate(tilt);
    const g = ctx.createLinearGradient(-0.3, -0.6, 0.3, 0.25);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, c.main);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(shift - shw + 0.02, -0.56);
    ctx.quadraticCurveTo(shift, -0.6, shift + shw - 0.02, -0.56);
    ctx.quadraticCurveTo(0.19, -0.3, 0.16, -0.1);
    ctx.lineTo(0.25 + flare, hemY);
    ctx.quadraticCurveTo(0.12 + flare, hemY + 0.05, 0.06 + flare * 0.8, hemY - 0.01);
    ctx.quadraticCurveTo(-0.02 + flare * 0.6, hemY + 0.05, -0.08 + flare * 0.6, hemY);
    ctx.quadraticCurveTo(-0.17 + flare * 0.5, hemY + 0.05, -0.25 + flare * 0.4, hemY - 0.02);
    ctx.lineTo(-0.16, -0.1);
    ctx.quadraticCurveTo(-0.19, -0.3, shift - shw + 0.02, -0.56);
    ctx.fill();
    // folds
    if (lod > 0) {
      ctx.strokeStyle = 'rgba(58,47,99,0.3)';
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = -0.15 + i * 0.1;
        ctx.moveTo(x * 0.9, -0.08);
        ctx.quadraticCurveTo(x + flare * 0.3, 0.08, x * 1.2 + flare * (0.5 + i * 0.1), hemY - 0.01);
      }
      ctx.moveTo(shift - R * 0.12, -0.5); ctx.quadraticCurveTo(shift, -0.35, shift + R * 0.1, -0.16);
      ctx.stroke();
    }
    // drape over the free shoulder and the hem, gold neon
    ctx.save();
    glowStroke(ctx, c.glow, 0.03, 10 * k);
    ctx.beginPath();
    ctx.moveTo(shift - R * shw, -0.55);
    ctx.quadraticCurveTo(shift + R * 0.02, -0.34, R * 0.17, -0.12);
    ctx.moveTo(-0.25 + flare * 0.4, hemY - 0.02);
    ctx.quadraticCurveTo(-0.17 + flare * 0.5, hemY + 0.05, -0.08 + flare * 0.6, hemY);
    ctx.quadraticCurveTo(-0.02 + flare * 0.6, hemY + 0.05, 0.06 + flare * 0.8, hemY - 0.01);
    ctx.quadraticCurveTo(0.12 + flare, hemY + 0.05, 0.25 + flare, hemY);
    ctx.stroke();
    ctx.restore();
    // neon belt
    ctx.save();
    glowStroke(ctx, c.accent, 0.03, 8 * k);
    ctx.beginPath(); ctx.moveTo(-0.165, -0.11); ctx.quadraticCurveTo(0, -0.08, 0.165, -0.11); ctx.stroke();
    ctx.restore();
    ctx.restore();

    // head (drawn before the arms so a follow-through can cross in front)
    const hx = head[0], hy = head[1];
    const sway = -lean * 0.05 + spd * 0.015 * Math.sin(2 * st);
    // headband ties stream out behind when he runs
    const tie = (dx) => {
      ctx.moveTo(hx + dx, hy - 0.06);
      ctx.quadraticCurveTo(hx + dx - lean * 0.12, hy - 0.02 + Math.sin(t * 9) * 0.02 * (0.3 + spd), hx + dx - lean * 0.24 + dx * 0.4, hy + 0.08 + Math.sin(t * 9 + 1) * 0.03 * (0.3 + spd));
    };
    ctx.fillStyle = '#2b1a12';           // long hair, shoulder length
    ctx.beginPath();
    ctx.moveTo(hx - 0.155, hy + 0.02);
    ctx.ellipse(hx, hy + 0.01, 0.155, 0.17, 0, Math.PI, 0);
    ctx.quadraticCurveTo(hx + 0.18 + sway, hy + 0.12, hx + 0.16 + sway, hy + 0.24);
    ctx.quadraticCurveTo(hx + 0.08 + sway, hy + 0.2, hx + sway * 0.8, hy + 0.27);
    ctx.quadraticCurveTo(hx - 0.08 + sway, hy + 0.2, hx - 0.16 + sway, hy + 0.24);
    ctx.quadraticCurveTo(hx - 0.18 + sway, hy + 0.12, hx - 0.155, hy + 0.02);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.ellipse((SR[0] + SL[0]) / 2 + shift * 0.2, sy - 0.04, 0.05, 0.06, 0, 0, Math.PI * 2); ctx.fill();   // neck
    if (front) {
      ctx.beginPath(); ctx.ellipse(hx, hy + 0.02, 0.112, 0.138, 0, 0, Math.PI * 2); ctx.fill();
      if (lod > 0) {
        ctx.fillStyle = skinDark;           // ears and a shaded jaw
        ctx.beginPath();
        ctx.ellipse(hx - 0.112, hy + 0.02, 0.022, 0.035, 0, 0, Math.PI * 2);
        ctx.ellipse(hx + 0.112, hy + 0.02, 0.022, 0.035, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#3b2418';         // beard
      ctx.beginPath();
      ctx.moveTo(hx - 0.11, hy + 0.03);
      ctx.quadraticCurveTo(hx - 0.105, hy + 0.2, hx, hy + 0.24);
      ctx.quadraticCurveTo(hx + 0.105, hy + 0.2, hx + 0.11, hy + 0.03);
      ctx.quadraticCurveTo(hx + 0.06, hy + 0.1, hx + 0.03, hy + 0.09);
      ctx.lineTo(hx - 0.03, hy + 0.09);
      ctx.quadraticCurveTo(hx - 0.06, hy + 0.1, hx - 0.11, hy + 0.03);
      ctx.fill();
      const look = Math.max(-0.02, Math.min(0.02, lean * 0.02));
      const blink = (t + 1.7) % 3.9 < 0.12 ? 0.3 : 1;
      ctx.fillStyle = '#120a20';
      ctx.fillRect(hx - 0.07 + look, hy - 0.005, 0.038, 0.022 * blink);
      ctx.fillStyle = c.accent;          // cyber eye
      ctx.fillRect(hx + 0.035 + look, hy - 0.005, 0.038, 0.022 * blink);
      ctx.fillStyle = '#2b1a12';         // brows
      ctx.fillRect(hx - 0.075, hy - 0.035, 0.048, 0.014);
      ctx.fillRect(hx + 0.03, hy - 0.035, 0.048, 0.014);
    } else if (lod > 0) {
      // curls on the back of the head
      ctx.strokeStyle = '#4a2e1c'; ctx.lineWidth = 0.014;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = hx - 0.1 + i * 0.065 + sway * 0.6;
        ctx.moveTo(x, hy + 0.02); ctx.quadraticCurveTo(x + 0.03, hy + 0.12, x - 0.01, hy + 0.21);
      }
      ctx.stroke();
    }
    // headband (and its ties) then the glowing laurel wreath
    ctx.save();
    glowStroke(ctx, c.accent, 0.03, 8 * k);
    ctx.beginPath();
    ctx.moveTo(hx - 0.15, hy - 0.06); ctx.quadraticCurveTo(hx, hy - (front ? 0.08 : 0.04), hx + 0.15, hy - 0.06);
    if (!front || Math.abs(lean) > 0.2) { tie(0.13 * (lean > 0 ? -1 : 1)); tie(0.1 * (lean > 0 ? -1 : 1)); }
    ctx.stroke();
    ctx.fillStyle = c.glow;
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const x = hx + Math.cos(a) * 0.155, y = hy - 0.08 + Math.sin(a) * 0.1;
      ctx.moveTo(x, y);
      ctx.ellipse(x, y, 0.036, 0.016, a + Math.PI / 2, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.restore();

    // arms: two-bone, elbows out; a cyber gauntlet on the racket forearm
    const rp = racketPose(pose, R, sx, sy, P);
    let oh = offHand(pose, sw, R, sx, sy, P);
    if (pose.swing < 0 && !pose.toss && !(pose.prep > 0.3) && spd < 0.3) {
      // between points the free hand rests on the racket's throat
      oh = [rp.hx + Math.cos(rp.ang) * 0.3, rp.hy + Math.sin(rp.ang) * 0.3];
    }
    const rUp = rp.hy < SR[1];
    const rEl = joint(SR[0], SR[1], rp.hx, rp.hy, 0.3, 0.29, R, rUp ? 0.2 : 1, 0.8);
    const oEl = joint(SL[0], SL[1], oh[0], oh[1], 0.3, 0.29, -R, oh[1] < SL[1] ? 0.2 : 1, 0.8);
    ctx.strokeStyle = skin;
    ctx.lineWidth = 0.085;
    ctx.beginPath();
    ctx.moveTo(SL[0], SL[1]); ctx.lineTo(oEl[0], oEl[1]); ctx.lineTo(oh[0], oh[1]);
    ctx.moveTo(SR[0], SR[1]); ctx.lineTo(rEl[0], rEl[1]); ctx.lineTo(rp.hx, rp.hy);
    ctx.stroke();
    // sleeve on the draped shoulder
    ctx.strokeStyle = '#f4f1ff'; ctx.lineWidth = 0.11;
    ctx.beginPath(); ctx.moveTo(SL[0], SL[1]); ctx.lineTo(CT.lerp(SL[0], oEl[0], 0.45), CT.lerp(SL[1], oEl[1], 0.45)); ctx.stroke();
    ctx.save();
    glowStroke(ctx, c.accent, 0.05, 8 * k);
    ctx.beginPath();
    ctx.moveTo(CT.lerp(rEl[0], rp.hx, 0.3), CT.lerp(rEl[1], rp.hy, 0.3)); ctx.lineTo(rp.hx, rp.hy);
    // shoulder plate
    ctx.moveTo(SR[0] - R * 0.05, SR[1] - 0.03); ctx.quadraticCurveTo(SR[0] + R * 0.03, SR[1] - 0.07, SR[0] + R * 0.06, SR[1] + 0.03);
    ctx.stroke();
    ctx.restore();

    drawSwoosh(ctx, pose, R, sx, sy, c.glow);
    ctx.save();
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    drawRacket(ctx, rp.hx, rp.hy, rp.ang, c.glow, 'rgba(255,194,61,0.16)', lod);
    ctx.restore();
    // hands over the grip
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(rp.hx + 0.045, rp.hy); ctx.arc(rp.hx, rp.hy, 0.045, 0, Math.PI * 2);
    ctx.moveTo(oh[0] + 0.04, oh[1]); ctx.arc(oh[0], oh[1], 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  // Short streaks trailing a player who is sprinting sideways.
  function drawSpeedLines(ctx, pose, color) {
    const spd = pose.speed || 0, lean = pose.lean || 0;
    if (!(spd > 0.45 && Math.abs(lean) > 0.25) || pose.lod === 0) return;
    const d = lean > 0 ? -1 : 1;
    ctx.save();
    ctx.globalAlpha = Math.min(0.6, (spd - 0.45) * 1.2) * Math.min(1, Math.abs(lean) * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.025;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const jit = (pose.stride || 0) * 0.7;
    for (const [y, l, o] of [[-1.5, 0.35, 0.38], [-1.1, 0.5, 0.42], [-0.7, 0.3, 0.36]]) {
      const x0 = d * (o + 0.05 * Math.sin(jit + y * 7));
      ctx.moveTo(x0, y); ctx.lineTo(x0 + d * l, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCharacter(ctx, id, pose, k) {
    const ch = CHARACTERS[id] || CHARACTERS.philosopher;
    drawSpeedLines(ctx, pose, ch.colors.glow);
    if (id === 'octopus') drawOctopus(ctx, pose, k);
    else drawPhilosopher(ctx, pose, k);
  }

  CT.CHARACTERS = CHARACTERS;
  CT.drawCharacter = drawCharacter;
})();
