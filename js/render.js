// Renderer with two views: a raised chase camera behind the bottom player that
// follows them across the baseline and turns towards the ball, or a
// first-person view from the player's eyes. Plus the rooftop parking lot,
// court, net, players, ball and touch guides.
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
  const LOT_BACK = -21.5;      // the near edge, behind the bottom baseline

  // Chase-camera framing. Raised high enough that the ball stays visible over
  // your player's head, looking a little past the net.
  const CAM = { back: 7.2, height: 6.4, lookAhead: 13, follow: 0.75, ballPull: 0.4, ease: 3.2 };
  // First-person framing: eyes a little behind the player's centre so the
  // ball stays in view as it comes onto the racket. The head follows the
  // ball all the time, on a spring so it never snaps.
  const EYE = { back: 0.5, height: 1.65, lookAhead: 10, lookZ: 0.75, follow: 8,
    turn: 6, tossTurn: 9,        // spring stiffness of the head (higher = quicker)
    // serving, step the eye back so the toss isn't right in your face
    serveBack: 2.5,
    // while the ball can still come to you the head turns at most this far
    // off straight ahead, so swipes keep aiming down the court; once it's
    // past you the head is free to turn right round after it
    maxTurn: 0.6, pastFrom: -0.3, minPitch: -0.35, ballPitch: 0.7, maxSpin: 4 };

  function createRenderer(canvas) {
    return {
      canvas, ctx: canvas.getContext('2d', { alpha: false }),   // opaque: the sky covers every pixel, and the browser can skip blending the canvas
      view: 'chase',   // 'chase' or 'first'
      cam: { x: 0, y: -20, z: 6.4, lx: 0, ly: 0, lz: 0, f: 500, cx: 0, cy: 0, yaw: 0, pitch: 0, ready: false },
      W: 0, H: 0, dpr: 1, top: 92, bottom: 24, hudBottom: 0,
      sky: document.createElement('canvas'),
      glow: {},
      // phones with few cores or little memory start one level down
      quality: (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 3 ? 1 : 2,
      frames: [],
      lastT: 0,
      anim: [],
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
    if (r.view === 'first') { updateEye(r, g, human, dt); return; }
    const c = r.cam;
    const p = g.players[human];
    const b = g.ball;
    const fwd = p.fwd;
    // follow the player across the court, staying behind them
    const tx = p.x * CAM.follow, ty = p.y - fwd * CAM.back;
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

  // First person: the eyes ride with the player and the head follows the
  // ball. Yaw and pitch run on critically damped springs, so a change of
  // target (a hit, the toss, the ball going past) turns the head smoothly.
  function updateEye(r, g, human, dt) {
    const c = r.cam;
    const p = g.players[human];
    const b = g.ball;
    const fwd = p.fwd;
    const serving = (g.phase === 'preServe' || g.phase === 'toss') && g.server === human;
    const tossing = g.phase === 'toss' && g.server === human;
    const tx = p.x, ty = p.y - fwd * (serving ? EYE.serveBack : EYE.back);
    const kp = c.ready ? 1 - Math.exp(-dt * EYE.follow) : 1;
    c.x += (tx - c.x) * kp; c.y += (ty - c.y) * kp; c.z = EYE.height;

    const ahead = fwd > 0 ? 0 : Math.PI;   // yaw straight down the court
    const courtPitch = Math.atan2(EYE.lookZ - EYE.height, EYE.lookAhead);
    let yaw = ahead, pitch = courtPitch;
    if (b.active) {
      const dx = b.pos.x - c.x, dy = b.pos.y - c.y;
      const h = Math.max(2, Math.hypot(dx, dy));
      const ballPitch = Math.atan2(b.pos.z - c.z, h);
      yaw = Math.atan2(dx, dy);
      const past = !serving && b.lastHitter !== human && fwd * (b.pos.y - p.y) < EYE.pastFrom;
      if (tossing) pitch = ballPitch;
      else {
        // follow the ball's height only part way, so bounces don't bob the view
        pitch = courtPitch + (ballPitch - courtPitch) * EYE.ballPitch;
        if (!past) {
          yaw = ahead + CT.clamp(angleDiff(yaw, ahead), -EYE.maxTurn, EYE.maxTurn);
          pitch = Math.max(EYE.minPitch, pitch);
        }
      }
    }
    pitch = CT.clamp(pitch, -0.7, 0.9);
    if (!c.ready) { c.eyeYaw = yaw; c.eyePitch = pitch; c.yawV = 0; c.pitchV = 0; }
    const w = tossing ? EYE.tossTurn : EYE.turn;
    const step = Math.min(dt, 0.05);
    c.yawV += (w * w * angleDiff(yaw, c.eyeYaw) - 2 * w * c.yawV) * step;
    c.yawV = CT.clamp(c.yawV, -EYE.maxSpin, EYE.maxSpin);   // even a full turn stays easy to follow
    c.eyeYaw += c.yawV * step;
    c.pitchV += (w * w * (pitch - c.eyePitch) - 2 * w * c.pitchV) * step;
    c.eyePitch += c.pitchV * step;
    c.lx = c.x + Math.sin(c.eyeYaw) * Math.cos(c.eyePitch) * 10;
    c.ly = c.y + Math.cos(c.eyeYaw) * Math.cos(c.eyePitch) * 10;
    c.lz = c.z + Math.sin(c.eyePitch) * 10;
    c.ready = true;
    setBasis(c);
  }

  // a - b wrapped to (-PI, PI]: the short way round
  function angleDiff(a, b) {
    const d = a - b;
    return d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  }

  function setView(r, view) {
    r.view = view === 'first' ? 'first' : 'chase';
    r.cam.ready = false;   // cut straight to the new view
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

  // Drop a quality level when the phone can't keep up: frames average
  // slower than ~40 fps while drawing one takes most of a 60 fps frame
  // (`work`, seconds), or slower than ~22 fps whatever the reason. A phone
  // that only shows 30 frames a second but draws each one quickly (an
  // iPhone in Low Power Mode) keeps the full look.
  function watchFrameRate(r, dt, work) {
    if (!dt || dt >= 0.1 || r.quality === 0) return;   // skip pauses and tab switches
    r.frames.push([dt, work]);
    if (r.frames.length < 90) return;
    const avg = (i) => r.frames.reduce((a, f) => a + f[i], 0) / r.frames.length;
    const gap = avg(0), busy = avg(1);
    r.frames.length = 0;
    if ((gap > 0.025 && busy > 0.012) || gap > 0.045) { r.quality--; resize(r, ...r.args); }
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
    // (built tall enough for the first-person view, whose horizon sits lower)
    const hz = Math.min(r.H, Math.max(c.cy - c.f * (CAM.height / (CAM.back + CAM.lookAhead)), c.cy + c.f * 0.3));
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
    for (let i = 0; i < 800; i++) {
      const x = hash(i * 1.7) * sw;
      const y = hz - 12 - hash(i * 2.3 + 9) * Math.max(40, hz - 12);
      if (y < 0) continue;
      ctx.fillStyle = `rgba(230,235,255,${0.25 + hash(i * 5.1) * 0.7})`;
      ctx.fillRect(x, y, hash(i * 7.7) > 0.93 ? 1.6 : 0.9, hash(i * 7.7) > 0.93 ? 1.6 : 0.9);
    }
    const mr = Math.max(8, Math.min(W, r.H) * 0.025);
    const mx = W * 1.78;
    const my = hz - Math.max(60, r.H * 0.17);
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

  // ---------------- sky billboard ----------------
  // A neon sign over the skyline just left of the far player (whichever end
  // you play from), turned in towards the court, so it sits in the open sky
  // on a phone held upright.
  // It shows a photo and the player's tag, and flashes a word when something
  // happens (CT.showBillboard).
  const BOARD = { x: -6, y: 40, z: 5.5, w: 17, h: 5.2, turn: 0.4, tag: 'HHORNS' };   // turn: radians, far end to the right
  const BOARD_TEX = { w: 520, h: 168 };

  // Between words the sign shows a photo that slowly slides up and down.
  const BOARD_PHOTO = new Image();
  BOARD_PHOTO.src = 'img/billboard.jpg';

  // what the sign says now: the latest word until it expires, else the
  // photo (or just the tag until the photo has loaded). Online, a slow
  // ping takes the tag's place, and a match paused for lag says so over
  // everything else.
  function boardText(r, now) {
    const b = r.board, p = r.ping;
    const photo = BOARD_PHOTO.complete && BOARD_PHOTO.naturalWidth > 0;
    if (p && p.held) return { text: p.ms + ' MS', label: 'PAUSED', color: PAL.warn, from: p.from, photo };
    if (b && now < b.until) return b;
    // in zen mode the score stands in for the tag, with a slow ping under it
    const s = r.score;
    if (s) return { text: s.text, label: s.label, server: s.server, ping: p, color: PAL.ball, from: Math.max(s.from, p ? p.from : 0, b ? b.until : 0), photo };
    if (p) return { text: p.ms + ' MS', label: p.direct ? 'DIRECT PING' : 'RELAY PING', color: p.red ? PAL.warn : p.slow ? '#e4ff4a' : '#25d9ff', from: Math.max(p.from, b ? b.until : 0), photo };
    return { text: BOARD.tag, color: '#25d9ff', from: b ? b.until : 0, photo };
  }

  function boardTexture(r, text, color) {
    const t = r.boardTex || (r.boardTex = document.createElement('canvas'));
    // rebuilt once the display font has loaded
    const key = text + color + (document.fonts && document.fonts.check('900 20px Tektur') ? 1 : 0);
    if (t.key === key) return t;
    t.key = key;
    const W = BOARD_TEX.w, H = BOARD_TEX.h;
    t.width = W; t.height = H;
    const ctx = t.getContext('2d');
    ctx.fillStyle = 'rgba(8,6,22,0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ff3fb4'; ctx.lineWidth = 6;
    ctx.shadowColor = '#ff3fb4'; ctx.shadowBlur = 14;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    let size = 104;
    ctx.font = `900 ${size}px Tektur, sans-serif`;
    const fit = (W - 70) / ctx.measureText(text).width;
    if (fit < 1) { size = Math.floor(size * fit); ctx.font = `900 ${size}px Tektur, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color; ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.fillText(text, W / 2, H / 2 + 4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';   // hot core of the neon
    ctx.fillText(text, W / 2, H / 2 + 4);
    return t;
  }

  // the photo in a square on the left, sliding slowly between the top and
  // bottom of the picture, and the tag (or the ping, under its label)
  // beside it (in BOARD_TEX coordinates)
  function drawBoardPhoto(ctx, r, now, cur) {
    const W = BOARD_TEX.w, H = BOARD_TEX.h, m = 12, img = BOARD_PHOTO;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,6,22,0.88)';
    ctx.fillRect(0, 0, W, H);
    const side = H - 2 * m;
    const sw = img.naturalWidth, sh = Math.min(img.naturalHeight, sw);
    const t = 0.5 - 0.5 * Math.cos(now * 0.5);   // eases at each end
    ctx.drawImage(img, 0, t * (img.naturalHeight - sh), sw, sh, m, m, side, side);
    ctx.strokeStyle = '#ff3fb4'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.beginPath(); ctx.moveTo(m + side + 3, 8); ctx.lineTo(m + side + 3, H - 8); ctx.stroke();
    const cx = (m + side + W) / 2, tw = W - side - 60, pl = cur.ping;
    const y = pl ? H * 0.55 : cur.label ? H * 0.64 : H / 2 + 4;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (cur.label) {
      ctx.font = '700 32px Tektur, sans-serif';
      ctx.fillStyle = '#e8f6ff';
      ctx.fillText(cur.label, cx, pl ? H * 0.24 : H * 0.28, tw);
    }
    // the score's ping line, in the ping's colour
    if (pl) {
      ctx.font = '700 22px Tektur, sans-serif';
      ctx.fillStyle = pl.red ? PAL.warn : pl.slow ? '#e4ff4a' : '#25d9ff';
      ctx.fillText((pl.direct ? 'DIRECT PING ' : 'RELAY PING ') + pl.ms + ' MS', cx, H * 0.84, tw);
    }
    ctx.font = `900 ${pl ? 56 : cur.label ? 64 : 80}px Tektur, sans-serif`;
    // a ball by the score of whoever serves (yours on the left)
    if (cur.server === 0 || cur.server === 1) {
      const half = Math.min(tw, ctx.measureText(cur.text).width) / 2;
      ctx.beginPath();
      ctx.arc(cur.server === 0 ? cx - half - 16 : cx + half + 16, y - 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = PAL.ball; ctx.fill();
    }
    ctx.fillStyle = cur.color;
    if (r.quality) { ctx.shadowColor = cur.color; ctx.shadowBlur = 18; }
    ctx.fillText(cur.text, cx, y, tw);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(cur.text, cx, y, tw);
  }

  // A Hawk-Eye style close-up of a close call, looking down on the court the
  // way you face it: the lines around the bounce, the court the ball had to
  // land in lit up, and the ball's mark where it landed, skidding on the way
  // the ball was going and further the faster it was, zooming in as it comes
  // up. The call and the gap go beside it.
  // call: { m, x, y, vx, vy, box } (m as CT.lineMargin gives it).
  function courtLines() {
    const { SW, DW, HL, SL, LW } = COURT, BW = 2 * LW;
    return [   // [x0, x1, y0, y1], each line's outer edge on the court's edge
      [SW - LW, SW, -HL, HL], [-SW, -SW + LW, -HL, HL],
      [DW - LW, DW, -HL, HL], [-DW, -DW + LW, -HL, HL],
      [-DW, DW, HL - BW, HL], [-DW, DW, -HL, -HL + BW],
      [-SW, SW, SL - LW, SL], [-SW, SW, -SL, -SL + LW],
      [-LW / 2, LW / 2, -SL, SL],
    ];
  }
  // the area the ball had to land in, as [x0, x1, y0, y1]
  function callArea(box) {
    const { SW, HL, SL, LW } = COURT;
    if (!box) return [-SW, SW, -HL, HL];
    const x = box.sign > 0 ? [-LW / 2, SW] : [-SW, LW / 2];
    return [x[0], x[1], box.side === 0 ? -SL : 0, box.side === 0 ? 0 : SL];
  }
  // the nearest point on a line the ball could have landed out over
  function nearestLine(x, y, box) {
    const [x0, x1, y0, y1] = callArea(box);
    if (x < x0 || x > x1 || y < y0 || y > y1) return [CT.clamp(x, x0, x1), CT.clamp(y, y0, y1)];
    const edges = [[x - x0, x0, y], [x1 - x, x1, y]];
    // (the net isn't a line)
    if (!box || box.side === 1) edges.push([y1 - y, x, y1]);
    if (!box || box.side === 0) edges.push([y - y0, x, y0]);
    edges.sort((a, b) => a[0] - b[0]);
    return [edges[0][1], edges[0][2]];
  }

  function drawBoardCall(ctx, r, call, age) {
    const W = BOARD_TEX.w, H = BOARD_TEX.h, R = CT.PHYS.R, m = call.m, out = m > 0;
    const vw = 330, vx = 14, vy = 14, vh = H - 28;   // the close-up's window
    const f = r.human === 1 ? -1 : 1;   // seen from your end of the court
    const sp = Math.hypot(call.vx, call.vy);
    const skid = Math.min(0.14, sp * 0.004);   // how far the mark runs on past the contact
    const dx = sp > 0.1 ? call.vx / sp : 0, dy = sp > 0.1 ? call.vy / sp : 0;
    const [qx, qy] = nearestLine(call.x, call.y, call.box);
    const ox = (call.x + qx) / 2, oy = (call.y + qy) / 2;
    const hx = Math.abs(call.x - qx) / 2 + R + skid + 0.06, hy = Math.abs(call.y - qy) / 2 + R + skid + 0.06;
    const zoom = 1 - Math.pow(1 - Math.min(1, age / 0.6), 3);
    const k = Math.min(vw / (2 * hx), vh / (2 * hy), vh / 0.22) * (0.35 + 0.65 * zoom);   // px per metre
    const PX = (x) => vx + vw / 2 + f * (x - ox) * k, PY = (y) => vy + vh / 2 - f * (y - oy) * k;
    const rect = (q) => {
      const a = PX(q[0]), b = PX(q[1]), c = PY(q[2]), d = PY(q[3]);
      ctx.fillRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
    };
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,6,22,0.88)';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
    ctx.fillStyle = '#08152b'; ctx.fillRect(vx, vy, vw, vh);   // out
    ctx.fillStyle = '#17487f'; rect(callArea(call.box));          // in
    ctx.fillStyle = PAL.line;
    if (r.quality) { ctx.shadowColor = PAL.line; ctx.shadowBlur = 14; }
    for (const q of courtLines()) rect(q);
    ctx.shadowBlur = 0;
    // the mark: an oval from the back of the contact patch, stretched on
    // along the skid
    const mx = PX(call.x + dx * skid / 2), my = PY(call.y + dy * skid / 2);
    const ang = Math.atan2(-f * dy, f * dx);
    ctx.globalAlpha = Math.min(1, age / 0.35);
    ctx.beginPath();
    ctx.ellipse(mx, my, (R + skid / 2) * k, R * k, ang, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(228,255,74,0.55)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = PAL.ball;
    if (r.quality) { ctx.shadowColor = PAL.ballGlow; ctx.shadowBlur = 12; }
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#ff3fb4'; ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, W - 16, H - 16);
    ctx.beginPath(); ctx.moveTo(vx + vw + 3, 8); ctx.lineTo(vx + vw + 3, H - 8); ctx.stroke();
    // the call, after the mark has landed
    if (age < 0.35) return;
    const col = out ? PAL.warn : '#3fff9a', cx = (vx + vw + W) / 2, tw = W - vx - vw - 30;
    const mm = Math.max(1, Math.round(Math.abs(m) * 1000));
    const dist = mm < 10 ? mm + ' MM' : Math.round(mm / 10) + ' CM';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 60px Tektur, sans-serif';
    ctx.fillStyle = col;
    if (r.quality) { ctx.shadowColor = col; ctx.shadowBlur = 18; }
    ctx.fillText(out ? 'OUT' : 'IN', cx, H * 0.36, tw);
    ctx.shadowBlur = 0;
    ctx.font = '700 36px Tektur, sans-serif';
    ctx.fillStyle = '#e8f6ff';
    ctx.fillText(dist, cx, H * 0.7, tw);
  }

  function drawBillboard(ctx, r) {
    const B = BOARD, z1 = B.z + B.h;
    // an online guest plays from the other end, so the sign stands over
    // their far court instead (turned half round, so it still reads left to right)
    const f = r.human === 1 ? -1 : 1;
    const ca = f * Math.cos(B.turn), sa = f * Math.sin(B.turn);
    // a point on the sign, u across it from 0 (left) to 1 (right)
    const at = (u, z) => proj(r, f * B.x + (u - 0.5) * B.w * ca, f * B.y + (u - 0.5) * B.w * sa, z);
    const tl = at(0, z1), tr = at(1, z1);
    if (tl.behind || tr.behind) return;
    if (Math.max(tl.x, tr.x) < 0 || Math.min(tl.x, tr.x) > r.W) return;
    const now = performance.now() / 1000;
    const cur = boardText(r, now);
    // a new word flickers on, then hums
    const age = now - cur.from;
    const on = age < 0.35 ? (Math.floor(age * 24) % 2 ? 0.25 : 1) : 0.88 + 0.12 * Math.sin(now * 3);
    // the pylon it stands on, down into the skyline
    const pb = at(0.5, 0), pt = at(0.5, B.z);
    ctx.strokeStyle = '#1c1b2a'; ctx.lineWidth = Math.max(2, (pt.s || 0) * 0.5);
    ctx.beginPath(); ctx.moveTo(pb.x, pb.y); ctx.lineTo(pt.x, pt.y); ctx.stroke();
    let src;
    if (cur.photo || cur.call !== undefined) {
      src = r.boardPhotoTex || (r.boardPhotoTex = document.createElement('canvas'));
      if (src.width !== BOARD_TEX.w) { src.width = BOARD_TEX.w; src.height = BOARD_TEX.h; }
      if (cur.photo) drawBoardPhoto(src.getContext('2d'), r, now, cur);
      else drawBoardCall(src.getContext('2d'), r, cur.call, age);
    } else src = boardTexture(r, cur.text, cur.color);
    const d = r.dpr, W = BOARD_TEX.w, H = BOARD_TEX.h, N = 10, sw = W / N;
    ctx.save();
    ctx.globalAlpha = on;
    ctx.imageSmoothingQuality = 'high';
    // The sign is turned, so its near end looks taller than its far end.
    // Drawn as thin vertical strips, each mapped from its own corners.
    for (let i = 0; i < N; i++) {
      const a0 = at(i / N, z1), a1 = at((i + 1) / N, z1), b0 = at(i / N, B.z);
      ctx.setTransform(d * (a1.x - a0.x) / sw, d * (a1.y - a0.y) / sw, d * (b0.x - a0.x) / H, d * (b0.y - a0.y) / H, d * a0.x, d * a0.y);
      ctx.drawImage(src, i * sw, 0, Math.min(sw + 1, W - i * sw), H, 0, 0, Math.min(sw + 1, W - i * sw), H);
    }
    ctx.restore();
  }

  // Flash a word on the billboard for `secs` seconds.
  function showBillboard(r, text, color, secs) {
    r.board = { text, color: color || '#e4ff4a', from: performance.now() / 1000, until: performance.now() / 1000 + (secs || 2.5) };
  }

  // Zen mode's score for the billboard: { text, label, server } (server 0 is
  // you, 1 the other player, -1 nobody), or null to go back to the tag.
  function showScore(r, s) {
    if (!s) { r.score = null; return; }
    const was = r.score;
    if (was && was.text === s.text && was.label === s.label && was.server === s.server) return;
    // flickers on when the points change
    r.score = { ...s, from: was && was.text === s.text ? was.from : performance.now() / 1000 };
  }

  // Zen mode hides the timing rings and the landing X.
  function setZen(r, on) { r.zen = on; }

  // Online lag for the billboard: { ms, red, held }, or null to hide it.
  function showPing(r, p) {
    const was = r.ping;
    if (!p) { r.ping = null; return; }
    // flickers on when it first shows, turns red, or pauses the match
    const from = was && was.red === p.red && was.held === p.held && was.direct === p.direct ? was.from : performance.now() / 1000;
    r.ping = { ...p, from };
  }

  // Put a close line call up on the billboard for `secs` seconds (the
  // engine's lineCall event).
  function showLineCall(r, call, secs) {
    const now = performance.now() / 1000;
    r.board = { call, from: now, until: now + (secs || 3) };
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
    // two rows parked end to end behind the near baseline, out to the roof edge
    for (const y of [-17.6, -20.1]) {
      for (const x of [-5, 0, 5]) {
        const k = 40 + Math.round(x + y * 3);
        if (hash(k * 2.9) < 0.2) continue;
        cars.push({ x: x + (hash(k * 1.3) - 0.5) * 0.4, y, sx: x < 0 ? -1 : 1, k });
      }
    }
    return cars;
  })();

  function drawLot(ctx, r) {
    // asphalt deck
    fillPoly(ctx, r, [[-45, LOT_EDGE], [45, LOT_EDGE], [45, LOT_BACK], [-45, LOT_BACK]], '#15161e');
    // roof edges: a low parapet with strip lights at both ends
    for (const y of [LOT_EDGE, LOT_BACK]) {
      fillPoly(ctx, r, [[-45, y, 1], [45, y, 1], [45, y, 0], [-45, y, 0]], '#1c1b2a');
      ctx.save();
      ctx.strokeStyle = 'rgba(37,217,255,0.85)'; ctx.lineWidth = 1.5;
      strokeSeg(ctx, r, [-45, y, 1], [45, y, 1]);
      ctx.restore();
    }
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
    for (const sx of [-1, 1]) pathSeg(ctx, r, [sx * 7.2, LOT_BACK], [sx * 7.2, LOT_EDGE]);
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

  // Animation-only state per player (visual, never fed back to the game):
  // smoothed running speed, sideways lean in screen space, stride phase that
  // advances with distance run, and a backswing as the ball comes in.
  function playerAnim(r, g, p, pos) {
    const a = r.anim[p.side] || (r.anim[p.side] = { t: p.anim, spd: 0, lean: 0, stride: p.side * 1.7, prep: 0, prepWing: 'fh' });
    let dt = p.anim - a.t;
    a.t = p.anim;
    if (!(dt > 0 && dt < 0.2)) dt = 0;
    const v = p.moving ? p.v : 0;
    let side = 0;
    if (v > 0) {
      const q = proj(r, p.x + p.dirX, p.y + p.dirY, 0);
      if (!q.behind) side = (q.x - pos.x) / pos.s;   // metres across the screen per metre run
    }
    const target = Math.min(1, v / p.ch.speed);
    const ease = 1 - Math.exp(-dt * 10);
    a.spd += (target - a.spd) * ease;
    a.lean += (Math.max(-1, Math.min(1, side * target)) - a.lean) * ease;
    a.stride += v * dt * 2.3;

    let prep = 0;
    const b = g.ball;
    if (g.phase === 'rally' && b.active && b.inFlight && b.lastHitter !== p.side && p.swing < 0) {
      const closing = -p.fwd * b.vel.y;
      const dist = p.fwd * (b.pos.y - p.y);
      if (closing > 1 && dist > -0.5) prep = Math.max(0, Math.min(1, 1 - (dist / closing - 0.08) / 0.5));
      if (prep > 0 && a.prep === 0) a.prepWing = (b.pos.x - p.x) * p.fwd >= -0.05 ? 'fh' : 'bh';
    }
    a.prep = prep;
    return a;
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
    const a = playerAnim(r, g, p, pos);
    const pose = {
      t: p.anim,
      facing: p.side === r.human ? 'back' : 'front',
      swing: p.swing,
      wing: p.swingWing,
      running: p.moving,
      toss: g.phase === 'toss' && g.server === p.side && p.swing < 0,
      speed: a.spd, lean: a.lean, stride: a.stride,
      prep: a.prep, prepWing: a.prepWing,
      lod: r.quality,
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
    const rad = Math.min(r.H * 0.04, Math.max(2.8, 0.075 * p.s));   // capped when it flies past your face
    const gr = rad * 4;
    ctx.drawImage(glowSprite(r, PAL.ballGlow, 0.8), p.x - gr, p.y - gr, gr * 2, gr * 2);
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
  }

  function ringOnBall(r, b) {
    const c = r.cam;
    const v = toCam(c, b.pos.x, b.pos.y, b.pos.z);
    // a ball level with or behind the eye is pinned to the side it's on
    const p = v.z > NEAR ? fromCamToScreen(c, v) : { x: c.cx + Math.sign(v.x || 1) * 1e4, y: c.cy };
    const m = 40;
    return { x: CT.clamp(p.x, m, r.W - m), y: CT.clamp(p.y, r.top + m, r.H - r.bottom - m) };
  }

  // The ring that closes as the ball reaches you: swipe as it closes.
  // In first person the contact point is beside your head, off-screen, so
  // the ring rides on the ball instead, kept inside the screen edges, and is
  // drawn over the scenery.
  function drawTimingRing(ctx, r, g, info) {
    if (!info || info.t >= 0.9) return;
    const first = r.view === 'first';
    const c = first ? ringOnBall(r, g.ball) : proj(r, info.x, info.y, info.z);
    if (c.behind) return;
    const base = first ? 16 : Math.max(9, 0.16 * c.s);
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

  function drawGuides(ctx, r, g, human, info, land) {
    const p = g.players[human];
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 0.3) {
      ctx.save();
      ctx.strokeStyle = 'rgba(37,217,255,0.7)';
      ctx.lineWidth = 1.5;
      if (groundEllipse(ctx, r, p.tx, p.ty, 0.35)) ctx.stroke();
      ctx.restore();
    }
    if (r.zen) return;
    if (land) {
      ctx.save();
      ctx.strokeStyle = 'rgba(228,255,74,0.7)';
      ctx.lineWidth = 2;
      const L = land, k = 0.3;
      strokeSeg(ctx, r, [L.x - k, L.y - k], [L.x + k, L.y + k]);
      strokeSeg(ctx, r, [L.x + k, L.y - k], [L.x - k, L.y + k]);
      ctx.restore();
    }
    if (r.view !== 'first') drawTimingRing(ctx, r, g, info);
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

  // First person: your racket in the corner of the screen. It sits ready on
  // the forehand side, drops back as the ball comes in, and sweeps across
  // the bottom of the view on a groundstroke or down from above on a serve.
  function drawRacketView(ctx, r, g, p) {
    const a = playerAnim(r, g, p, { x: r.W / 2, s: 1 });
    const u = Math.min(r.W, r.H - r.top);
    const W = r.W, base = r.H;
    let side, hx, hy, ang;   // hand position, racket angle (0 = pointing up)
    if (p.swing >= 0) {
      const e = 1 - Math.pow(1 - Math.min(1, p.swing), 3);
      if (p.swingWing === 'serve' || p.swingWing === 'oh') {
        side = 1;
        hx = W * (0.78 - 0.4 * e); hy = base - u * (0.55 - 0.5 * e);
        ang = 0.2 - e * 2.6;
      } else {
        side = p.swingWing === 'bh' ? -1 : 1;
        const t = 1 - 2 * e;   // +1 out wide on the stroke side, -1 across the body
        hx = W / 2 + side * W * 0.42 * t; hy = base - u * (0.1 + 0.1 * (1 - t * t));
        ang = side * (0.9 * t - 0.2);
      }
    } else {
      const prep = a.prep;
      side = prep > 0 && a.prepWing === 'bh' ? -1 : 1;
      const bob = Math.sin(p.anim * 7) * u * 0.006 * (1 + a.spd * 3);
      hx = W / 2 + side * W * (0.3 + 0.15 * prep); hy = base - u * (0.12 - 0.04 * prep) + bob;
      ang = side * (0.35 + 0.9 * prep);
    }
    const len = u * 0.2, rx = u * 0.085, ry = u * 0.11;
    const col = p.ch.colors.glow;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1c1b2a'; ctx.lineWidth = u * 0.032;   // grip
    ctx.beginPath(); ctx.moveTo(0, u * 0.06); ctx.lineTo(0, -len + ry * 0.2); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = u * 0.008;
    ctx.beginPath(); ctx.moveTo(0, -len * 0.45); ctx.lineTo(-rx * 0.5, -len - ry * 0.3); ctx.moveTo(0, -len * 0.45); ctx.lineTo(rx * 0.5, -len - ry * 0.3); ctx.stroke();
    ctx.translate(0, -len - ry);
    ctx.strokeStyle = hexA(PAL.line, 0.35); ctx.lineWidth = 1;   // strings
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.save(); ctx.clip();
    for (let i = -4; i <= 4; i++) { ctx.moveTo(i * rx / 5, -ry); ctx.lineTo(i * rx / 5, ry); ctx.moveTo(-rx, i * ry / 5); ctx.lineTo(rx, i * ry / 5); }
    ctx.stroke();
    ctx.restore();
    ctx.shadowColor = col; ctx.shadowBlur = r.quality ? u * 0.03 : 0;
    ctx.strokeStyle = col; ctx.lineWidth = u * 0.014;   // frame
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function render(r, g, human, info, land) {
    const now = performance.now();
    const dt = r.lastT ? Math.min(0.1, (now - r.lastT) / 1000) : 0;
    r.lastT = now;
    r.human = human;
    updateCamera(r, g, human, dt);

    const ctx = r.ctx;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    drawSky(ctx, r);
    drawBillboard(ctx, r);
    drawLot(ctx, r);
    drawCourt(ctx, r);

    for (const m of g.marks) {
      ctx.strokeStyle = `rgba(228,255,74,${(1 - m.age / 1.2) * 0.8})`;
      ctx.lineWidth = 1.5;
      if (groundEllipse(ctx, r, m.x, m.y, 0.12 + m.age * 0.5)) ctx.stroke();
    }
    drawGuides(ctx, r, g, human, info, land);

    // everything that stands up, sorted far to near along the view direction
    const c = r.cam;
    const depth = (x, y) => (x - c.x) * c.F.x + (y - c.y) * c.F.y;
    const items = [];
    for (const car of CARS) items.push({ d: depth(car.x, car.y), draw: () => drawCar(ctx, r, car) });
    for (const lamp of LAMPS) items.push({ d: depth(lamp[0], lamp[1]), draw: () => drawLamp(ctx, r, lamp) });
    for (const p of g.players) {
      if (r.view === 'first' && p.side === human) continue;   // you are the camera
      items.push({ d: depth(p.x, p.y), draw: () => drawPlayer(ctx, r, g, p) });
    }
    items.push({ d: depth(0, 0), draw: () => drawNet(ctx, r) });
    if (g.ball.active) items.push({ d: depth(g.ball.pos.x, g.ball.pos.y) - 0.01, draw: () => drawBall(ctx, r, g) });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
    if (r.view === 'first') { drawRacketView(ctx, r, g, g.players[human]); if (!r.zen) drawTimingRing(ctx, r, g, info); }
    watchFrameRate(r, dt, (performance.now() - now) / 1000);
  }

  CT.createRenderer = createRenderer;
  CT.resizeRenderer = resize;
  CT.setView = setView;
  CT.renderGame = render;
  CT.showBillboard = showBillboard;
  CT.showLineCall = showLineCall;
  CT.showPing = showPing;
  CT.showScore = showScore;
  CT.setZen = setZen;
  CT.unproject = unproject;
  CT.project = proj;
})();
