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
      drain: 0.22,         // stamina per metre run
      capDrain: 0.008,     // hard-cap loss per metre run
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
      pace: { fh: 37, bh: 30 },
      paceMin: 16,
      spin: { fh: 1.15, bh: 0.85 },
      serve: 56,
      window: { fh: 0.10, bh: 0.065 },
      drain: 0.26,
      capDrain: 0.01,
      home: 12.7,
      returnDepth: 13.3,
      colors: { main: '#ece6ff', glow: '#ffc23d', dark: '#3a2f63', accent: '#3fd2ff' },
    },
  };

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // Hand position and racket angle (canvas radians, 0 = +x, -PI/2 = up)
  // for a swing. R is +1 when the player's right hand is screen-right.
  function racketPose(pose, R, shoulderY) {
    const t = pose.t;
    if (pose.swing >= 0) {
      const e = easeOut(Math.min(1, pose.swing));
      if (pose.wing === 'oh') {
        const a = CT.lerp(-2.0, 0.7, e);
        return { hx: R * CT.lerp(0.2, 0.35, e), hy: CT.lerp(shoulderY - 0.55, shoulderY - 0.15, e), ang: R > 0 ? a : Math.PI - a };
      }
      if (pose.wing === 'serve') {
        const a = CT.lerp(-1.9, 0.9, e);
        return { hx: R * CT.lerp(0.15, 0.4, e), hy: CT.lerp(shoulderY - 0.6, shoulderY + 0.2, e), ang: R > 0 ? a : Math.PI - a };
      }
      const side = pose.wing === 'fh' ? R : -R;
      const a = CT.lerp(0.5, -2.4, e);
      return {
        hx: side * CT.lerp(0.6, -0.3, e),
        hy: CT.lerp(shoulderY + 0.45, shoulderY - 0.15, e),
        ang: side > 0 ? a : Math.PI - a,
      };
    }
    if (pose.toss) {
      return { hx: R * 0.35, hy: shoulderY - 0.1, ang: R > 0 ? -2.6 : Math.PI + 2.6 };
    }
    // ready position: racket out in front, bobbing slightly
    const bob = Math.sin(t * 6) * 0.03;
    return { hx: R * 0.32, hy: shoulderY + 0.4 + bob, ang: R > 0 ? -1.15 : Math.PI + 1.15 };
  }

  function drawRacket(ctx, hx, hy, ang, frame, strings) {
    const L = 0.42, hl = 0.17, hw = 0.13;
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1530';
    ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(-0.06, 0); ctx.lineTo(L, 0); ctx.stroke();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 0.025;
    ctx.beginPath(); ctx.moveTo(0.05, 0); ctx.lineTo(L, 0); ctx.stroke();
    ctx.translate(L + hl, 0);
    ctx.fillStyle = strings;
    ctx.beginPath(); ctx.ellipse(0, 0, hl, hw, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = frame;
    ctx.lineWidth = 0.035;
    ctx.stroke();
    ctx.restore();
  }

  function glowStroke(ctx, color, width, blur) {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
  }

  // ---------------- Octopus ----------------
  function drawOctopus(ctx, pose, k) {
    const c = CHARACTERS.octopus.colors;
    const R = pose.facing === 'back' ? 1 : -1;
    const t = pose.t;
    const run = pose.running ? 1 : 0;
    const mantleBottom = -0.95, mantleTop = -1.98;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // seven walking tentacles
    for (let i = 0; i < 7; i++) {
      const u = (i - 3) / 3;               // -1..1 across the body
      const ph = t * (run ? 11 : 3) + i * 1.3;
      const baseX = u * 0.22;
      const footX = u * 0.55 + Math.sin(ph) * (0.06 + run * 0.1);
      const midX = u * 0.48 + Math.cos(ph) * 0.12;
      const lift = run ? Math.max(0, Math.sin(ph)) * 0.08 : 0;
      ctx.beginPath();
      ctx.moveTo(baseX, mantleBottom + 0.05);
      ctx.bezierCurveTo(midX, -0.65, footX * 1.2, -0.25, footX, -lift);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 0.16 - Math.abs(u) * 0.03;
      ctx.stroke();
      ctx.strokeStyle = c.main;
      ctx.lineWidth = 0.1 - Math.abs(u) * 0.02;
      ctx.stroke();
      // glowing suckers
      ctx.fillStyle = c.glow;
      for (let s = 1; s <= 3; s++) {
        const q = s / 4;
        const x = (1 - q) * (1 - q) * (1 - q) * baseX + 3 * (1 - q) * (1 - q) * q * midX + 3 * (1 - q) * q * q * footX * 1.2 + q * q * q * footX;
        const y = (1 - q) * (1 - q) * (1 - q) * (mantleBottom + 0.05) + 3 * (1 - q) * (1 - q) * q * -0.65 + 3 * (1 - q) * q * q * -0.25 + q * q * q * -lift;
        ctx.beginPath(); ctx.arc(x, y, 0.018, 0, Math.PI * 2); ctx.fill();
      }
    }

    // mantle (tall, Medvedev-lanky)
    const g = ctx.createLinearGradient(0, mantleTop, 0, mantleBottom);
    g.addColorStop(0, c.main);
    g.addColorStop(1, c.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.24, mantleBottom);
    ctx.bezierCurveTo(-0.34, -1.35, -0.3, mantleTop, 0, mantleTop);
    ctx.bezierCurveTo(0.3, mantleTop, 0.34, -1.35, 0.24, mantleBottom);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    glowStroke(ctx, c.glow, 0.025, 10 * k);
    ctx.stroke();
    ctx.restore();

    if (pose.facing === 'front') {
      // visor with two eye lights
      ctx.save();
      ctx.fillStyle = '#0b0618';
      ctx.beginPath();
      ctx.ellipse(0, -1.32, 0.23, 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = c.accent; ctx.shadowBlur = 12 * k;
      ctx.fillStyle = c.accent;
      const look = Math.sin(t * 0.7) * 0.02;
      ctx.beginPath(); ctx.ellipse(-0.09 + look, -1.32, 0.045, 0.028, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.09 + look, -1.32, 0.045, 0.028, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else {
      // circuitry down the back of the mantle
      ctx.save();
      glowStroke(ctx, c.glow, 0.014, 6 * k);
      ctx.beginPath();
      ctx.moveTo(0, -1.9); ctx.lineTo(0, -1.15);
      ctx.moveTo(0, -1.6); ctx.lineTo(0.1, -1.5); ctx.lineTo(0.1, -1.25);
      ctx.moveTo(0, -1.45); ctx.lineTo(-0.11, -1.35); ctx.lineTo(-0.11, -1.1);
      ctx.stroke();
      ctx.restore();
    }

    // eighth tentacle is the racket arm
    const rp = racketPose(pose, R, -1.15);
    ctx.beginPath();
    ctx.moveTo(R * 0.18, -1.05);
    ctx.quadraticCurveTo(R * 0.45, (rp.hy - 1.05) / 2 + 0.1, rp.hx, rp.hy);
    ctx.strokeStyle = c.dark; ctx.lineWidth = 0.13; ctx.stroke();
    ctx.strokeStyle = c.main; ctx.lineWidth = 0.08; ctx.stroke();
    // off-tentacle helps balance / grips the toss
    const offX = pose.toss ? -R * 0.15 : -R * 0.42;
    const offY = pose.toss ? -2.1 : -1.0 + Math.sin(t * 4) * 0.04;
    ctx.beginPath();
    ctx.moveTo(-R * 0.18, -1.05);
    ctx.quadraticCurveTo(-R * 0.45, -1.2, offX, offY);
    ctx.strokeStyle = c.dark; ctx.lineWidth = 0.11; ctx.stroke();
    ctx.strokeStyle = c.main; ctx.lineWidth = 0.065; ctx.stroke();

    ctx.save();
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    drawRacket(ctx, rp.hx, rp.hy, rp.ang, c.glow, 'rgba(40,240,214,0.18)');
    ctx.restore();
  }

  // ---------------- Philosopher ----------------
  function drawPhilosopher(ctx, pose, k) {
    const c = CHARACTERS.philosopher.colors;
    const R = pose.facing === 'back' ? 1 : -1;
    const t = pose.t;
    const run = pose.running ? 1 : 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const skin = '#c98f6b';
    const ph = t * 11;

    // legs with neon greaves and sandals
    for (const s of [-1, 1]) {
      const swing = run ? Math.sin(ph + (s > 0 ? 0 : Math.PI)) * 0.12 : 0;
      ctx.strokeStyle = skin; ctx.lineWidth = 0.1;
      ctx.beginPath(); ctx.moveTo(s * 0.1, -0.85); ctx.lineTo(s * 0.13 + swing, -0.02); ctx.stroke();
      ctx.save();
      glowStroke(ctx, c.accent, 0.035, 8 * k);
      ctx.beginPath(); ctx.moveTo(s * 0.115 + swing * 0.5, -0.45); ctx.lineTo(s * 0.125 + swing * 0.8, -0.2); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(s * 0.13 + swing - 0.07, -0.04, 0.14, 0.04);
    }

    // toga
    const g = ctx.createLinearGradient(-0.3, -1.55, 0.3, -0.7);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, c.main);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-0.24, -1.5);
    ctx.lineTo(0.24, -1.5);
    ctx.lineTo(0.3, -0.72);
    ctx.quadraticCurveTo(0, -0.66, -0.3, -0.75);
    ctx.closePath();
    ctx.fill();
    // diagonal drape with gold neon trim
    ctx.save();
    glowStroke(ctx, c.glow, 0.03, 10 * k);
    ctx.beginPath();
    ctx.moveTo(-R * 0.24, -1.5);
    ctx.quadraticCurveTo(R * 0.05, -1.15, R * 0.28, -0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.3, -0.75); ctx.quadraticCurveTo(0, -0.66, 0.3, -0.72);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(58,47,99,0.35)';
    ctx.lineWidth = 0.012;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-0.15 + i * 0.12, -1.3);
      ctx.quadraticCurveTo(-0.1 + i * 0.12, -1.0, -0.12 + i * 0.13, -0.75);
      ctx.stroke();
    }

    // arms
    const rp = racketPose(pose, R, -1.42);
    ctx.strokeStyle = skin; ctx.lineWidth = 0.085;
    ctx.beginPath(); ctx.moveTo(R * 0.22, -1.45); ctx.quadraticCurveTo(R * 0.36, (rp.hy - 1.45) / 2, rp.hx, rp.hy); ctx.stroke();
    const offX = pose.toss ? -R * 0.12 : -R * 0.34;
    const offY = pose.toss ? -2.15 : -1.05 + Math.sin(t * 4) * 0.03;
    ctx.beginPath(); ctx.moveTo(-R * 0.22, -1.45); ctx.quadraticCurveTo(-R * 0.34, -1.3, offX, offY); ctx.stroke();
    // cyber gauntlet on the racket arm
    ctx.save();
    glowStroke(ctx, c.accent, 0.05, 8 * k);
    const gx = R * 0.22 + (rp.hx - R * 0.22) * 0.8, gy = -1.45 + (rp.hy + 1.45) * 0.8;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(rp.hx, rp.hy); ctx.stroke();
    ctx.restore();

    // head
    const hy = -1.72;
    ctx.fillStyle = '#2b1a12';           // long hair, shoulder length
    ctx.beginPath();
    ctx.ellipse(0, hy + 0.02, 0.16, 0.2, 0, Math.PI, 0);
    ctx.lineTo(0.17, hy + 0.2); ctx.quadraticCurveTo(0, hy + 0.26, -0.17, hy + 0.2);
    ctx.closePath();
    ctx.fill();
    if (pose.facing === 'front') {
      ctx.fillStyle = skin;
      ctx.beginPath(); ctx.ellipse(0, hy + 0.02, 0.115, 0.14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3b2418';         // beard
      ctx.beginPath();
      ctx.moveTo(-0.11, hy + 0.04);
      ctx.quadraticCurveTo(-0.1, hy + 0.2, 0, hy + 0.24);
      ctx.quadraticCurveTo(0.1, hy + 0.2, 0.11, hy + 0.04);
      ctx.quadraticCurveTo(0, hy + 0.1, -0.11, hy + 0.04);
      ctx.fill();
      ctx.fillStyle = '#120a20';
      ctx.fillRect(-0.075, hy - 0.01, 0.04, 0.02);
      ctx.fillRect(0.035, hy - 0.01, 0.04, 0.02);
    }
    // headband
    ctx.save();
    glowStroke(ctx, c.accent, 0.03, 8 * k);
    ctx.beginPath(); ctx.moveTo(-0.15, hy - 0.06); ctx.lineTo(0.15, hy - 0.06); ctx.stroke();
    ctx.restore();
    // glowing laurel wreath
    ctx.save();
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    ctx.fillStyle = c.glow;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const x = Math.cos(a) * 0.15, y = hy - 0.08 + Math.sin(a) * 0.1;
      ctx.beginPath(); ctx.ellipse(x, y, 0.035, 0.016, a + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = c.glow; ctx.shadowBlur = 10 * k;
    drawRacket(ctx, rp.hx, rp.hy, rp.ang, c.glow, 'rgba(255,194,61,0.16)');
    ctx.restore();
  }

  function drawCharacter(ctx, id, pose, k) {
    if (id === 'octopus') drawOctopus(ctx, pose, k);
    else drawPhilosopher(ctx, pose, k);
  }

  CT.CHARACTERS = CHARACTERS;
  CT.drawCharacter = drawCharacter;
})();
