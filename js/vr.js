// Cardboard VR: head tracking from the phone's motion sensor, and the
// headset-button controls. With the phone in a headset there is nothing to
// swipe, so you look where you want the ball to go, hold the button down as
// the ball comes in (the backswing) and let go to hit. The longer the hold,
// the harder the shot. Automove does the running.
//
// The headset's button presses a pad onto the screen, so it arrives as an
// ordinary touch that stays down while the button is held. A screen tap,
// the space bar or a gamepad's A button work the same way.
(function () {
  const CT = (window.CT = window.CT || {});
  const { COURT } = CT;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------------- head tracking ----------------
  // Quaternions are [x, y, z, w].
  function qmul(a, b) {
    return [
      a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
      a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
      a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  }

  // The way the screen faces, from a deviceorientation event (degrees) and
  // the screen's rotation (0, 90, 180 or 270). The view looks out of the
  // back of the phone. yaw: + = turned right; pitch: + = looking up;
  // roll: + = head tilted left, which is also how far to turn the picture
  // (clockwise on screen) to keep the world level.
  function screenPose(alpha, beta, gamma, orient) {
    const d = Math.PI / 180;
    const x = beta * d / 2, y = alpha * d / 2, z = -gamma * d / 2;
    const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
    let q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    q = qmul(q, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);   // from the screen's normal to the camera's view
    const o = -orient * d / 2;
    q = qmul(q, [0, 0, Math.sin(o), Math.cos(o)]);     // sideways screens
    const [qx, qy, qz, qw] = q;
    const m13 = 2 * (qx * qz + qy * qw), m33 = 1 - 2 * (qx * qx + qy * qy);
    const m23 = 2 * (qy * qz - qx * qw);
    const m21 = 2 * (qx * qy + qz * qw), m22 = 1 - 2 * (qx * qx + qz * qz);
    return { yaw: -Math.atan2(m13, m33), pitch: Math.asin(clamp(-m23, -1, 1)), roll: Math.atan2(m21, m22) };
  }

  function screenAngle() {
    const so = window.screen && screen.orientation;
    return so && Number.isFinite(so.angle) ? so.angle : Number(window.orientation) || 0;
  }

  // Without a motion sensor (a laptop) the mouse turns the head instead.
  function createHead() {
    const h = { raw: null, yaw0: 0, mouse: null };
    h.onOrient = (e) => {
      if (e.alpha === null || e.beta === null) return;
      h.raw = screenPose(e.alpha, e.beta, e.gamma, screenAngle());
    };
    h.onMouse = (e) => {
      if (e.pointerType === 'mouse') h.mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    return h;
  }
  function startHead(h) {
    window.addEventListener('deviceorientation', h.onOrient);
    window.addEventListener('pointermove', h.onMouse);
  }
  function stopHead(h) {
    window.removeEventListener('deviceorientation', h.onOrient);
    window.removeEventListener('pointermove', h.onMouse);
  }
  // Wherever you're facing now becomes straight down the court.
  function recentre(h) { if (h.raw) h.yaw0 = h.raw.yaw; }
  function headPose(h) {
    if (h.raw) {
      const d = h.raw.yaw - h.yaw0;
      return { yaw: d - Math.round(d / (2 * Math.PI)) * 2 * Math.PI, pitch: h.raw.pitch, roll: h.raw.roll };
    }
    if (h.mouse) return { yaw: (h.mouse.x - 0.5) * 2.4, pitch: -(h.mouse.y - 0.5) * 1.6, roll: 0 };
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // iPhones only send motion after the player allows it, which has to be
  // asked from a tap. Elsewhere it just works.
  function askMotion() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      try { return D.requestPermission().catch(() => 'denied'); } catch (e) { return Promise.resolve('denied'); }
    }
    return Promise.resolve('granted');
  }

  // Nobody touches the screen during play, so keep it from dimming.
  let wake = null, wakeWanted = false;
  function keepAwake(on) {
    wakeWanted = on;
    if (!on) { if (wake) wake.release().catch(() => {}); wake = null; return; }
    if (wake || !navigator.wakeLock) return;
    try { navigator.wakeLock.request('screen').then((l) => { wake = l; l.addEventListener('release', () => { if (wake === l) wake = null; }); }).catch(() => {}); } catch (e) { /* optional */ }
  }
  // the lock goes when the page is hidden; take it again on the way back
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (wakeWanted && document.visibilityState === 'visible') keepAwake(true); });

  // ---------------- aiming ----------------
  // You aim by looking at the far court. The target stays where you last
  // looked, so you can then watch the ball onto your racket. Looking up into
  // the sky over the far court is a lob; looking just over the net, a drop.
  const AIM = {
    lobPitch: 0.14,   // radians above the horizon that count as the sky (a lob)
    near: 1.2,        // gaze closer than this past the net is still your side (watching the ball)
    short: 3.2,       // the shortest a shot can land past the net
    dropBelow: 0.3,   // depth under this plays a drop shot
    lobDepth: 1.5,    // a lob lands this far inside the baseline
  };
  const edge = () => COURT.SW - 0.45;

  // eye: { x, y, z, yaw, pitch } in world terms, yaw 0 = towards +y.
  // Returns the new target { x, y, kind: 'drive'|'drop'|'lob', depth }, or `aim` unchanged.
  function updateAim(g, side, eye, aim) {
    const fwd = g.players[side].fwd;
    const dx = Math.sin(eye.yaw), dy = Math.cos(eye.yaw);
    if (fwd * dy < 0.25) return aim;   // looking sideways or behind you
    const far = COURT.HL - AIM.lobDepth;
    if (eye.pitch > AIM.lobPitch) {
      const t = (fwd * far - eye.y) / dy;
      return { x: clamp(eye.x + dx * t, -edge(), edge()), y: fwd * far, kind: 'lob', depth: 1 };
    }
    let along;
    let x;
    if (eye.pitch < -0.005) {
      const t = eye.z / -Math.tan(eye.pitch);   // horizontal distance to where the gaze meets the ground
      x = eye.x + dx * t;
      along = fwd * (eye.y + dy * t);
    } else along = Infinity;
    if (along < AIM.near) return aim;   // watching the ball on your own side
    along = Math.min(along, far + AIM.lobDepth - 0.3);
    if (!Number.isFinite(x)) x = eye.x + dx * ((fwd * along - eye.y) / dy);
    const depth = clamp((along - AIM.short) / (COURT.HL - 0.5 - AIM.short), 0, 1);
    return { x: clamp(x, -edge(), edge()), y: fwd * Math.max(AIM.short, along), kind: depth < AIM.dropBelow ? 'drop' : 'drive', depth };
  }

  // Before you've looked anywhere: deep down the middle.
  function defaultAim(g, side) {
    return { x: 0, y: g.players[side].fwd * (COURT.HL - 2), kind: 'drive', depth: 0.85 };
  }

  // How hard: a quick press is soft, a hold of HOLD.full seconds or more is full pace.
  const HOLD = { min: 0.12, full: 0.6, soft: 0.2 };
  function holdPace(secs) {
    return HOLD.soft + (1 - HOLD.soft) * clamp((secs - HOLD.min) / (HOLD.full - HOLD.min), 0, 1);
  }

  // The shot (as CT.requestSwipe takes it) for a button released after
  // `hold` seconds, aimed at `aim`.
  function shotInput(g, side, aim, hold) {
    const a = aim || defaultAim(g, side);
    const p = g.players[side], fwd = p.fwd, b = g.ball;
    const pace = holdPace(hold);
    if (g.phase === 'toss' && g.server === side) {
      // the serve aims at the middle of the box; turn that towards where you looked
      const box = g.serveBox, pos = b.pos;
      const T = { x: box.sign * COURT.SW * 0.5, y: fwd * (COURT.SL - 1.6) };
      const a0 = Math.atan2(fwd * (T.x - pos.x), fwd * (T.y - pos.y));
      const ty = fwd * Math.min(Math.abs(a.y), COURT.SL - 0.5);
      const a1 = Math.atan2(fwd * (a.x - pos.x), fwd * (ty - pos.y));
      return { aim: clamp((a1 - a0) / 0.45, -0.8, 0.8), pace, spinDir: 1, curve: 0, depth: 1 };
    }
    if (a.kind === 'lob') return { aim: 0, landX: a.x, pace: Math.min(pace, 0.5), spinDir: 1, curve: 0, depth: 1, lob: true };
    if (a.kind === 'drop') return { aim: 0, landX: a.x, pace: Math.min(pace, 0.35), spinDir: -1, curve: 0, depth: a.depth };
    return { aim: 0, landX: a.x, pace, spinDir: 1, curve: 0, depth: a.depth };
  }

  // How long until the moment to let go (seconds of game time, below zero
  // once it's past): the ball reaching you, or on your serve the top of the
  // toss. null when there's nothing coming. In a headset you're often
  // looking at your target, not the ball, so this drives a ring round the
  // middle of your view and a countdown of beeps.
  function timeToHit(g, side, info) {
    const b = g.ball;
    if (g.phase === 'toss' && g.server === side && b.active) {
      return { t: g.peakT !== null ? g.peakT - g.time : Math.max(0, b.vel.z) / CT.PHYS.G, reach: true };
    }
    return info ? { t: info.t, reach: info.reach } : null;
  }

  // Looking this far down (at your feet) and pressing pauses the match.
  const PAUSE_PITCH = -0.95;

  CT.VR = {
    screenPose, createHead, startHead, stopHead, recentre, headPose, askMotion, keepAwake,
    updateAim, defaultAim, shotInput, holdPace, timeToHit, HOLD, PAUSE_PITCH,
  };
})();
