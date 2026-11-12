// Cardboard VR: head tracking from the phone's motion sensor, and the
// headset-button controls. With the phone in a headset there is nothing to
// swipe, so you watch the ball and press one button: a tap as it arrives
// plays a shot, and pressing early, holding and letting go as it arrives
// plays a power shot. Where the ball goes is picked for you (autoShot).
// Automove does the running. (With a second phone as a swipe pad, its
// swipes play exactly as on the normal screen instead: main.js.)
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

  // Nobody touches the screen during play (or on the swipe pad between
  // swipes), so keep it from dimming and locking. Two ways, both on while
  // wanted:
  //  - the Screen Wake Lock, where there is one. It goes when the page is
  //    hidden and Safari may refuse it outside a tap, so it is asked for
  //    again on the way back and on the next touch.
  //  - a tiny silent video playing on a loop, muted and inline, which keeps
  //    an iPhone awake too. iPhones get it always: no Wake Lock before
  //    iOS 16.4, and from the Home Screen it did nothing before iOS 18.4.
  //    Elsewhere it is the fallback when the lock is missing or refused.
  const BLANK_MP4 = 'data:video/mp4;base64,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Y2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS00IHRocmVhZHM9MiBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4yMACAAAAAG2WIhAXzn///D0UAAVefJycnXXXXXXXXXXXXgAEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHAAAAB0GaOAvnOEYBGCAHARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBw==';
  let wake = null, wakeWanted = false, wakeAsking = false, wakeFailed = false, keepVideo = null;
  const isIOS = () => typeof navigator !== 'undefined' &&
    (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  function awakeVideo() {
    if (keepVideo || typeof document === 'undefined' || !document.body) return keepVideo;
    const v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
    for (const a of ['muted', 'loop', 'playsinline', 'webkit-playsinline']) v.setAttribute(a, '');
    v.setAttribute('aria-hidden', 'true');
    v.src = BLANK_MP4;
    // on the page (a hidden video may not play) but out of sight and out of the way
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(v);
    keepVideo = v;
    return v;
  }

  function lockScreen() {
    if (wake || wakeAsking || typeof navigator === 'undefined' || !navigator.wakeLock) return;
    wakeAsking = true;
    try {
      navigator.wakeLock.request('screen').then((l) => {
        wakeAsking = false; wakeFailed = false;
        if (!wakeWanted) { l.release().catch(() => {}); return; }
        wake = l;
        l.addEventListener('release', () => { if (wake === l) wake = null; });
      }).catch(() => { wakeAsking = false; wakeFailed = true; playVideo(); });
    } catch (e) { wakeAsking = false; wakeFailed = true; }
  }

  function playVideo() {
    if (!wakeWanted) return;
    const hasLock = typeof navigator !== 'undefined' && navigator.wakeLock;
    if (!isIOS() && hasLock && !wakeFailed) return;
    const v = awakeVideo();
    if (v && v.paused) { try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* optional */ } }
  }

  function keepAwake(on) {
    wakeWanted = on;
    if (!on) {
      if (wake) wake.release().catch(() => {});
      wake = null;
      if (keepVideo) keepVideo.pause();
      return;
    }
    lockScreen();
    playVideo();
  }
  // the lock goes when the page is hidden; take it again on the way back,
  // and on any touch in case it was refused for want of one
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (wakeWanted && document.visibilityState === 'visible') keepAwake(true); });
    const nudge = () => { if (wakeWanted && (!wake || (keepVideo && keepVideo.paused))) keepAwake(true); };
    for (const t of ['touchend', 'pointerup', 'click']) document.addEventListener(t, nudge, true);
  }
  const awakeState = () => ({ wanted: wakeWanted, lock: !!wake, video: !!(keepVideo && !keepVideo.paused) });

  // ---------------- auto shots ----------------
  // A hold this long (seconds) before letting go makes it a power shot.
  const POWER_HOLD = 0.3;
  const NET_ZONE = 4.5;   // within this of the net, a player is at the net
  const rand = (rnd, a, b) => a + (b - a) * rnd();

  // The shot (as CT.requestSwipe takes it) for a button let go now: chosen
  // like a player would, a little differently each time. Away from the
  // opponent; over them when they're at the net (or past them); now and
  // then a drop shot when they're camped deep. A power shot goes flat and
  // hard into the open court. A serve goes wide, at the body or down the T.
  function autoShot(g, side, power, rnd = Math.random) {
    const p = g.players[side], opp = g.players[1 - side], b = g.ball, fwd = p.fwd;
    const edge = COURT.SW - 0.45, away = opp.x > 0 ? -1 : 1;
    if (g.phase === 'toss' && g.server === side) {
      const box = g.serveBox, first = g.match.firstServe;
      const r = rnd();
      const target = box.sign * (r < 0.4 ? COURT.SW - (first ? 0.8 : 1.3) : r < 0.7 ? 2 : 0.5);
      // the serve aims at the middle of the box; turn it towards the target
      const T = { x: box.sign * COURT.SW * 0.5, y: fwd * (COURT.SL - 1.6) }, pos = b.pos;
      const a0 = Math.atan2(fwd * (T.x - pos.x), fwd * (T.y - pos.y));
      const a1 = Math.atan2(fwd * (target - pos.x), fwd * (T.y - pos.y));
      const pace = power ? (first ? 0.95 : 0.7) : (first ? rand(rnd, 0.55, 0.7) : rand(rnd, 0.35, 0.5));
      return { aim: clamp((a1 - a0) / 0.45, -0.8, 0.8), pace, spinDir: 1, curve: 0 };
    }
    if (power) return { aim: 0, landX: away * edge * rand(rnd, 0.6, 0.85), pace: 1, spinDir: 1, curve: 0, depth: 1 };
    const oppAtNet = -opp.fwd * opp.y < NET_ZONE;
    const oppDeep = -opp.fwd * opp.y > COURT.HL + 0.6;
    if (oppAtNet) {
      if (rnd() < 0.45) return { aim: 0, landX: rand(rnd, -1.5, 1.5), pace: 0.3, spinDir: 1, curve: 0, depth: 1, lob: true };
      return { aim: 0, landX: away * edge * rand(rnd, 0.75, 1), pace: 0.75, spinDir: 1, curve: 0, depth: 1 };
    }
    if (oppDeep && -fwd * p.y < COURT.HL - 0.4 && b.pos.z > 0.6 && rnd() < 0.15) {
      return { aim: 0, landX: away * rand(rnd, 0.5, 2), pace: 0.15, spinDir: -1, curve: 0, depth: 0.12 };
    }
    const landX = rnd() < 0.6 ? away * edge * rand(rnd, 0.45, 0.85) : rand(rnd, -0.4, 0.4) * edge;
    return { aim: 0, landX, pace: rand(rnd, 0.45, 0.7), spinDir: rnd() < 0.15 ? -1 : 1, curve: 0, depth: rand(rnd, 0.8, 1) };
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
  // Looking this far up (at the sky) and pressing recentres the view.
  const RECENTRE_PITCH = 0.95;

  CT.VR = {
    screenPose, createHead, startHead, stopHead, recentre, headPose, askMotion, keepAwake, awakeState,
    autoShot, timeToHit, POWER_HOLD, PAUSE_PITCH, RECENTRE_PITCH,
  };
})();
