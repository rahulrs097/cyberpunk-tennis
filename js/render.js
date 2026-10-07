// Perspective renderer: neon arena, court, net, players, ball and touch guides.
(function () {
  const CT = (window.CT = window.CT || {});
  const { COURT } = CT;

  const PAL = {
    sky0: '#05040c', sky1: '#140b2e', ground: '#0a0918', apron: '#100d26',
    court: '#13213f', courtIn: '#162a52',
    line: '#7af6ff', lineGlow: '#25d9ff',
    net: '#ff3fb4', ball: '#e4ff4a', ballGlow: '#c6ff2e',
    guide: '#25d9ff', warn: '#ff3f6c', text: '#eae6ff',
  };

  const SPRITE_SCALE = 1.3;   // players drawn a little larger than life so they read on a phone

  function createRenderer(canvas) {
    const r = {
      canvas, ctx: canvas.getContext('2d'),
      cam: { y: -40, h: 45, f: 400, cx: 0, hy: 0 },
      W: 0, H: 0, dpr: 1, top: 92, bottom: 24,
      bgLayer: document.createElement('canvas'),
      netLayer: document.createElement('canvas'),
    };
    return r;
  }

  function proj(r, x, y, z) {
    const c = r.cam;
    const d = y - c.y;
    const s = c.f / d;
    return { x: c.cx + x * s, y: c.hy + (c.h - z) * s, s };
  }

  // Screen point to a spot on the ground.
  function unproject(r, sx, sy) {
    const c = r.cam;
    const dy = sy - c.hy;
    if (dy <= 1) return null;
    const d = (c.h * c.f) / dy;
    return { x: ((sx - c.cx) * d) / c.f, y: c.y + d };
  }

  function resize(r, W, H, top, bottom, hudBottom) {
    r.hudBottom = hudBottom || 0;
    r.dpr = Math.min(2, window.devicePixelRatio || 1);
    r.W = W; r.H = H; r.top = top; r.bottom = bottom;
    for (const cv of [r.canvas, r.bgLayer, r.netLayer]) {
      cv.width = Math.round(W * r.dpr); cv.height = Math.round(H * r.dpr);
    }
    r.canvas.style.width = W + 'px'; r.canvas.style.height = H + 'px';
    // fit the playing area to the screen
    const c = r.cam;
    const availH = H - top - bottom;
    // Raise or lower the camera so the court fills tall phones and wide screens alike.
    let best = null;
    for (let h = 22; h <= 220; h += 1) {
      c.h = h; c.f = 1; c.hy = 0; c.cx = 0;
      const topPt = proj(r, 0, 15.5, 3.2).y;
      const botPt = proj(r, 0, -14.6, 0).y;
      const nearW = 2 * proj(r, 6.2, -14, 0).x;
      const fw = (W - 8) / nearW, fh = availH / (botPt - topPt);
      // best fit is where width and height run out together
      const miss = Math.abs(Math.log(fw / fh));
      if (!best || miss < best.miss) best = { h, f: Math.min(fw, fh), miss, topPt, botPt };
    }
    c.h = best.h; c.f = 1; c.hy = 0;
    const topPt = best.topPt, botPt = best.botPt;
    c.f = best.f;
    c.cx = W / 2;
    c.hy = top - topPt * c.f + Math.max(0, availH - (botPt - topPt) * c.f) * 0.85;   // spare room goes to the skyline
    drawBackground(r);
    drawNetLayer(r);
  }

  function poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  // deterministic hash for scenery (not gameplay)
  function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

  const LOT_EDGE = 17.5;   // far edge of the rooftop lot; open sky beyond it

  function drawBackground(r) {
    const ctx = r.bgLayer.getContext('2d');
    const W = r.W, H = r.H;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    const horizon = proj(r, 0, LOT_EDGE, 0).y;

    // night sky with a city glow at the horizon
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#02030a');
    sky.addColorStop(0.55, '#0a0d26');
    sky.addColorStop(0.88, '#2b1645');
    sky.addColorStop(1, '#4a1d4f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < 160; i++) {
      const x = hash(i * 1.7) * W, y = hash(i * 2.3 + 9) * horizon * 0.85;
      const a = 0.25 + hash(i * 5.1) * 0.75;
      ctx.fillStyle = `rgba(230,235,255,${a * (1 - y / horizon)})`;
      const sz = hash(i * 7.7) > 0.93 ? 1.6 : 0.9;
      ctx.fillRect(x, y, sz, sz);
    }
    // moon
    const mr = Math.max(8, Math.min(W, H) * 0.025);
    const mx = W * 0.8, my = Math.max(mr + 4, ((r.hudBottom || 0) + horizon) / 2 - mr * 0.6);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(210,220,255,0.28)');
    halo.addColorStop(1, 'rgba(210,220,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(mx, my, mr * 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8ecff';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(160,170,210,0.35)';
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.25, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.18, 0, Math.PI * 2); ctx.fill();

    // distant skyline below the roof edge
    const skyH = Math.max(40, horizon);
    for (let layer = 0; layer < 2; layer++) {
      const n = 22;
      for (let i = 0; i < n; i++) {
        const bw = (W / n) * (1.1 + hash(i + layer * 50) * 1.3);
        const bx = (i / n) * W - bw * 0.3 + layer * 11;
        const bh = skyH * (layer ? 0.12 + hash(i * 3 + 1) * 0.2 : 0.18 + hash(i * 3) * 0.32);
        const top = horizon - bh;
        ctx.fillStyle = layer ? '#120c26' : '#0b0819';
        ctx.fillRect(bx, top, bw, bh + 2);
        for (let wy = top + 5; wy < horizon - 3; wy += 6) {
          for (let wx = bx + 3; wx < bx + bw - 3; wx += 5) {
            const h = hash(wx * 0.37 + wy * 1.91 + layer);
            if (h > 0.87) {
              ctx.fillStyle = h > 0.975 ? 'rgba(255,63,180,0.8)' : h > 0.94 ? 'rgba(37,217,255,0.6)' : 'rgba(255,200,120,0.4)';
              ctx.fillRect(wx, wy, 1.6, 2.4);
            }
          }
        }
        if (!layer && hash(i * 9.3) > 0.7) {         // red aircraft light on the tall ones
          ctx.fillStyle = 'rgba(255,60,60,0.9)';
          ctx.fillRect(bx + bw / 2 - 1, top - 4, 2, 2);
        }
      }
    }

    // the rooftop deck: asphalt from here to the bottom of the screen
    ctx.fillStyle = '#15161e';
    poly(ctx, [proj(r, -60, LOT_EDGE, 0), proj(r, 60, LOT_EDGE, 0), proj(r, 60, r.cam.y + 1, 0), proj(r, -60, r.cam.y + 1, 0)]);
    ctx.fill();
    // grit and oil stains (placed in world space so they sit in perspective)
    for (let i = 0; i < 2600; i++) {
      const x = (hash(i * 3.1) - 0.5) * 40, y = -20 + hash(i * 4.7) * (LOT_EDGE + 20);
      const p = proj(r, x, y, 0);
      if (p.x < 0 || p.x > W) continue;
      ctx.fillStyle = hash(i * 8.3) > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.25)';
      const sz = Math.max(0.6, 0.05 * p.s);
      ctx.fillRect(p.x, p.y, sz, sz);
    }
    for (let i = 0; i < 14; i++) {
      const x = (hash(i * 13.3) - 0.5) * 22, y = -16 + hash(i * 17.9) * 32;
      const p = proj(r, x, y, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.7 * p.s, 0.3 * p.s, 0, 0, Math.PI * 2); ctx.fill();
    }

    // parking bays down both sides
    const STALL_IN = 8.0, STALL_OUT = 13.2, STALL_W = 2.6;
    ctx.strokeStyle = 'rgba(232,230,214,0.5)';
    for (const sx of [-1, 1]) {
      for (let y = -19.5; y <= LOT_EDGE - 0.5; y += STALL_W) {
        const a = proj(r, sx * STALL_IN, y, 0), b = proj(r, sx * STALL_OUT, y, 0);
        ctx.lineWidth = Math.max(0.8, 0.1 * a.s);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      // yellow lane line between the bays and the court
      ctx.save();
      ctx.strokeStyle = 'rgba(255,200,40,0.45)';
      ctx.setLineDash([10, 10]);
      const a = proj(r, sx * 7.2, -21, 0), b = proj(r, sx * 7.2, LOT_EDGE, 0);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
    }
    // painted level marker behind the far baseline
    ctx.save();
    const pm = proj(r, 0, 15.6, 0);
    ctx.translate(pm.x, pm.y);
    ctx.scale(1, 0.38);
    ctx.font = `700 ${Math.max(12, 1.5 * pm.s)}px Tektur, "Chakra Petch", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,230,214,0.18)';
    ctx.fillText('ROOF P9', 0, 0);
    ctx.restore();

    // the court, painted onto the asphalt
    const D = COURT.DW, L = COURT.HL, S = COURT.SW;
    ctx.fillStyle = 'rgba(24,52,96,0.62)';
    poly(ctx, [proj(r, -D - 1.2, -L - 2.5, 0), proj(r, D + 1.2, -L - 2.5, 0), proj(r, D + 1.2, L + 2.5, 0), proj(r, -D - 1.2, L + 2.5, 0)]);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,72,128,0.55)';
    poly(ctx, [proj(r, -S, -L, 0), proj(r, S, -L, 0), proj(r, S, L, 0), proj(r, -S, L, 0)]);
    ctx.fill();

    const lines = [
      [-D, -L, D, -L], [-D, L, D, L],
      [-D, -L, -D, L], [D, -L, D, L],
      [-S, -L, -S, L], [S, -L, S, L],
      [-S, -COURT.SL, S, -COURT.SL], [-S, COURT.SL, S, COURT.SL],
      [0, -COURT.SL, 0, COURT.SL],
      [0, -L, 0, -L + 0.3], [0, L, 0, L - 0.3],
    ];
    for (const pass of [0, 1]) {
      ctx.save();
      if (pass === 0) { ctx.shadowColor = PAL.lineGlow; ctx.shadowBlur = 12; ctx.strokeStyle = 'rgba(37,217,255,0.55)'; }
      else ctx.strokeStyle = PAL.line;
      for (const [x1, y1, x2, y2] of lines) {
        const a = proj(r, x1, y1, 0), b = proj(r, x2, y2, 0);
        ctx.lineWidth = Math.max(1, 0.06 * (a.s + b.s) / 2) * (pass === 0 ? 2 : 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }

    // lamp posts and the pools of light under them
    const lamps = [[-7.7, 16.5, '#ffb04a'], [7.7, 16.5, '#ffb04a'], [-7.7, 3, '#ff4fc0'], [7.7, -3, '#3fdcff'], [-7.7, -12, '#ffb04a'], [7.7, -15, '#ffb04a']];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const [x, y, col] of lamps) {
      const c = proj(r, x * 0.75, y, 0);
      const rad = 6.5 * c.s;
      const gr = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
      gr.addColorStop(0, hexA(col, 0.28));
      gr.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = gr;
      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(1, 0.42); ctx.translate(-c.x, -c.y);
      ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // parked cars, far to near
    const cars = [];
    for (const sx of [-1, 1]) {
      let k = 0;
      for (let y = -19.5; y < LOT_EDGE - STALL_W; y += STALL_W, k++) {
        if (hash(k * 7.3 + sx * 3.3) < 0.38) continue;
        cars.push({ x: sx * (STALL_IN + 0.5 + 2.15 + hash(k * 1.9) * 0.3), y: y + STALL_W / 2, sx, k });
      }
    }
    cars.sort((a, b) => b.y - a.y);
    for (const car of cars) drawCar(ctx, r, car);

    // lamp posts drawn last so they stand over the cars
    lamps.slice().sort((a, b) => b[1] - a[1]).forEach(([x, y, col]) => {
      const base = proj(r, x, y, 0), top = proj(r, x, y, 7.5), arm = proj(r, x * 0.75, y, 7.5);
      ctx.strokeStyle = '#2a2a3a';
      ctx.lineWidth = Math.max(1.5, 0.14 * base.s);
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.lineTo(arm.x, arm.y); ctx.stroke();
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = 18;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(arm.x, arm.y + 1, Math.max(3, 0.35 * arm.s), Math.max(1.5, 0.12 * arm.s), 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    // roof edge: a low parapet with strip lights, open sky beyond
    const e0 = proj(r, -60, LOT_EDGE, 0), e1 = proj(r, 60, LOT_EDGE, 0);
    const t0 = proj(r, -60, LOT_EDGE, 1.0), t1 = proj(r, 60, LOT_EDGE, 1.0);
    ctx.fillStyle = '#1c1b2a';
    poly(ctx, [t0, t1, e1, e0]); ctx.fill();
    ctx.save();
    ctx.shadowColor = PAL.guide; ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(37,217,255,0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
    ctx.restore();
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // A parked car as a projected box, nose towards the court.
  function drawCar(ctx, r, car) {
    const palette = ['#2a2f45', '#3b1f3f', '#1d3340', '#40342a', '#262626', '#18203a'];
    const body = palette[Math.floor(hash(car.k * 3.7 + car.sx) * palette.length)];
    const len = 4.3, wid = 1.8;
    const x0 = car.x - len / 2, x1 = car.x + len / 2, y0 = car.y - wid / 2, y1 = car.y + wid / 2;
    const P = (x, y, z) => proj(r, x, y, z);
    // underglow
    const ug = P(car.x, car.y, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = hash(car.k * 5.1) > 0.5 ? 'rgba(255,63,180,0.25)' : 'rgba(37,217,255,0.22)';
    ctx.beginPath(); ctx.ellipse(ug.x, ug.y, (len / 2 + 0.6) * ug.s, (wid / 2 + 0.5) * ug.s * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const h1 = 0.75, h2 = 1.4;
    const inner = car.sx > 0 ? x0 : x1;        // end facing the court
    const ci0 = car.sx > 0 ? x0 + 1.0 : x0 + 1.3, ci1 = car.sx > 0 ? x1 - 1.3 : x1 - 1.0;
    // near face (towards the camera)
    ctx.fillStyle = shade(body, -0.25);
    poly(ctx, [P(x0, y0, 0.15), P(x1, y0, 0.15), P(x1, y0, h1), P(x0, y0, h1)]); ctx.fill();
    // court-facing end
    ctx.fillStyle = shade(body, -0.1);
    poly(ctx, [P(inner, y0, 0.15), P(inner, y1, 0.15), P(inner, y1, h1), P(inner, y0, h1)]); ctx.fill();
    // roof of the body
    ctx.fillStyle = body;
    poly(ctx, [P(x0, y0, h1), P(x1, y0, h1), P(x1, y1, h1), P(x0, y1, h1)]); ctx.fill();
    // cabin
    ctx.fillStyle = 'rgba(120,160,220,0.35)';
    poly(ctx, [P(ci0, y0 + 0.1, h1), P(ci1, y0 + 0.1, h1), P(ci1 - 0.3, y0 + 0.25, h2), P(ci0 + 0.3, y0 + 0.25, h2)]); ctx.fill();
    ctx.fillStyle = shade(body, 0.12);
    poly(ctx, [P(ci0 + 0.3, y0 + 0.25, h2), P(ci1 - 0.3, y0 + 0.25, h2), P(ci1 - 0.3, y1 - 0.25, h2), P(ci0 + 0.3, y1 - 0.25, h2)]); ctx.fill();
    // headlights on the court-facing end
    ctx.save();
    ctx.shadowColor = '#fff6d0'; ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,246,208,0.85)';
    for (const yy of [y0 + 0.3, y1 - 0.3]) {
      const l = P(inner, yy, 0.55);
      ctx.beginPath(); ctx.arc(l.x, l.y, Math.max(1, 0.1 * l.s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c + (k > 0 ? (255 - c) * k : c * k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function drawNetLayer(r) {
    const ctx = r.netLayer.getContext('2d');
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    ctx.clearRect(0, 0, r.W, r.H);
    const X = COURT.POST_X;
    const top = [];
    for (let i = 0; i <= 24; i++) { const x = -X + (2 * X * i) / 24; top.push(proj(r, x, 0, CT.netHeight(x))); }
    const bl = proj(r, -X, 0, 0), br = proj(r, X, 0, 0);
    ctx.fillStyle = 'rgba(255,63,180,0.08)';
    ctx.beginPath(); ctx.moveTo(bl.x, bl.y);
    top.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(br.x, br.y); ctx.closePath(); ctx.fill();
    // mesh
    ctx.strokeStyle = 'rgba(255,120,210,0.28)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i <= 48; i++) {
      const x = -X + (2 * X * i) / 48;
      const a = proj(r, x, 0, 0), b = proj(r, x, 0, CT.netHeight(x));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let k = 1; k < 6; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const x = -X + (2 * X * i) / 24;
        const p = proj(r, x, 0, (CT.netHeight(x) * k) / 6);
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.stroke();
    }
    // glowing tape and posts
    ctx.save();
    ctx.shadowColor = PAL.net; ctx.shadowBlur = 14;
    ctx.strokeStyle = PAL.net; ctx.lineWidth = Math.max(2, 0.07 * top[12].s);
    ctx.beginPath(); top.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    for (const x of [-X, X]) {
      const a = proj(r, x, 0, 0), b = proj(r, x, 0, CT.netHeight(x) + 0.05);
      ctx.lineWidth = Math.max(2, 0.08 * a.s);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShadow(ctx, r, x, y, rad, alpha) {
    const p = proj(r, x, y, 0);
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, rad * p.s, rad * p.s * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  }

  function drawPlayer(ctx, r, g, p) {
    const pos = proj(r, p.x, p.y, 0);
    drawShadow(ctx, r, p.x, p.y, 0.55, 0.45);
    // ground ring in the character colour
    ctx.save();
    ctx.strokeStyle = p.ch.colors.glow;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(pos.x, pos.y, 0.6 * pos.s, 0.2 * pos.s, 0, 0, Math.PI * 2); ctx.stroke();
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
    CT.drawCharacter(ctx, p.ch.id, pose, Math.max(0.3, pos.s / 45));
    ctx.restore();
  }

  function drawBall(ctx, r, g) {
    const b = g.ball;
    if (!b.active) return;
    drawShadow(ctx, r, b.pos.x, b.pos.y, 0.09, 0.5);
    const p = proj(r, b.pos.x, b.pos.y, b.pos.z);
    // trail
    if (g.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < g.trail.length; i++) {
        const a = proj(r, g.trail[i - 1].x, g.trail[i - 1].y, g.trail[i - 1].z);
        const c = proj(r, g.trail[i].x, g.trail[i].y, g.trail[i].z);
        ctx.strokeStyle = `rgba(228,255,74,${(i / g.trail.length) * 0.45})`;
        ctx.lineWidth = Math.max(1.5, 0.08 * c.s) * (i / g.trail.length);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
      }
      ctx.restore();
    }
    const rad = Math.max(2.6, 0.075 * p.s);
    ctx.save();
    ctx.shadowColor = PAL.ballGlow; ctx.shadowBlur = 12;
    ctx.fillStyle = PAL.ball;
    ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawGuides(ctx, r, g, human, info) {
    const p = g.players[human];
    // run target
    if (Math.hypot(p.tx - p.x, p.ty - p.y) > 0.3) {
      const t = proj(r, p.tx, p.ty, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(37,217,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 0.35 * t.s, 0.12 * t.s, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // landing marker for the incoming ball
    const b = g.ball;
    if (info && g.predLand && b.bounces === 0 && b.lastHitter !== human) {
      const l = proj(r, g.predLand.x, g.predLand.y, 0);
      const k = 0.28 * l.s;
      ctx.save();
      ctx.strokeStyle = 'rgba(228,255,74,0.65)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(l.x - k, l.y - k * 0.35); ctx.lineTo(l.x + k, l.y + k * 0.35);
      ctx.moveTo(l.x + k, l.y - k * 0.35); ctx.lineTo(l.x - k, l.y + k * 0.35);
      ctx.stroke();
      ctx.restore();
    }
    // timing ring: closes on the ball as it reaches your hitting zone
    if (info && info.t < 0.9) {
      const c = proj(r, info.x, info.y, info.z);
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
    // toss target: swipe as the ball tops out inside the ring
    if (g.phase === 'toss' && g.server === human) {
      const peakZ = 1.5 + (5.3 * 5.3) / (2 * 9.81);
      const c = proj(r, p.x + p.fwd * 0.25, p.y + p.fwd * 0.35, peakZ);
      const pulse = 1 + 0.12 * Math.sin(g.wall * 14);
      ctx.save();
      ctx.strokeStyle = PAL.guide; ctx.lineWidth = 2;
      ctx.shadowColor = PAL.guide; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(10, 0.2 * c.s) * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function render(r, g, human, info) {
    const ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(r.bgLayer, 0, 0);
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);

    // bounce marks
    for (const m of g.marks) {
      const p = proj(r, m.x, m.y, 0);
      const k = 1 - m.age / 1.2;
      ctx.strokeStyle = `rgba(228,255,74,${k * 0.8})`;
      ctx.lineWidth = 1.5;
      const rr = (0.12 + m.age * 0.5) * p.s;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rr, rr * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawGuides(ctx, r, g, human, info);

    // depth-sorted scene, far to near
    const items = g.players.map((p) => ({ y: p.y, draw: () => drawPlayer(ctx, r, g, p) }));
    items.push({ y: 0, draw: () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(r.netLayer, 0, 0); ctx.restore(); } });
    if (g.ball.active) items.push({ y: g.ball.pos.y + 0.01, draw: () => drawBall(ctx, r, g) });
    items.sort((a, b) => b.y - a.y);
    for (const it of items) it.draw();
  }

  CT.createRenderer = createRenderer;
  CT.resizeRenderer = resize;
  CT.renderGame = render;
  CT.unproject = unproject;
  CT.project = proj;
})();
