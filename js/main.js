// Touch input, HUD, sound and the frame loop.
(function () {
  const CT = window.CT;
  const $ = (id) => document.getElementById(id);
  const HUMAN = 0;

  const canvas = $('court');
  const renderer = CT.createRenderer(canvas);
  let game = null;
  let paused = false;
  let humanChar = 'octopus';
  let speedSetting = 0.8;
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
      const row = $('row' + side);
      row.querySelector('.name').textContent = p.ch.name + (side === HUMAN ? ' (you)' : '');
      row.querySelector('.games').textContent = m.games[side];
      row.querySelector('.pts').textContent = CT.pointLabel(m, side);
      row.querySelector('.serve').style.visibility = srv === side && !m.over ? 'visible' : 'hidden';
      row.querySelector('.stam-fill').style.width = p.stamina.toFixed(1) + '%';
      row.querySelector('.stam-cap').style.left = p.cap.toFixed(1) + '%';
      row.style.setProperty('--pc', p.ch.colors.glow);
    }
    $('callout').textContent = CT.matchCallout(m) || (m.firstServe ? '' : 'Second serve');
  }

  function hintForState() {
    if (!game) return;
    const humanServing = game.server === HUMAN;
    if (game.phase === 'preServe') setHint(humanServing ? 'Tap to toss the ball' : autoMove ? 'Get ready to return' : 'Tap the court to move into position');
    else if (game.phase === 'toss' && humanServing) setHint('Swipe as the ball tops out in the ring');
    else if (game.phase === 'rally') setHint(autoMove ? 'Swipe as the ring closes · Tap to reposition' : 'Tap to move · Swipe as the ring closes');
  }

  // ---------------- game events ----------------
  function onEvent(type, d) {
    const names = game ? game.players.map((p) => p.ch.name) : ['', ''];
    if (type === 'hit') {
      blip(d.kind === 'overhead' || d.kind === 'serve' ? 220 : 330, 0.07, 'square', 0.09, 140);
      if (d.side === HUMAN) {
        const kind = { fh: 'Forehand', bh: 'Backhand' }[d.wing];
        const label = d.kind === 'serve' ? 'Serve' : d.kind === 'overhead' ? 'Overhead' : d.kind === 'volley' ? kind + ' volley' : d.kind === 'power' ? 'Power ' + kind.toLowerCase() : d.kind === 'powerVolley' ? 'Power ' + kind.toLowerCase() + ' volley' : kind;
        const timing = d.perfect ? 'Perfect timing' : (d.errMs > 0 ? 'Late ' : 'Early ') + Math.abs(d.errMs) + ' ms';
        showShot([label, timing, d.kmh + ' km/h', d.spin, d.curve].filter(Boolean).join(' · '));
        try { navigator.vibrate && navigator.vibrate(18); } catch (e) { /* optional */ }
      }
      hintForState();
    } else if (type === 'bounce') {
      blip(120, 0.05, 'sine', 0.07);
    } else if (type === 'net') {
      blip(90, 0.12, 'sawtooth', 0.05);
    } else if (type === 'whiff') {
      if (d.side === HUMAN) showShot(d.reason);
    } else if (type === 'fault') {
      showMsg(d.text === 'Net' ? 'Net' : 'Fault', 'Second serve', 'warn');
      blip(160, 0.2, 'sawtooth', 0.05, 90);
    } else if (type === 'point') {
      const youWon = d.winner === HUMAN;
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
    $('endTitle').textContent = winner === HUMAN ? 'You win the set' : `${w} wins the set`;
    $('endScore').textContent = score;
    $('end').hidden = false;
    leaveFullscreen();
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

  function handleTap(x, y) {
    if (game.phase === 'preServe' && game.server === HUMAN) { CT.requestToss(game, HUMAN); return; }
    const w = CT.unproject(renderer, x, y);
    if (w) CT.requestMove(game, HUMAN, w.x, w.y);
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
    CT.requestSwipe(game, HUMAN, { aim, pace, over, spinDir, curve, depth });
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
    $('end').hidden = true;
    $('pauseMenu').hidden = true;
    paused = false;
    $('menu').hidden = false;
    game = CT.createGame({ p0: 'octopus', p1: 'philosopher', timeScale: 0.6, control: ['cpu', 'cpu'], onEvent: () => {} });
    layout();
  }

  function startMatch() {
    goFullscreen();
    touch = null;
    const cpuChar = humanChar === 'octopus' ? 'philosopher' : 'octopus';
    // events fired while the game is being built are ignored; the HUD is
    // refreshed below once it exists
    let g = null;
    g = CT.createGame({ p0: humanChar, p1: cpuChar, timeScale: speedSetting, firstServer: 0, autoMove: [autoMove, false], onEvent: (t, d) => { if (g && game === g) onEvent(t, d); } });
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
    if (game && !paused) {
      CT.updateGame(game, dt);
      updateHud();
      if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').hidden = true; }
      if (shotTimer > 0) { shotTimer -= dt; if (shotTimer <= 0) $('shot').hidden = true; }
    }
    if (game) CT.renderGame(renderer, game, HUMAN, paused ? null : CT.incomingInfo(game, HUMAN));
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
    if (game && game.control[HUMAN] === 'human') CT.setAutoMove(game, HUMAN, on);
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
