// Third-person renderer: a raised chase camera behind the bottom player that
// follows them across the baseline and turns towards the ball, plus the
// rooftop parking lot, court, net, players, ball and touch guides.
(function () {
  const CT = (window.CT = window.CT || {});
  const { COURT } = CT;

  const PAL = {
    line: '#7af6ff', lineGlow: 'rgba(37,217,255,0.35)',
    net: '#ff3fb4', ball: '#e4ff4a', ballGlow: '#c6ff2e',
    guide: '#25d9ff', warn: '#ff3f6c',
  };

  const SPRITE_SCALE = 1.15;   // players a little larger than life so they read on a phone
  const NEAR = 0.4;            // near clipping distance in metres
  const LOT_EDGE = 17.5;       // far edge of the rooftop; open sky beyond it

  // Chase-camera framing. Raised high enough that the ball stays visible over
  // your player's head, looking a little past the net.
  const CAM = { back: 7.2, height: 6.4, lookAhead: 13, follow: 0.75, ballPull: 0.4, ease: 3.2 };

  function createRenderer(canvas) {
    return {
      canvas, ctx: canvas.getContext('2d'),
      cam: { x: 0, y: -20, z: 6.4, lx: 0, ly: 0, lz: 0, f: 500, cx: 0, cy: 0, yaw: 0, pitch: 0, ready: false },
      W: 0, H: 0, dpr: 1, top: 92, bottom: 24, hudBottom: 0,
      sky: document.createElement('canvas'),
      glow: {},
      // phones with few cores or little memory start one level down
      quality: (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3 ? 1 : 2,
      frames: [],
      lastT: 0,
    };
  }

  // ---------------- camera maths ----------------
  function setBasis(c) {
    const dx = c.lx - c.x, dy = c.ly - c.y, dz = c.lz - c.z;
    c.yaw = Math.atan2(dx, dy);
    c.pitch = Math.atan2(dz, Math.hypot(dx, dy));
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    c.F = { x: sy * cp, y: cy * cp, z: sp };
    c.R = { x: cy, y: -sy, z: 0 };
    c.U = { x: -sy * sp, y: -cy * sp, z: cp };   // R x F
  }

  function toCam(c, x, y, z) {
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    return {
      x: dx * c.R.x + dy * c.R.y,
      y: dx * c.U.x + dy * c.U.y + dz * c.U.z,
      z: dx * c.F.x + dy * c.F.y + dz * c.F.z,
    };
  }

  function fromCamToScreen(c, v) {
    const s = c.f / v.z;
    return { x: c.cx + v.x * s, y: c.cy - v.y * s, s, z: v.z };
  }

  // World point to screen. `behind` is set when the point is behind the camera.
  function proj(r, x, y, z) {
    const c = r.cam;
    const v = toCam(c, x, y, z);
    if (v.z < NEAR) return { x: -9999, y: -9999, s: 0, z: v.z, behind: true };
    return fromCamToScreen(c, v);
  }

  // Screen point to a spot on the ground (for tap-to-move).
  function unproject(r, sx, sy) {
    const c = r.cam;
    const a = (sx - c.cx) / c.f, b = (c.cy - sy) / c.f;
    const d = {
      x: c.F.x + a * c.R.x + b * c.U.x,
      y: c.F.y + a * c.R.y + b * c.U.y,
      z: c.F.z + b * c.U.z,
    };
    if (d.z >= -1e-3) return null;
    const t = -c.z / d.z;
    return { x: c.x + d.x * t, y: c.y + d.y * t };
  }

  // Clip a world polygon against the near plane and trace it as a path.
  function tracePoly(ctx, r, pts) {
    const c = r.cam;
    const v = pts.map((p) => toCam(c, p[0], p[1], p[2] || 0));
    const out = [];
    for (let i = 0; i < v.length; i++) {
      const a = v[i], b = v[(i + 1) % v.length];
      const ain = a.z >= NEAR, bin = b.z >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (NEAR - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
      }
    }
    if (out.length < 3) return false;
    ctx.beginPath();
    out.forEach((p, i) => { const s = fromCamToScreen(c, p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.closePath();
    return true;
  }

  function fillPoly(ctx, r, pts, style) {
    if (tracePoly(ctx, r, pts)) { ctx.fillStyle = style; ctx.fill(); }
  }

  // Clipped world line segment; returns screen endpoints or null.
  function segment(r, a, b) {
    const c = r.cam;
    let p = toCam(c, a[0], a[1], a[2] || 0), q = toCam(c, b[0], b[1], b[2] || 0);
    if (p.z < NEAR && q.z < NEAR) return null;
    if (p.z < NEAR || q.z < NEAR) {
      const t = (NEAR - p.z) / (q.z - p.z);
      const m = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: NEAR };
      if (p.z < NEAR) p = m; else q = m;
    }
    return [fromCamToScreen(c, p), fromCamToScreen(c, q)];
  }

  // Add a clipped segment to the current path (stroke later, in one go).
  function pathSeg(ctx, r, a, b) {
    const s = segment(r, a, b);
    if (s) { ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); }
  }

  function strokeSeg(ctx, r, a, b) {
    const s = segment(r, a, b);
    if (!s) return;
    ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
  }

  // An ellipse lying flat on the ground, foreshortened by the viewing angle.
  function groundEllipse(ctx, r, x, y, rad) {
    const p = proj(r, x, y, 0);
    if (p.behind) return null;
    const c = r.cam;
    const dist = Math.hypot(x - c.x, y - c.y, c.z);
    const squash = Math.max(0.12, c.z / dist);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rad * p.s, rad * p.s * squash, 0, 0, Math.PI * 2);
    return p;
  }

  // ---------------- camera control ----------------
  function updateCamera(r, g, human, dt) {
    const c = r.cam;
    const p = g.players[human];
    const b = g.ball;
    const fwd = p.fwd;
    // follow the player across the court, staying behind them
    const tx = p.x * CAM.follow;
    const ty = p.y - fwd * CAM.back;
    // look ahead down the court, turning towards the ball
    const bx = b.active ? b.pos.x : 0;
    const lx = CT.clamp(p.x * 0.35 + bx * CAM.ballPull, -6, 6);
    const ly = p.y + fwd * CAM.lookAhead;
    const k = c.ready ? 1 - Math.exp(-dt * CAM.ease) : 1;
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.z = CAM.height;
    c.lx += (lx - c.lx) * k; c.ly += (ly - c.ly) * k; c.lz = 0;
    c.ready = true;
    setBasis(c);
  }

  function resize(r, W, H, top, bottom, hudBottom) {
    r.hudBottom = hudBottom || 0;
    r.args = [W, H, top, bottom, hudBottom];
    r.dpr = Math.min(DPR_CAP[r.quality], window.devicePixelRatio || 1);
    r.glow = {};
    r.W = W; r.H = H; r.top = top; r.bottom = bottom;
    r.canvas.width = Math.round(W * r.dpr); r.canvas.height = Math.round(H * r.dpr);
    r.canvas.style.width = W + 'px'; r.canvas.style.height = H + 'px';
    const c = r.cam;
    // wide enough to see the far court on a narrow phone, not fisheye on a laptop
    c.f = Math.min((W / 2) / Math.tan((21 * Math.PI) / 180), (H / 2) / Math.tan((30 * Math.PI) / 180));
    c.cx = W / 2;
    c.cy = top + (H - top - bottom) * 0.5;
    c.ready = false;
    buildSky(r);
  }

  // Quality levels, highest first. A phone that can't keep up steps down:
  // fewer pixels, no lamp pools, no glow blur on the players.
  const DPR_CAP = [1, 1.25, 1.5];

  // Drop a quality level when frames average slower than ~40 fps.
  function watchFrameRate(r, dt) {
    if (!dt || dt >= 0.1 || r.quality === 0) return;   // skip pauses and tab switches
    r.frames.push(dt);
    if (r.frames.length < 90) return;
    const avg = r.frames.reduce((a, b) => a + b, 0) / r.frames.length;
    r.frames.length = 0;
    if (avg > 0.025) { r.quality--; resize(r, ...r.args); }
  }

  // A soft radial glow, rendered once per colour and size.
  function glowSprite(r, col, a) {
    const key = col + a;
    if (r.glow[key]) return r.glow[key];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, hexA(col, a));
    gr.addColorStop(0.4, hexA(col, a * 0.45));
    gr.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 64, 64);
    return (r.glow[key] = cv);
  }

  // deterministic hash for scenery (not gameplay)
  function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (k > 0 ? (255 - v) * k : v * k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // ---------------- sky and skyline ----------------
  // Sky, stars, moon and skyline are painted once into a strip three screens
  // wide; each frame just copies the visible slice as the camera turns.
  function buildSky(r) {
    const cv = r.sky;
    const W = r.W, sw = Math.round(W * 3);
    const c = r.cam;
    // where the horizon sits for the camera's usual pitch
    const hz = c.cy - c.f * (CAM.height / (CAM.back + CAM.lookAhead));
    const stripH = Math.max(120, r.H * 0.3), base = stripH * 0.72;
    const H = Math.round(hz + stripH - base);
    cv.width = Math.round(sw * r.dpr); cv.height = Math.round(H * r.dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    const sky = ctx.createLinearGradient(0, hz - r.H * 0.6, 0, hz);
    sky.addColorStop(0, '#02030a');
    sky.addColorStop(0.6, '#0a0d26');
    sky.addColorStop(0.9, '#2b1645');
    sky.addColorStop(1, '#4a1d4f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, sw, H);
    for (let i = 0; i < 540; i++) {
      const x = hash(i * 1.7) * sw;
      const y = hz - 12 - hash(i * 2.3 + 9) * Math.max(40, hz - 12);
      if (y < 0) continue;
      ctx.fillStyle = `rgba(230,235,255,${0.25 + hash(i * 5.1) * 0.7})`;
      ctx.fillRect(x, y, hash(i * 7.7) > 0.93 ? 1.6 : 0.9, hash(i * 7.7) > 0.93 ? 1.6 : 0.9);
    }
    const mr = Math.max(8, Math.min(W, r.H) * 0.025);
    const mx = W * 1.78;
    const my = Math.max((r.hudBottom || 0) + mr + 10, hz - Math.max(60, hz * 0.45));
    const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(210,220,255,0.28)');
    halo.addColorStop(1, 'rgba(210,220,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, mr * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,170,210,0.35)';
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2); ctx.fill();
    // the city, its base just below the horizon
    ctx.translate(0, hz - base);
    const haze = ctx.createLinearGradient(0, base - 30, 0, stripH);
    haze.addColorStop(0, 'rgba(74,29,79,0)');
    haze.addColorStop(1, 'rgba(74,29,79,0.9)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, base - 30, sw, stripH - base + 30);
    for (let layer = 0; layer < 2; layer++) {
      const n = 60;
      for (let i = 0; i < n; i++) {
        const bw = (sw / n) * (1.1 + hash(i + layer * 50) * 1.3);
        const bx = (i / n) * sw - bw * 0.3 + layer * 11;
        const bh = base * (layer ? 0.18 + hash(i * 3 + 1) * 0.25 : 0.25 + hash(i * 3) * 0.55);
        const top = base - bh;
        ctx.fillStyle = layer ? '#120c26' : '#0b0819';
        ctx.fillRect(bx, top, bw, stripH - top);
        for (let wy = top + 5; wy < stripH - 3; wy += 6) {
          for (let wx = bx + 3; wx < bx + bw - 3; wx += 5) {
            const h = hash(wx * 0.37 + wy * 1.91 + layer);
            if (h > 0.87) {
              ctx.fillStyle = h > 0.975 ? 'rgba(255,63,180,0.8)' : h > 0.94 ? 'rgba(37,217,255,0.6)' : 'rgba(255,200,120,0.4)';
              ctx.fillRect(wx, wy, 1.6, 2.4);
            }
          }
        }
        if (!layer && hash(i * 9.3) > 0.7) {
          ctx.fillStyle = 'rgba(255,60,60,0.9)';
          ctx.fillRect(bx + bw / 2 - 1, top - 4, 2, 2);
        }
      }
    }
    r.skyW = sw; r.skyH = H; r.skyHz = hz;
  }

  function drawSky(ctx, r) {
    const c = r.cam;
    const horizon = c.cy + c.f * Math.tan(c.pitch);   // screen y of the horizon
    const oy = horizon - r.skyHz;
    if (oy > 0) { ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, r.W, oy + 1); }
    if (oy + r.skyH < r.H) { ctx.fillStyle = '#15161e'; ctx.fillRect(0, oy + r.skyH - 1, r.W, r.H); }
    const sw = r.skyW, pan = -c.yaw * c.f;
    let ox = ((pan - r.W) % sw + sw) % sw - sw;
    for (; ox < r.W; ox += sw) ctx.drawImage(r.sky, ox, oy, sw, r.skyH);
  }

  // ---------------- the lot ----------------
  const LAMPS = [[-7.7, 16.5, '#ffb04a'], [7.7, 16.5, '#ffb04a'], [-7.7, 3, '#ff4fc0'], [7.7, -3, '#3fdcff'], [-7.7, -12, '#ffb04a'], [7.7, -15, '#ffb04a']];
  const STALL_IN = 8.0, STALL_OUT = 13.2, STALL_W = 2.6;
  const CARS = (() => {
    const cars = [];
    for (const sx of [-1, 1]) {
      let k = 0;
      for (let y = -19.5; y < LOT_EDGE - STALL_W; y += STALL_W, k++) {
        if (hash(k * 7.3 + sx * 3.3) < 0.38) continue;
        cars.push({ x: sx * (STALL_IN + 0.5 + 2.15 + hash(k * 1.9) * 0.3), y: y + STALL_W / 2, sx, k });
      }
    }
    return cars;
  })();

  function drawLot(ctx, r) {
    // asphalt deck
    fillPoly(ctx, r, [[-45, LOT_EDGE], [45, LOT_EDGE], [45, -45], [-45, -45]], '#15161e');
    // roof edge: a low parapet with strip lights
    fillPoly(ctx, r, [[-45, LOT_EDGE, 1], [45, LOT_EDGE, 1], [45, LOT_EDGE, 0], [-45, LOT_EDGE, 0]], '#1c1b2a');
    ctx.save();
    ctx.strokeStyle = 'rgba(37,217,255,0.85)'; ctx.lineWidth = 1.5;
    strokeSeg(ctx, r, [-45, LOT_EDGE, 1], [45, LOT_EDGE, 1]);
    ctx.restore();
    // oil stains
    for (let i = 0; i < 14; i++) {
      const x = (hash(i * 13.3) - 0.5) * 22, y = -16 + hash(i * 17.9) * 32;
      if (groundEllipse(ctx, r, x, y, 0.7)) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill(); }
    }
    // parking bays and lane lines
    ctx.strokeStyle = 'rgba(232,230,214,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const sx of [-1, 1]) {
      for (let y = -19.5; y <= LOT_EDGE - 0.5; y += STALL_W) pathSeg(ctx, r, [sx * STALL_IN, y], [sx * STALL_OUT, y]);
    }
    ctx.stroke();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,200,40,0.45)';
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const sx of [-1, 1]) pathSeg(ctx, r, [sx * 7.2, -40], [sx * 7.2, LOT_EDGE]);
    ctx.stroke();
    ctx.restore();
  }

  function drawCourt(ctx, r) {
    const D = COURT.DW, L = COURT.HL, S = COURT.SW;
    // opaque paint (pre-blended over the asphalt) is much cheaper to fill
    fillPoly(ctx, r, [[-D - 1.2, -L - 2.5], [D + 1.2, -L - 2.5], [D + 1.2, L + 2.5], [-D - 1.2, L + 2.5]], '#17294a');
    fillPoly(ctx, r, [[-S, -L], [S, -L], [S, L], [-S, L]], '#1b3a66');
    const lines = [
      [-D, -L, D, -L], [-D, L, D, L],
      [-D, -L, -D, L], [D, -L, D, L],
      [-S, -L, -S, L], [S, -L, S, L],
      [-S, -COURT.SL, S, -COURT.SL], [-S, COURT.SL, S, COURT.SL],
      [0, -COURT.SL, 0, COURT.SL],
      [0, -L, 0, -L + 0.3], [0, L, 0, L - 0.3],
    ];
    // Glow pass, then the bright core. Lines are batched into one path per
    // half of the court so each pass is only a couple of strokes.
    const halves = [[], []];
    for (const [x1, y1, x2, y2] of lines) {
      if (y1 * y2 < 0) {
        halves[0].push([x1, Math.min(y1, y2), x2, 0]);
        halves[1].push([x1, 0, x2, Math.max(y1, y2)]);
      } else halves[y1 + y2 > 0 ? 1 : 0].push([x1, y1, x2, y2]);
    }
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? PAL.line : PAL.lineGlow;
      for (const half of halves) {
        const ref = proj(r, 0, half === halves[0] ? -L * 0.6 : L * 0.6, 0);
        const w = Math.max(1, 0.06 * (ref.s || 10));
        ctx.lineWidth = pass ? w : w * 3.5;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of half) {
          const sg = segment(r, [x1, y1], [x2, y2]);
          if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
        }
        ctx.stroke();
      }
    }
    // pools of lamp light on the asphalt (big blended areas, so top quality only)
    if (r.quality < 2) return;
    ctx.save();
    const cam = r.cam;
    for (const [x, y, col] of LAMPS) {
      const c = proj(r, x * 0.75, y, 0);
      if (c.behind) continue;
      const rad = 6.5 * c.s;
      const squash = Math.max(0.15, cam.z / Math.hypot(x * 0.75 - cam.x, y - cam.y, cam.z));
      ctx.drawImage(glowSprite(r, col, 0.3), c.x - rad, c.y - rad * squash, rad * 2, rad * 2 * squash);
    }
    ctx.restore();
  }

  function drawNet(ctx, r) {
    const X = COURT.POST_X;
    const pts = [];
    for (let i = 0; i <= 24; i++) { const x = -X + (2 * X * i) / 24; pts.push([x, 0, CT.netHeight(x)]); }
    fillPoly(ctx, r, [[-X, 0, 0], ...pts, [X, 0, 0]], 'rgba(255,63,180,0.09)');
    ctx.strokeStyle = 'rgba(255,120,210,0.3)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const x = -X + (2 * X * i) / 32;
      pathSeg(ctx, r, [x, 0, 0], [x, 0, CT.netHeight(x)]);
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 0; i < 24; i += 4) {
        const a = pts[i], b = pts[Math.min(24, i + 4)];
        pathSeg(ctx, r, [a[0], 0, (a[2] * k) / 5], [b[0], 0, (b[2] * k) / 5]);
      }
    }
    ctx.stroke();
    const mid = proj(r, 0, 0, 1);
    const w = Math.max(2, 0.07 * (mid.s || 20));
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? PAL.net : 'rgba(255,63,180,0.3)';
      ctx.lineWidth = pass ? w : w * 4;
      ctx.beginPath();
      for (let i = 0; i < 24; i++) {
        const sg = segment(r, pts[i], pts[i + 1]);
        if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
      }
      for (const x of [-X, X]) {
        const sg = segment(r, [x, 0, 0], [x, 0, CT.netHeight(x) + 0.05]);
        if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
      }
      ctx.stroke();
    }
  }

  // A parked car as a box, nose towards the court.
  function drawCar(ctx, r, car) {
    const palette = ['#2a2f45', '#3b1f3f', '#1d3340', '#40342a', '#262626', '#18203a'];
    const body = palette[Math.floor(hash(car.k * 3.7 + car.sx) * palette.length)];
    const len = 4.3, wid = 1.8;
    const x0 = car.x - len / 2, x1 = car.x + len / 2, y0 = car.y - wid / 2, y1 = car.y + wid / 2;
    const c = r.cam;
    if (groundEllipse(ctx, r, car.x, car.y, len / 2 + 0.5)) {
      ctx.fillStyle = hash(car.k * 5.1) > 0.5 ? 'rgba(255,63,180,0.16)' : 'rgba(37,217,255,0.14)';
      ctx.fill();
    }
    const h1 = 0.75, h2 = 1.4;
    const inner = car.sx > 0 ? x0 : x1;
    const outer = car.sx > 0 ? x1 : x0;
    // the two side faces and the end face that the camera can see
    const nearY = c.y < car.y ? y0 : y1;
    fillPoly(ctx, r, [[x0, nearY, 0.15], [x1, nearY, 0.15], [x1, nearY, h1], [x0, nearY, h1]], shade(body, -0.25));
    const endX = Math.abs(c.x - inner) < Math.abs(c.x - outer) ? inner : outer;
    fillPoly(ctx, r, [[endX, y0, 0.15], [endX, y1, 0.15], [endX, y1, h1], [endX, y0, h1]], shade(body, -0.1));
    fillPoly(ctx, r, [[x0, y0, h1], [x1, y0, h1], [x1, y1, h1], [x0, y1, h1]], body);
    const ci0 = car.sx > 0 ? x0 + 1.0 : x0 + 1.3, ci1 = car.sx > 0 ? x1 - 1.3 : x1 - 1.0;
    fillPoly(ctx, r, [[ci0, y0 + 0.15, h1], [ci1, y0 + 0.15, h1], [ci1 - 0.3, y0 + 0.3, h2], [ci0 + 0.3, y0 + 0.3, h2]], 'rgba(120,160,220,0.3)');
    fillPoly(ctx, r, [[ci0 + 0.3, y0 + 0.3, h2], [ci1 - 0.3, y0 + 0.3, h2], [ci1 - 0.3, y1 - 0.3, h2], [ci0 + 0.3, y1 - 0.3, h2]], shade(body, 0.12));
    ctx.save();
    ctx.fillStyle = 'rgba(255,246,208,0.9)';
    for (const yy of [y0 + 0.3, y1 - 0.3]) {
      const l = proj(r, inner, yy, 0.55);
      if (l.behind) continue;
      ctx.beginPath(); ctx.arc(l.x, l.y, Math.max(1, 0.1 * l.s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawLamp(ctx, r, lamp) {
    const [x, y, col] = lamp;
    const base = proj(r, x, y, 0);
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = Math.max(1.5, 0.14 * (base.s || 10));
    strokeSeg(ctx, r, [x, y, 0], [x, y, 7.5]);
    strokeSeg(ctx, r, [x, y, 7.5], [x * 0.75, y, 7.5]);
    const head = proj(r, x * 0.75, y, 7.5);
    if (head.behind) return;
    const gr = Math.max(10, 0.9 * head.s);
    ctx.drawImage(glowSprite(r, col, 0.7), head.x - gr, head.y + 1 - gr * 0.6, gr * 2, gr * 1.2);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(head.x, head.y + 1, Math.max(3, 0.35 * head.s), Math.max(1.5, 0.12 * head.s), 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---------------- players, ball, guides ----------------
  function drawShadow(ctx, r, x, y, rad, alpha) {
    if (groundEllipse(ctx, r, x, y, rad)) { ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fill(); }
  }

  function drawPlayer(ctx, r, g, p) {
    const pos = proj(r, p.x, p.y, 0);
    if (pos.behind) return;
    drawShadow(ctx, r, p.x, p.y, 0.55, 0.45);
    ctx.save();
    ctx.strokeStyle = p.ch.colors.glow;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    if (groundEllipse(ctx, r, p.x, p.y, 0.6)) ctx.stroke();
    ctx.restore();
    const pose = {
      t: p.anim,
      facing: p.side === 0 ? 'back' : 'front',
      swing: p.swing,
      wing: p.swingWing,
      running: p.moving,
      toss: g.phase === 'toss' && g.server === p.side && p.swing < 0,
    };
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.scale(pos.s * SPRITE_SCALE, pos.s * SPRITE_SCALE);
    CT.drawCharacter(ctx, p.ch.id, pose, r.quality === 2 ? Math.max(0.3, pos.s / 45) : 0);
    ctx.restore();
  }

  function drawBall(ctx, r, g) {
    const b = g.ball;
    if (!b.active) return;
    drawShadow(ctx, r, b.pos.x, b.pos.y, 0.09, 0.5);
    const p = proj(r, b.pos.x, b.pos.y, b.pos.z);
    if (p.behind) return;
    if (g.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < g.trail.length; i++) {
        const s = segment(r, [g.trail[i - 1].x, g.trail[i - 1].y, g.trail[i - 1].z], [g.trail[i].x, g.trail[i].y, g.trail[i].z]);
        if (!s) continue;
        ctx.strokeStyle = `rgba(228,255,74,${(i / g.trail.length) * 0.45})`;
        ctx.lineWidth = Math.max(1.5, 0.08 * s[1].s) * (i / g.trail.length);
        ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
      }
      ctx.restore();
    }
    const rad = Math.max(2.8, 0.075 * p.s);
    const gr = rad * 4;
    ctx.drawImage(glowSprite(r, PAL.ballGlow, 0.8), p.x - gr, p.y - gr, gr * 2, gr * 2);
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
  }

  function drawGuides(ctx, r, g, human, info) {
    const p = g.players[human];
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 0.3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(37,217,255,0.7)';
      ctx.lineWidth = 1.5;
      if (groundEllipse(ctx, r, p.tx, p.ty, 0.35)) ctx.stroke();
      ctx.restore();
    }
    const b = g.ball;
    if (info && g.predLand && b.bounces === 0 && b.lastHitter !== human) {
      ctx.save();
      ctx.strokeStyle = 'rgba(228,255,74,0.7)';
      ctx.lineWidth = 2;
      const L = g.predLand, k = 0.3;
      strokeSeg(ctx, r, [L.x - k, L.y - k], [L.x + k, L.y + k]);
      strokeSeg(ctx, r, [L.x + k, L.y - k], [L.x - k, L.y + k]);
      ctx.restore();
    }
    if (info && info.t < 0.9) {
      const c = proj(r, info.x, info.y, info.z);
      if (!c.behind) {
        const base = Math.max(9, 0.16 * c.s);
        const rad = base + info.t * 70;
        ctx.save();
        ctx.strokeStyle = info.reach ? PAL.guide : PAL.warn;
        ctx.globalAlpha = 0.35 + 0.65 * (1 - info.t / 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(c.x, c.y, base, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
    if (g.phase === 'toss' && g.server === human) {
      const peakZ = 1.5 + (5.3 * 5.3) / (2 * 9.81);
      const c = proj(r, p.x + p.fwd * 0.25, p.y + p.fwd * 0.35, peakZ);
      if (!c.behind) {
        const pulse = 1 + 0.12 * Math.sin(g.wall * 14);
        ctx.save();
        ctx.strokeStyle = PAL.guide; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(10, 0.2 * c.s) * pulse, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function render(r, g, human, info) {
    const now = performance.now();
    const dt = r.lastT ? Math.min(0.1, (now - r.lastT) / 1000) : 0;
    r.lastT = now;
    watchFrameRate(r, dt);
    updateCamera(r, g, human, dt);

    const ctx = r.ctx;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    drawSky(ctx, r);
    drawLot(ctx, r);
    drawCourt(ctx, r);

    for (const m of g.marks) {
      ctx.strokeStyle = `rgba(228,255,74,${(1 - m.age / 1.2) * 0.8})`;
      ctx.lineWidth = 1.5;
      if (groundEllipse(ctx, r, m.x, m.y, 0.12 + m.age * 0.5)) ctx.stroke();
    }
    drawGuides(ctx, r, g, human, info);

    // everything that stands up, sorted far to near along the view direction
    const c = r.cam;
    const depth = (x, y) => (x - c.x) * c.F.x + (y - c.y) * c.F.y;
    const items = [];
    for (const car of CARS) items.push({ d: depth(car.x, car.y), draw: () => drawCar(ctx, r, car) });
    for (const lamp of LAMPS) items.push({ d: depth(lamp[0], lamp[1]), draw: () => drawLamp(ctx, r, lamp) });
    for (const p of g.players) items.push({ d: depth(p.x, p.y), draw: () => drawPlayer(ctx, r, g, p) });
    items.push({ d: depth(0, 0), draw: () => drawNet(ctx, r) });
    if (g.ball.active) items.push({ d: depth(g.ball.pos.x, g.ball.pos.y) - 0.01, draw: () => drawBall(ctx, r, g) });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
  }

  CT.createRenderer = createRenderer;
  CT.resizeRenderer = resize;
  CT.renderGame = render;
  CT.unproject = unproject;
  CT.project = proj;
})();
