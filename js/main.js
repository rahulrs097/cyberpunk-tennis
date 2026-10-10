// Touch input, HUD, sound and the frame loop.
(function () {
  const CT = window.CT;
  const $ = (id) => document.getElementById(id);
  let me = 0;          // the side of the court this phone plays (always drawn at the bottom)
  let net = null;      // online match: { role: 'host' | 'guest', code, link, ... }

  const canvas = $('court');
  const renderer = CT.createRenderer(canvas);
  let game = null;
  let paused = false;
  let humanChar = 'octopus';
  let speedSetting = 0.8;
  // The ball speed setting is also the difficulty: how much the CPU mistimes.
  const CPU_ERR = { 0.65: 1.3, 0.8: 1, 1: 0.65 };
  const CPU_REACT = { 0.65: 0.3, 0.8: 0.24, 1: 0.12 };   // seconds to read a shot
  const CPU_COVER = { 0.65: 0.15, 0.8: 0.25, 1: 0.4 };
  const SERVE_CLOCK = 20;   // seconds to start a serve in an online match
  let autoMove = true;
  try { const v = localStorage.getItem('ct.autoMove'); if (v !== null) autoMove = v === '1'; } catch (e) { /* storage is optional */ }
  let musicOn = true;
  try { const v = localStorage.getItem('ct.music'); if (v !== null) musicOn = v === '1'; } catch (e) { /* storage is optional */ }
  let lastFrame = performance.now();
  let msgTimer = 0;
  let shotTimer = 0;

  // ---------------- sound ----------------
  let audio = null, master = null, muted = false;
  const SFX_GAIN = 2.6;   // sound effects level
  function ensureAudio() {
    if (audio) return;
    try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
    if (!audio) return;
    // Everything runs through a limiter so it can be loud without crackling.
    master = audio.createDynamicsCompressor();
    master.threshold.value = -10; master.knee.value = 6; master.ratio.value = 12;
    master.attack.value = 0.003; master.release.value = 0.15;
    const makeup = audio.createGain();
    makeup.gain.value = 1.4;
    master.connect(makeup).connect(audio.destination);
    CT.Music.setOn(musicOn);
    CT.Music.start(audio, master);
  }
  function blip(freq, dur, type, gain, slide) {
    if (!audio || muted) return;
    try {
      const t = audio.currentTime;
      const o = audio.createOscillator(), gn = audio.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      gn.gain.setValueAtTime((gain || 0.08) * SFX_GAIN, t);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn).connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio is optional */ }
  }

  // ---------------- HUD ----------------
  function showMsg(text, sub, tone) {
    const el = $('msg');
    el.querySelector('.big').textContent = text;
    el.querySelector('.sub').textContent = sub || '';
    el.dataset.tone = tone || 'neutral';
    el.hidden = false;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    msgTimer = 1.6;
  }

  function showShot(text) {
    const el = $('shot');
    el.textContent = text;
    el.hidden = false;
    shotTimer = 3.2;
  }

  function setHint(text) { $('hint').textContent = text; }

  function updateHud() {
    const m = game.match;
    const srv = game.phase === 'preServe' || game.phase === 'toss' ? game.server : CT.currentServer(m);
    for (const side of [0, 1]) {
      const p = game.players[side];
      const row = $('row' + (side === me ? 0 : 1));
      row.querySelector('.name').textContent = p.ch.name + (side === me ? ' (you)' : '') + (p.stamina < 35 ? ' · tired' : '');
      row.querySelector('.games').textContent = m.games[side];
      row.querySelector('.pts').textContent = CT.pointLabel(m, side);
      row.querySelector('.serve').style.visibility = srv === side && !m.over ? 'visible' : 'hidden';
      row.querySelector('.stam-fill').style.width = p.stamina.toFixed(1) + '%';
      row.classList.toggle('tired', p.stamina < 35);
      row.querySelector('.stam-cap').style.left = p.cap.toFixed(1) + '%';
      row.style.setProperty('--pc', p.ch.colors.glow);
    }
    let call = CT.matchCallout(m) || (m.firstServe ? '' : 'Second serve');
    // the serve clock shows for its last 10 seconds
    if (game.serveClock && game.phase === 'preServe') {
      const left = game.serveClock - game.serveWait;
      if (left <= 10) call = 'Serve clock ' + Math.max(0, Math.ceil(left)) + (call ? ' · ' + call : '');
    }
    $('callout').textContent = call;
  }

  function hintForState() {
    if (!game) return;
    const humanServing = game.server === me;
    if (game.phase === 'preServe') setHint(humanServing ? 'Tap to toss the ball' : autoMove ? 'Get ready to return' : 'Tap the court to move into position');
    else if (game.phase === 'toss' && humanServing) setHint('Swipe as the ball tops out in the ring');
    else if (game.phase === 'rally') setHint(autoMove ? 'Swipe as the ring closes · Tap to reposition' : 'Tap to move · Swipe as the ring closes');
  }

  // ---------------- game events ----------------
  function onEvent(type, d) {
    const names = game ? game.players.map((p) => p.ch.name) : ['', ''];
    if (type === 'hit') {
      blip(d.kind === 'overhead' || d.kind === 'serve' ? 220 : 330, 0.07, 'square', 0.09, 140);
      if (d.side === me) {
        const kind = { fh: 'Forehand', bh: 'Backhand' }[d.wing];
        const label = d.kind === 'serve' ? 'Serve' : d.kind === 'overhead' ? 'Overhead' : d.kind === 'volley' ? kind + ' volley' : d.kind === 'power' ? 'Power ' + kind.toLowerCase() : d.kind === 'powerVolley' ? 'Power ' + kind.toLowerCase() + ' volley' : kind;
        const timing = d.perfect ? 'Perfect timing'
          : d.note && Math.abs(d.errMs) < 15 ? d.note
          : (d.errMs > 0 ? 'Late ' : 'Early ') + Math.abs(d.errMs) + ' ms' + (d.note ? ' · ' + d.note : '');
        showShot([label, timing, d.kmh + ' km/h', d.spin, d.curve].filter(Boolean).join(' · '));
        try { navigator.vibrate && navigator.vibrate(18); } catch (e) { /* optional */ }
      }
      hintForState();
    } else if (type === 'bounce') {
      blip(120, 0.05, 'sine', 0.07);
      if (net && net.role === 'guest') game.marks.push({ x: d.x, y: d.y, age: 0 });
    } else if (type === 'net') {
      blip(90, 0.12, 'sawtooth', 0.05);
    } else if (type === 'whiff') {
      if (d.side === me) showShot(d.reason);
    } else if (type === 'fault') {
      showMsg(d.text === 'Net' || d.text === 'Serve clock' ? d.text : 'Fault', 'Second serve', 'warn');
      blip(160, 0.2, 'sawtooth', 0.05, 90);
    } else if (type === 'point') {
      const youWon = d.winner === me;
      let sub = names[d.winner] + ' wins the point';
      if (d.result === 'game') sub = names[d.winner] + ' takes the game';
      if (d.result === 'set') sub = names[d.winner] + ' wins the set';
      showMsg(d.text, sub, youWon ? 'good' : 'bad');
      blip(youWon ? 520 : 200, 0.25, 'triangle', 0.08, youWon ? 780 : 120);
      updateHud();
    } else if (type === 'serveReady') {
      updateHud();
      hintForState();
    } else if (type === 'matchOver') {
      endMatch(d.winner);
    } else if (type === 'toss') {
      hintForState();
    }
  }

  function endMatch(winner) {
    const m = game.match;
    const w = game.players[winner].ch.name;
    const score = `${m.games[winner]}–${m.games[1 - winner]}` + (m.tiebreak ? ` (${m.points[winner]}–${m.points[1 - winner]})` : '');
    $('endTitle').textContent = winner === me ? 'You win the set' : `${w} wins the set`;
    $('endScore').textContent = score;
    $('end').hidden = false;
    leaveFullscreen();
    CT.Music.setPlaying(false);
  }

  // ---------------- input ----------------
  let touch = null;
  function onDown(e) {
    ensureAudio();
    if (audio && audio.state === 'suspended') audio.resume();
    if (!game || paused || touch) return;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    touch = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    e.preventDefault();
  }
  function onMove(e) {
    if (!touch || e.pointerId !== touch.id) return;
    touch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    e.preventDefault();
  }
  function onUp(e) {
    if (!touch || e.pointerId !== touch.id) return;
    touch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const pts = touch.pts;
    touch = null;
    e.preventDefault();
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    const dur = Math.max(1, b.t - a.t);
    if (chord < 24 && dur < 400) { handleTap(b.x, b.y); return; }
    if (chord < 30) return;
    handleSwipe(pts, dx, dy, chord, dur);
  }

  const isGuest = () => !!(net && net.role === 'guest' && game && game.remote);

  function handleTap(x, y) {
    if (game.phase === 'preServe' && game.server === me) {
      if (isGuest()) send({ t: 'in', k: 'toss' }); else CT.requestToss(game, me);
      return;
    }
    const w = CT.unproject(renderer, x, y);
    if (!w) return;
    CT.requestMove(game, me, w.x, w.y);
    if (isGuest()) send({ t: 'in', k: 'move', x: w.x, y: w.y });
  }

  // Where on the far court a swipe points: follow the swipe's direction on
  // screen from the ball's shadow until it reaches the back of the court, so
  // a flick towards a corner on screen goes to that corner whatever the
  // camera's angle. Undefined (fall back to the plain angle) if it can't tell.
  function pointAt(aim) {
    const b = game.ball, fwd = game.players[me].fwd;
    if (!b.active) return undefined;
    const P = CT.project(renderer, b.pos.x, b.pos.y, 0);
    if (P.behind) return undefined;
    const g0 = CT.unproject(renderer, P.x, P.y);
    const g1 = CT.unproject(renderer, P.x + 40 * Math.sin(aim), P.y - 40 * Math.cos(aim));
    if (!g0 || !g1 || fwd * (g1.y - g0.y) < 0.05) return undefined;
    const t = (fwd * (CT.COURT.HL - 2) - g0.y) / (g1.y - g0.y);
    const x = g0.x + (g1.x - g0.x) * t;
    return Number.isFinite(x) ? x : undefined;
  }

  // Turn a finger path into a shot: direction = aim, speed = pace vs spin,
  // up = topspin, down = slice, a bowed path = sidespin.
  function handleSwipe(pts, dx, dy, chord, dur) {
    const end = pts[pts.length - 1];
    let k = pts.length - 1;
    while (k > 0 && end.t - pts[k].t < 110) k--;
    const tail = Math.hypot(end.x - pts[k].x, end.y - pts[k].y) / Math.max(16, end.t - pts[k].t);
    const v = Math.max(tail, chord / dur) * 1000;                // px per second
    const u = v / Math.min(window.innerWidth, window.innerHeight);  // screens per second
    // A normal phone flick (about half the screen in ~150 ms) is close to full pace.
    const pace = CT.clamp((u - 0.7) / (3.8 - 0.7), 0, 1);
    // Swipe length sets depth: a short swipe drops the ball short, a swipe
    // of about 40% of the screen or more goes to the baseline.
    const depth = CT.clamp((chord / Math.min(window.innerWidth, window.innerHeight) - 0.1) / 0.3, 0, 1);
    const over = CT.clamp((u - 7) / 4, 0, 1);
    const spinDir = dy < 0 ? 1 : -1;
    // a slow, unhurried upward swipe (not a short one) lofts a topspin lob
    const lob = spinDir > 0 && u < 0.55 && depth >= 0.5;
    let aim = Math.atan2(dx, Math.abs(dy));
    // bow of the path, measured towards screen-right
    let nx = -dy / chord, ny = dx / chord;
    if (nx < 0) { nx = -nx; ny = -ny; }
    let bulge = 0;
    for (const p of pts) {
      const d = ((p.x - pts[0].x) * nx + (p.y - pts[0].y) * ny) / chord;
      if (Math.abs(d) > Math.abs(bulge)) bulge = d;
    }
    if (Math.abs(bulge) < 0.04) bulge = 0;
    const curve = -CT.clamp(bulge * 5, -1, 1);
    aim += CT.clamp(bulge * 0.45, -0.12, 0.12);
    // A slice is swiped the other way: top-left to bottom-right goes left.
    if (spinDir < 0) aim = -aim;
    const input = { aim, pace, over, spinDir, curve, depth, landX: pointAt(aim), lob };
    if (isGuest()) {
      // judge timing here, against the ball this player saw, then send it
      const tm = CT.swipeTiming(game, me);
      if (!tm) return;
      if (tm.whiff) { showShot(tm.whiff); return; }
      send({ t: 'in', k: 'swipe', input, err: tm.err });
    } else CT.requestSwipe(game, me, input);
  }

  // ---------------- online ----------------
  // The host's phone runs the match. The guest sends taps and swipes, and
  // gets the match state back about 20 times a second plus every game event.
  function send(m) { if (net) net.link.send(m); }

  function lobby(text, code, joining) {
    $('lobbyText').textContent = text;
    $('roomCode').textContent = code || '';
    $('roomCode').hidden = !code;
    $('codeInput').hidden = !joining;
    $('lobbyGo').hidden = !joining;
    $('lobby').hidden = false;
    $('menu').hidden = true;
  }

  function leaveOnline(tellOther) {
    if (!net) return;
    if (tellOther) send({ t: 'bye' });
    clearInterval(net.timer);
    net.link.close();
    net = null;
    me = 0;
  }

  function onNet(m) {
    if (!net) return;
    net.lastHeard = performance.now();
    if (m.t === 'bye') { leaveOnline(false); showMenu(); showMsg('Opponent left', 'Back to the menu', 'warn'); return; }
    if (net.role === 'host') {
      if (m.t === 'hello' && !net.started) {
        net.guestChar = CT.CHARACTERS[m.char] ? m.char : 'philosopher';
        net.guestAuto = !!m.autoMove;
        hostStart();
      } else if (m.t === 'in' && game && net.started) {
        if (m.k === 'move') CT.requestMove(game, 1, +m.x, +m.y);
        else if (m.k === 'toss') CT.requestToss(game, 1);
        else if (m.k === 'swipe') CT.requestSwipe(game, 1, m.input, +m.err);
      } else if (m.t === 'auto' && game && net.started) {
        net.guestAuto = !!m.on;
        CT.setAutoMove(game, 1, net.guestAuto);
      } else if (m.t === 'rematch' && game && game.phase === 'matchOver') hostStart();
    } else {
      if (m.t === 'start') {
        net.started = true;
        clearInterval(net.timer);
        net.timer = setInterval(() => send({ t: 'ping' }), 1000);
        me = 1;
        $('lobby').hidden = true;
        beginMatch({ p0: m.p0, p1: m.p1, timeScale: m.timeScale, control: ['remote', 'human'], remote: true, serveClock: m.serveClock });
      } else if (m.t === 'st' && game && game.remote) {
        const was = game.phase + game.server;
        CT.applySnapshot(game, m.s);
        // events arrive just before the state they belong to, so the hint
        // is worked out again once that state is here
        if (game.phase + game.server !== was) hintForState();
      } else if (m.t === 'ev' && game && game.remote) {
        onEvent(m.type, m.d);
      }
    }
  }

  // only matters before the match starts; mid-match the 6 s silence check handles it
  function onLink(n, status) {
    if (net !== n || net.started || status === 'open') return;
    clearInterval(net.timer);
    lobby("Couldn't reach the online server. Check your connection and try again.", '', net.role === 'guest');
  }

  function hostRoom() {
    ensureAudio();
    leaveOnline(true);
    const code = CT.Net.makeCode();
    net = { role: 'host', code, started: false, lastHeard: performance.now(), sendT: 0 };
    const n = net;
    net.link = CT.Net.connect(code, 'host', onNet, (st) => onLink(n, st));
    lobby('Send this code to a friend. The match starts as soon as they join.', code, false);
  }

  function joinRoom(code) {
    ensureAudio();
    leaveOnline(true);
    net = { role: 'guest', code, started: false, lastHeard: performance.now() };
    const n = net;
    net.link = CT.Net.connect(code, 'guest', onNet, (st) => onLink(n, st));
    lobby('Connecting to room ' + code + '…', '', false);
    // keep knocking until the host answers
    const t0 = performance.now();
    const hello = () => {
      send({ t: 'hello', char: humanChar, autoMove });
      if (performance.now() - t0 > 8000) lobby('No answer from room ' + code + '. Check the code, and that your friend is still on the room screen.', '', true);
    };
    hello();
    net.timer = setInterval(hello, 500);
  }

  function hostStart() {
    net.started = true;
    me = 0;
    // online matches always use Pro ball speed, with a serve clock
    const cfg = { p0: humanChar, p1: net.guestChar, timeScale: 1, control: ['human', 'remote'], autoMove: [autoMove, net.guestAuto], serveClock: SERVE_CLOCK };
    send({ t: 'start', p0: cfg.p0, p1: cfg.p1, timeScale: cfg.timeScale, serveClock: cfg.serveClock });
    $('lobby').hidden = true;
    beginMatch(cfg);
  }

  // ---------------- flow ----------------
  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const hud = $('hud').getBoundingClientRect();
    // leave a band of open sky between the scoreboard and the roof edge
    CT.resizeRenderer(renderer, W, H, hud.bottom + Math.min(80, H * 0.08), 56, hud.bottom);
  }

  // Fill the screen (browsers only allow this from a tap). iPhones don't
  // support it for web pages; there the game is best added to the home screen.
  function goFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => { try { screen.orientation.lock('portrait').catch(() => {}); } catch (e) { /* optional */ } }).catch(() => {});
    } catch (e) { /* not allowed here */ }
  }

  function leaveFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { /* nothing to leave */ }
  }

  // A CPU-vs-CPU rally plays behind the menu.
  function showMenu() {
    leaveOnline(true);
    $('lobby').hidden = true;
    CT.Music.setPlaying(false);
    $('end').hidden = true;
    $('pauseMenu').hidden = true;
    paused = false;
    $('menu').hidden = false;
    game = CT.createGame({ p0: 'octopus', p1: 'philosopher', timeScale: 0.6, control: ['cpu', 'cpu'], onEvent: () => {} });
    layout();
  }

  // Play vs CPU, or Rematch (online, the host restarts for both).
  function startMatch() {
    if (net) {
      if (net.role === 'host') hostStart(); else send({ t: 'rematch' });
      return;
    }
    me = 0;
    const cpuChar = humanChar === 'octopus' ? 'philosopher' : 'octopus';
    beginMatch({ p0: humanChar, p1: cpuChar, timeScale: speedSetting, control: ['human', 'cpu'], autoMove: [autoMove, false], cpuErr: CPU_ERR[speedSetting] || 1,
      cpuReact: CPU_REACT[speedSetting], cpuCover: CPU_COVER[speedSetting] });
  }

  function beginMatch(cfg) {
    goFullscreen();
    CT.Music.setPlaying(true);
    touch = null;
    // events fired while the game is being built are ignored; the HUD is
    // refreshed below once it exists. The host also forwards every event.
    let g = null;
    g = CT.createGame({ ...cfg, firstServer: 0, onEvent: (t, d) => {
      if (!g || game !== g) return;
      onEvent(t, d);
      if (net && net.role === 'host') send({ t: 'ev', type: t, d });
    } });
    game = g;
    $('menu').hidden = true;
    $('end').hidden = true;
    $('pauseMenu').hidden = true;
    paused = false;
    layout();
    updateHud();
    hintForState();
    showMsg('First to 6', 'Tiebreak at 6–6', 'neutral');
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    // an online match can't be paused: the pause menu just sits over it
    if (game && (!paused || net)) {
      CT.updateGame(game, dt);
      if (net && net.started) {
        if (net.role === 'host' && now - net.sendT > 50) { net.sendT = now; send({ t: 'st', s: CT.snapshot(game) }); }
        if (now - net.lastHeard > 6000) { leaveOnline(false); showMenu(); showMsg('Connection lost', 'Back to the menu', 'warn'); }
      }
      updateHud();
      if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').hidden = true; }
      if (shotTimer > 0) { shotTimer -= dt; if (shotTimer <= 0) $('shot').hidden = true; }
    }
    if (game) CT.renderGame(renderer, game, me, paused ? null : CT.incomingInfo(game, me));
    requestAnimationFrame(frame);
  }

  function pickChar(id) {
    humanChar = id;
    document.querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.char === id)));
  }

  function setAutoMove(on) {
    autoMove = on;
    try { localStorage.setItem('ct.autoMove', on ? '1' : '0'); } catch (e) { /* storage is optional */ }
    document.querySelectorAll('[data-auto]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.auto === 'on') === on)));
    const pb = $('autoPause');
    pb.setAttribute('aria-pressed', String(on));
    pb.textContent = on ? 'Automove on' : 'Automove off';
    if (game && game.control[me] === 'human') CT.setAutoMove(game, me, on);
    if (isGuest()) send({ t: 'auto', on });
    hintForState();
  }

  function setMusic(on) {
    musicOn = on;
    try { localStorage.setItem('ct.music', on ? '1' : '0'); } catch (e) { /* storage is optional */ }
    document.querySelectorAll('[data-music]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.music === 'on') === on)));
    const pb = $('musicPause');
    pb.setAttribute('aria-pressed', String(on));
    pb.textContent = on ? 'Music on' : 'Music off';
    ensureAudio();
    CT.Music.setOn(on);
  }

  function setPaused(v) {
    if (!game || game.phase === 'matchOver') return;
    paused = v;
    $('pauseMenu').hidden = !v;
  }

  // preview portraits on the menu cards
  function drawPortraits() {
    document.querySelectorAll('canvas.portrait').forEach((cv) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth || 96, h = cv.clientHeight || 120;
      cv.width = w * dpr; cv.height = h * dpr;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const s = h / 2.35;
      ctx.translate(w / 2, h - 6);
      ctx.scale(s, s);
      CT.drawCharacter(ctx, cv.dataset.char, { t: performance.now() / 1000, facing: 'front', swing: -1, wing: 'fh', running: false }, 1);
    });
  }

  function init() {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp, { passive: false });
    canvas.addEventListener('pointercancel', () => { touch = null; });
    window.addEventListener('resize', () => { if (game) layout(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { setPaused(true); if (audio) audio.suspend(); }
      else if (audio) audio.resume();
    });
    document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => pickChar(b.dataset.char)));
    document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      speedSetting = parseFloat(b.dataset.speed);
      document.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    document.querySelectorAll('[data-auto]').forEach((b) => b.addEventListener('click', () => setAutoMove(b.dataset.auto === 'on')));
    $('autoPause').addEventListener('click', () => setAutoMove(!autoMove));
    setAutoMove(autoMove);
    document.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', () => setMusic(b.dataset.music === 'on')));
    $('musicPause').addEventListener('click', () => setMusic(!musicOn));
    document.querySelectorAll('[data-music]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.music === 'on') === musicOn)));
    $('musicPause').textContent = musicOn ? 'Music on' : 'Music off';
    $('play').addEventListener('click', () => { ensureAudio(); startMatch(); });
    $('rematch').addEventListener('click', startMatch);
    $('toMenu').addEventListener('click', showMenu);
    $('pauseBtn').addEventListener('click', () => setPaused(true));
    $('resume').addEventListener('click', () => setPaused(false));
    $('quit').addEventListener('click', () => { leaveFullscreen(); showMenu(); });
    $('howBtn').addEventListener('click', () => { $('help').hidden = false; });
    $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
    $('hostBtn').addEventListener('click', hostRoom);
    $('joinBtn').addEventListener('click', () => { leaveOnline(true); lobby('Enter the 4-letter code your friend sees.', '', true); $('codeInput').value = ''; $('codeInput').focus(); });
    $('lobbyGo').addEventListener('click', () => {
      const code = $('codeInput').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length === 4) joinRoom(code);
    });
    $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lobbyGo').click(); });
    $('lobbyCancel').addEventListener('click', showMenu);
    window.addEventListener('pagehide', () => leaveOnline(true));
    $('mute').addEventListener('click', () => {
      muted = !muted;
      $('mute').setAttribute('aria-pressed', String(muted));
      $('mute').textContent = muted ? 'Sound off' : 'Sound on';
    });
    pickChar('octopus');
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => { drawPortraits(); if (game) layout(); });
    drawPortraits();
    showMenu();
    requestAnimationFrame(frame);
    window.__CT_GAME = () => game;   // handy for debugging in the console
    window.__cam = renderer.cam;
  }

  init();
})();
