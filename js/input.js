// Turning touches into shots, with no page or game state: what a finger
// path means, and what the host accepts from an online guest.
(function () {
  const CT = (window.CT = window.CT || {});
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const TAP_DIST = 30;   // px: a touch that moved less than this isn't a swipe
  const TAP_TIME = 400;  // ms: and is a tap if it was quicker than this
  // A lob: an upward swipe at least LOB_LEN screens long, averaging under
  // LOB_SPEED screens a second.
  const LOB_LEN = 0.22, LOB_SPEED = 1.4;

  // 'tap', 'swipe', or 'none': a quick touch that barely moved is a tap. One
  // held still for longer is a swipe the player thought better of, so it
  // does nothing.
  function gesture(chord, dur) {
    if (chord >= TAP_DIST) return 'swipe';
    return dur < TAP_TIME ? 'tap' : 'none';
  }

  // Turn a finger path into a shot (as CT.requestSwipe takes it): direction =
  // aim, speed = pace vs spin, up = topspin, down = slice, a bowed path =
  // sidespin. On a ball above the player's overheadZ either way is a smash,
  // so swiping down like a real overhead works too, and aims the way it's
  // swiped.
  // pts: [{ x, y, t (ms) }]; `dim` is the screen's short side in the same
  // units. `at(aim)` gives the spot on the far court a swipe at that angle
  // points to (or undefined to leave it to the plain angle).
  function swipeToInput(pts, dim, at) {
    const a0 = pts[0], end = pts[pts.length - 1];
    const dx = end.x - a0.x, dy = end.y - a0.y;
    const chord = Math.hypot(dx, dy), dur = Math.max(1, end.t - a0.t);
    let k = pts.length - 1;
    while (k > 0 && end.t - pts[k].t < 110) k--;
    const tail = Math.hypot(end.x - pts[k].x, end.y - pts[k].y) / Math.max(16, end.t - pts[k].t);
    const v = Math.max(tail, chord / dur) * 1000;                // px per second
    const u = v / dim;  // screens per second
    // A normal phone flick (about half the screen in ~150 ms) is close to full pace.
    const pace = clamp((u - 0.7) / (3.8 - 0.7), 0, 1);
    // Swipe length sets depth: a short swipe drops the ball short, a swipe
    // of about 40% of the screen or more goes to the baseline.
    const depth = clamp((chord / dim - 0.1) / 0.3, 0, 1);
    const over = clamp((u - 7) / 4, 0, 1);
    const spinDir = dy < 0 ? 1 : -1;
    // A slow, long upward swipe lofts a topspin lob. Judged on the whole
    // swipe, not its tail: fingers speed up as they let go, so a deliberate
    // slow swipe still ends with a flick.
    const lob = spinDir > 0 && (chord / dur) * 1000 / dim < LOB_SPEED && chord / dim >= LOB_LEN;
    let aim = Math.atan2(dx, Math.abs(dy));
    // bow of the path, measured towards screen-right
    let nx = -dy / chord, ny = dx / chord;
    if (nx < 0) { nx = -nx; ny = -ny; }
    let bulge = 0;
    for (const p of pts) {
      const d = ((p.x - a0.x) * nx + (p.y - a0.y) * ny) / chord;
      if (Math.abs(d) > Math.abs(bulge)) bulge = d;
    }
    if (Math.abs(bulge) < 0.04) bulge = 0;
    const curve = -clamp(bulge * 5, -1, 1);
    aim += clamp(bulge * 0.45, -0.12, 0.12);
    // A slice is swiped the other way: top-left to bottom-right goes left.
    // But a smash swiped down goes the way the swipe goes, like the racket
    // coming down through the ball: the engine picks that aim (`smash`) if
    // the ball turns out to be above smash height when it's hit.
    const spot = at || (() => undefined);
    const smash = spinDir < 0 ? { aim, landX: spot(aim) } : undefined;
    if (spinDir < 0) aim = -aim;
    const input = { aim, pace, over, spinDir, curve, depth, landX: spot(aim), lob };
    if (smash) input.smash = smash;
    // A slow swipe is still going when the ball arrives: its timing counts
    // from partway through, not from when the finger lifts.
    // And it always goes deep, however long the swipe: a short lob is just a
    // smash for them.
    if (lob) { input.lead = dur / 2000; input.depth = 1; }
    return input;
  }

  // ---- what the host takes from a guest ----
  // The guest's phone is someone else's: every number is checked and kept in
  // the range a real swipe can produce, and anything else is dropped.
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : undefined);

  // A guest's shot, or null if it isn't one.
  function cleanInput(m) {
    if (!m || typeof m !== 'object') return null;
    const aim = num(m.aim, -Math.PI / 2, Math.PI / 2), pace = num(m.pace, 0, 1);
    if (aim === undefined || pace === undefined) return null;
    const input = {
      aim, pace,
      over: num(m.over, 0, 1) || 0,
      spinDir: m.spinDir < 0 ? -1 : 1,
      curve: num(m.curve, -1, 1) || 0,
      lob: m.lob === true,
    };
    const depth = num(m.depth, 0, 1), landX = num(m.landX, -20, 20), lead = num(m.lead, 0, 1), run = num(m.run, 0, 1);
    if (depth !== undefined) input.depth = depth;
    if (landX !== undefined) input.landX = landX;
    if (lead !== undefined) input.lead = lead;
    if (run !== undefined) input.run = run;
    if (m.smash && typeof m.smash === 'object') {
      const sa = num(m.smash.aim, -Math.PI / 2, Math.PI / 2), sx = num(m.smash.landX, -20, 20);
      if (sa !== undefined) { input.smash = { aim: sa }; if (sx !== undefined) input.smash.landX = sx; }
    }
    return input;
  }

  // A guest's timing error (seconds), or null. (Anything past a second
  // either way is a miss whatever it says.)
  function cleanErr(v) {
    const e = num(v, -1, 1);
    return e === undefined ? null : e;
  }

  // A guest's tap on the court, or null.
  function cleanSpot(m) {
    const x = num(m && m.x, -30, 30), y = num(m && m.y, -30, 30);
    return x === undefined || y === undefined ? null : { x, y };
  }

  CT.Input = { TAP_DIST, TAP_TIME, LOB_LEN, LOB_SPEED, gesture, swipeToInput, cleanInput, cleanErr, cleanSpot };
})();
