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
  // Chill / Club / Pro: ball speed and how well the CPU plays (CT.CPU_LEVELS)
  let level = 'club';
  try { const v = localStorage.getItem('ct.level'); if (CT.CPU_LEVELS[v]) level = v; } catch (e) { /* storage is optional */ }
  let tut = null;      // the tutorial in progress: { i: lesson index, done: reps passed }
  const SERVE_CLOCK = 20;   // seconds to start a serve in an online match
  let autoMove = true;
  try { const v = localStorage.getItem('ct.autoMove'); if (v !== null) autoMove = v === '1'; } catch (e) { /* storage is optional */ }
  let musicOn = true;
  try { const v = localStorage.getItem('ct.music'); if (v !== null) musicOn = v === '1'; } catch (e) { /* storage is optional */ }
  // Full screen during matches, where the browser supports it for pages
  // (iPhones don't). On iPads Safari can stop a match with a "typing while
  // in full screen" warning; players can switch it off there.
  const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  let fullOn = canFull;
  try { const v = localStorage.getItem('ct.full'); if (v !== null) fullOn = canFull && v === '1'; } catch (e) { /* storage is optional */ }
  // Zen mode: no HUD but the pause button, no guides; the score is on the billboard
  // Swipe sensitivity, as multipliers (1 = the original feel). Depth scales
  // the swipe's length before it picks how deep the ball goes; speed scales
  // its speed before it picks the pace (and the overhit).
  const SENS_MIN = 0.5, SENS_MAX = 2;
  const sens = { depth: 1, speed: 1 };
  try {
    const v = JSON.parse(localStorage.getItem('ct.sens'));
    for (const k of ['depth', 'speed']) if (v && Number.isFinite(v[k])) sens[k] = CT.clamp(v[k], SENS_MIN, SENS_MAX);
  } catch (e) { /* storage is optional */ }
  let zen = false;
  try { zen = localStorage.getItem('ct.zen') === '1'; } catch (e) { /* storage is optional */ }
  let view = 'chase';  // camera: 'chase' (behind and above), 'first' (your eyes) or 'vr' (Cardboard)
  try { const v = localStorage.getItem('ct.view'); if (v === 'first' || v === 'vr') view = v; } catch (e) { /* storage is optional */ }
  // Cardboard VR. vrFit fits the picture to the headset: how wide each eye
  // sees (degrees) and how far apart its lenses are (mm).
  // vrFit.gfx is the graphics level: Auto starts sharp and steps down if the phone can't keep up.
  const VR_FOV = { wide: 95, normal: 80, close: 65 }, VR_LENS = { narrow: 60, normal: 64, wide: 68 };
  const VR_GFX = { auto: 'auto', smooth: 0, balanced: 1, sharp: 2 };
  let vrFit = { fov: 'normal', lens: 'normal', gfx: 'auto' };
  try {
    const v = JSON.parse(localStorage.getItem('ct.vrFit'));
    if (v && VR_FOV[v.fov] && VR_LENS[v.lens]) vrFit = { ...vrFit, fov: v.fov, lens: v.lens, gfx: v.gfx in VR_GFX ? v.gfx : 'auto' };
  } catch (e) { /* storage is optional */ }
  // during a VR match: { head, wait (until a press starts play), press (when the button went down), ignoreUp, aim }
  let vr = null;
  // achievements and stats saved on this phone, and the tracker for the
  // match in progress (none in the tutorial)
  const ach = CT.loadAchievements();
  let tracker = null;
  // A match vs the CPU is saved after every point (localStorage 'ct.saved':
  // the players, level, score, legs and achievement progress), so leaving
  // the page or reloading it leaves a Resume button on the menu. It carries
  // on from the next point. Online matches and the tutorial aren't saved.
  const SAVE_KEY = 'ct.saved';
  let canSave = false;     // the match in progress is one that's saved
  let savedLevel = level;  // its CPU level (a resumed match keeps its own)
  let lastFrame = performance.now();
  const FRAME_MS = 1000 / 60;
  let frameDue = 0;
  let msgTimer = 0;
  let shotTimer = 0;

  // ---------------- tutorial ----------------
  // A ball machine on the far side feeds easy balls. Each lesson needs `need`
  // reps that pass `pass(d)` (d: the 'drill' event: ok, text, x/y of the
  // bounce, and the shot the player hit).
  const LESSONS = [
    { title: 'Serve', serve: true, need: 2, hint: 'Tap to toss, then swipe up as the ball tops out in the ring',
      intro: 'Tap to toss the ball, then swipe up when it tops out', pass: (d) => d.ok },
    { title: 'Forehand', wing: 'fh', need: 3, hint: 'Swipe up as the ring around the ball closes',
      intro: 'Swipe up as the ring around the ball closes', pass: (d) => d.ok },
    { title: 'Backhand', wing: 'bh', need: 2, hint: 'Same swipe on your left side. Late backhands drift left',
      intro: 'Now on your backhand side', pass: (d) => d.ok },
    { title: 'Aim left', wing: 'fh', need: 2, hint: 'Swipe up and to the left. The ball goes where you swipe',
      intro: 'Swipe towards the left of the court', pass: (d) => d.ok && d.x < -0.8 },
    { title: 'Aim right', wing: 'bh', need: 2, hint: 'Swipe up and to the right',
      intro: 'Now swipe towards the right', pass: (d) => d.ok && d.x > 0.8 },
    { title: 'Slice', wing: 'bh', need: 2, hint: 'Swipe down for backspin. Top-left to bottom-right goes left',
      intro: 'Swipe down to slice', pass: (d) => d.ok && d.shot && d.shot.spin === 'Slice' },
    { title: 'Drop shot', wing: 'fh', need: 1, hint: 'A short swipe drops the ball short. Land it in front of the service line',
      intro: 'A short swipe drops it short', pass: (d) => d.ok && d.y < CT.COURT.SL },
    { title: 'Lob', wing: 'fh', need: 1, hint: 'Swipe up slowly over a quarter of the screen or more, as the ball arrives',
      intro: 'A slow, long swipe up lobs', pass: (d) => d.ok && d.shot && d.shot.spin === 'Lob' },
    { title: 'Volley', feed: 'volley', wing: 'fh', need: 2, hint: 'At the net, swipe as the ring closes, before the ball bounces',
      intro: 'You\'re at the net: hit it out of the air', pass: (d) => d.ok && d.shot && /volley/i.test(d.shot.kind) },
    { title: 'Smash', feed: 'smash', need: 1, hint: 'Wait under the lob and swipe up hard as the ring closes',
      intro: 'A lob is coming: smash it', pass: (d) => d.ok && d.shot && d.shot.kind === 'overhead' },
    { title: 'Play a point', rally: true, need: 1, hint: 'Rally with the CPU. Move it side to side and win one point',
      intro: 'Now win a point against the CPU', pass: (d) => d.ok },
  ];

  function startTutorial() {
    me = 0;
    tut = { i: 0, done: 0 };
    runLesson();
  }

  function runLesson() {
    const L = LESSONS[tut.i];
    tut.done = 0;
    const chars = { p0: humanChar, p1: humanChar === 'octopus' ? 'philosopher' : 'octopus' };
    // the last lesson is a real point against the easiest CPU
    if (L.rally) beginMatch({ ...chars, control: ['human', 'cpu'], autoMove: [autoMove, false], ...CT.levelOpts('chill') });
    else beginMatch({ ...chars, timeScale: CT.CPU_LEVELS.chill.timeScale, control: ['human', 'feeder'], autoMove: [autoMove, false],
      drill: { serve: !!L.serve, wing: L.wing, feed: L.feed, reps: 0 } });
    showMsg(L.title, L.intro, 'neutral');
  }

  function onDrill(d) {
    const L = LESSONS[tut.i];
    if (d.ok === null) return;
    const good = L.pass(d);
    if (good) tut.done++;
    blip(good ? 520 : 200, 0.18, 'triangle', 0.07, good ? 780 : 120);
    if (tut.done < L.need) {
      showMsg(good ? 'Nice' : d.ok ? 'In, but not quite' : d.text, good ? (L.need - tut.done) + ' more' : L.hint, good ? 'good' : 'warn');
      return;
    }
    if (tut.i + 1 < LESSONS.length) {
      tut.i++;
      tut.done = 0;
      // the next lesson starts once the cheer has been seen
      const g = game;
      setTimeout(() => { if (tut && game === g) runLesson(); }, 1200);
      showMsg('Done', 'Next: ' + LESSONS[tut.i].title.toLowerCase(), 'good');
      return;
    }
    tut = null;
    // the practice point's match stops here, as a finished match would:
    // otherwise the CPU could go on serving behind this screen
    game.phase = 'matchOver';
    $('endTitle').textContent = 'Tutorial done';
    $('endScore').textContent = '';
    $('endNote').textContent = 'One more thing: running and power shots wear down the bar under your name. When it runs low you get slower and your timing gets harder. Start on Chill.';
    $('endNote').hidden = false;
    $('rematch').textContent = 'Play vs CPU';
    $('end').hidden = false;
    leaveFullscreen();
    CT.Music.setPlaying(false);
  }

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

  // Zen mode swaps the chiptune blips for sounds closer to a real court: a
  // noise burst through filters for the strings, a sine thump for the body,
  // and soft chimes for points.
  // Sounds from the far end are quieter and duller. dist is 0 at your
  // baseline and 1 at the far one.
  let sfxNoise = null;
  function noisy(t, dur, vol, type, f, q, dest) {
    if (!sfxNoise) {
      const len = audio.sampleRate * 0.5;
      sfxNoise = audio.createBuffer(1, len, audio.sampleRate);
      const d = sfxNoise.getChannelData(0);
      let s = 4242;
      for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    }
    const src = audio.createBufferSource(), fl = audio.createBiquadFilter(), gn = audio.createGain();
    src.buffer = sfxNoise;
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    gn.gain.setValueAtTime(vol * SFX_GAIN, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(fl).connect(gn).connect(dest);
    src.start(t); src.stop(t + dur + 0.02);
  }
  function thump(t, f0, f1, dur, vol, dest) {
    const o = audio.createOscillator(), gn = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(vol * SFX_GAIN, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // a lowpass for distance, feeding the limiter
  function distBus(t, dist) {
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 7500 - dist * 4500;
    lp.connect(master);
    return lp;
  }
  function distFrom(y) {
    const base = me === 0 ? -CT.COURT.HL : CT.COURT.HL;
    return Math.min(1, Math.abs(y - base) / (2 * CT.COURT.HL));
  }
  function realSfx(kind, d) {
    if (!audio || muted) return;
    try {
      const t = audio.currentTime;
      if (kind === 'hit') {
        // the striker's end; faster swings crack brighter and louder
        const dist = d.side === me ? 0 : 1;
        const pace = Math.max(0, Math.min(1, ((d.kmh || 90) - 60) / 120));
        const v = (1 - dist * 0.55) * (0.6 + pace * 0.5);
        const bus = distBus(t, dist);
        noisy(t, 0.035 + pace * 0.02, 0.11 * v, 'bandpass', 1500 + pace * 900, 1.2, bus);   // string crack
        noisy(t, 0.012, 0.08 * v, 'highpass', 4000, 0.7, bus);                                // the first click
        thump(t, 320 + pace * 120, 150, 0.06, 0.09 * v, bus);                                 // ball and frame
        if (d.perfect) thump(t, 1150, 1100, 0.09, 0.012 * v, bus);                           // sweet-spot ring
      } else if (kind === 'bounce') {
        const dist = distFrom(d.y);
        const v = 1 - dist * 0.6;
        const bus = distBus(t, dist);
        noisy(t, 0.03, 0.06 * v, 'lowpass', 1400, 0.8, bus);
        thump(t, 170, 90, 0.05, 0.08 * v, bus);
      } else if (kind === 'net') {
        noisy(t, 0.16, 0.05, 'lowpass', 700, 0.7, master);
        thump(t, 110, 60, 0.12, 0.06, master);
      } else if (kind === 'fault') {
        thump(t, 330, 300, 0.35, 0.03, master);
      } else if (kind === 'won') {
        // a soft rising chime in the zen track's key, ringing longer for a
        // game or the set
        const big = d.result === 'set' ? 2 : d.result === 'game' ? 1 : 0;
        thump(t, 440, 440, 0.6, 0.02, master);
        thump(t + 0.14, 659, 659, 0.8 + big * 0.4, 0.018, master);
      } else if (kind === 'lost') {
        // a quiet falling tone, nothing more
        thump(t, 330, 330, 0.5, 0.018, master);
        thump(t + 0.16, 262, 250, 0.7, 0.016, master);
      }
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

  // The HUD is refreshed every frame, but only what changed is written: a
  // DOM write each frame makes the browser restyle the HUD each frame too.
  const hudCache = new Map();
  function put(el, key, value, write) {
    const k = el.id + '|' + key;
    if (hudCache.get(k) === value) return;
    hudCache.set(k, value);
    write(value);
  }

  function updateHud() {
    const m = game.match;
    const srv = game.phase === 'preServe' || game.phase === 'toss' ? game.server : CT.currentServer(m);
    for (const side of [0, 1]) {
      const p = game.players[side];
      const row = $('row' + (side === me ? 0 : 1));
      const q = (sel) => row.querySelector(sel);
      put(row, 'name', p.ch.name + (side === me ? ' (you)' : '') + (p.stamina < 35 ? ' · tired' : ''), (v) => { q('.name').textContent = v; });
      put(row, 'games', String(m.games[side]), (v) => { q('.games').textContent = v; });
      put(row, 'pts', CT.pointLabel(m, side), (v) => { q('.pts').textContent = v; });
      put(row, 'serve', srv === side && !m.over ? 'visible' : 'hidden', (v) => { q('.serve').style.visibility = v; });
      put(row, 'stam', p.stamina.toFixed(1) + '%', (v) => { q('.stam-fill').style.width = v; });
      put(row, 'tired', p.stamina < 35, (v) => row.classList.toggle('tired', v));
      put(row, 'cap', p.cap.toFixed(1) + '%', (v) => { q('.stam-cap').style.left = v; });
      put(row, 'pc', p.ch.colors.glow, (v) => row.style.setProperty('--pc', v));
    }
    let call = CT.matchCallout(m) || (m.firstServe ? '' : 'Second serve');
    // the serve clock shows for its last 10 seconds
    if (game.serveClock && game.phase === 'preServe') {
      const left = game.serveClock - game.serveWait;
      if (left <= 10) call = 'Serve clock ' + Math.max(0, Math.ceil(left)) + (call ? ' · ' + call : '');
    }
    if (tut) { const L = LESSONS[tut.i]; call = `Lesson ${tut.i + 1}/${LESSONS.length} · ${L.title} · ${Math.min(tut.done, L.need)}/${L.need}`; }
    put($('callout'), 'text', call, (v) => { $('callout').textContent = v; });
    if (boardScore()) {
      const opp = 1 - me;
      CT.showScore(renderer, {
        text: CT.pointLabel(m, me) + '–' + CT.pointLabel(m, opp),
        label: m.games[me] + '–' + m.games[opp] + (call ? ' · ' + call.toUpperCase() : ''),
        server: m.over ? -1 : srv === me ? 0 : 1,
      });
    }
  }

  // Zen applies to matches, not the tutorial (its lessons live in the hints)
  // or the rally behind the menu.
  function zenOn() { return zen && !!game && !tut && $('menu').hidden; }
  // VR has no HUD either (it isn't drawn for both eyes), so it also keeps
  // the score on the billboard, but it keeps the guides
  function boardScore() { return zenOn() || !!vr; }
  function applyZen() {
    const on = zenOn();
    document.body.classList.toggle('zen', boardScore());
    CT.setZen(renderer, on);
    CT.Music.setTrack(on ? 'zen' : 'match');
    if (!boardScore()) CT.showScore(renderer, null);
    if (game) layout();
  }

  function hintForState() {
    if (!game) return;
    if (tut) { setHint(LESSONS[tut.i].hint); return; }
    const humanServing = game.server === me;
    if (game.phase === 'preServe') setHint(humanServing ? 'Tap to toss the ball' : autoMove ? 'Get ready to return' : 'Tap the court to move into position');
    else if (game.phase === 'toss' && humanServing) setHint('Swipe as the ball tops out in the ring');
    else if (game.phase === 'rally') setHint(autoMove ? 'Swipe as the ring closes · Tap to reposition' : 'Tap to move · Swipe as the ring closes');
  }

  // ---------------- game events ----------------
  // the sky billboard's word for a point, by how it ended
  const BOARD_WORDS = { Ace: ['YEAH!!', '#e4ff4a'], Winner: ['OMG!!', '#e4ff4a'], Out: ['OOPS', '#ff3f6c'], Net: ['OOPS', '#ff3f6c'], 'Double fault': ['OOPS', '#ff3f6c'] };
  const LONG_RALLY = 8;   // shots in a rally that get a WOW
  let rallyShots = 0;
  // Close calls go up on the billboard as a close-up of the ball's mark
  // against the line: outs that missed by up to CLOSE_OUT (m), ins that kept no more
  // than CLOSE_IN of the ball on the line. They stay up over the point's word.
  const CLOSE_OUT = 0.3, CLOSE_IN = 0.05;
  let lineCallShown = false;

  // Achievements go up on the billboard after the point's word, one at a time.
  const ACH_DELAY = 1.3, ACH_SECS = 2.4;
  let achQueue = [], achFreeAt = 0, achNew = [];
  function track(type, d) {
    if (!tracker || (type !== 'point' && type !== 'hit')) return;
    const res = tracker[type](d);
    const fresh = CT.recordAchievements(ach, res, tracker.mode);
    achNew.push(...fresh);
    const show = res.earned.filter((id) => fresh.includes(id) || !CT.achievement(id).common);
    if (!show.length) return;
    const now = performance.now() / 1000;
    if (!achQueue.length) achFreeAt = Math.max(achFreeAt, now + ACH_DELAY);
    achQueue.push(...show);
  }
  function showAchievements(now) {
    if (!achQueue.length || now < achFreeAt) return;
    const a = CT.achievement(achQueue.shift());
    CT.showBillboard(renderer, a.name.toUpperCase(), a.pro ? '#ffc23d' : '#25d9ff', ACH_SECS);
    achFreeAt = now + ACH_SECS;
  }

  function onEvent(type, d) {
    const names = game ? game.players.map((p) => p.ch.name) : ['', ''];
    track(type, d);
    if (type === 'point' && canSave) saveMatch();
    if (type === 'hit') {
      lineCallShown = false;
      rallyShots = d.kind === 'serve' ? 1 : rallyShots + 1;
      if (!tut && (rallyShots === LONG_RALLY || (d.perfect && d.side === me && /power|overhead/i.test(d.kind)))) CT.showBillboard(renderer, 'WOW', '#ff3fb4', 1.8);
      if (zenOn()) realSfx('hit', d); else blip(d.kind === 'overhead' || d.kind === 'serve' ? 220 : 330, 0.07, 'square', 0.09, 140);
      if (d.side === me) {
        const kind = { fh: 'Forehand', bh: 'Backhand' }[d.wing];
        const label = d.kind === 'serve' ? 'Serve' : d.kind === 'overhead' ? 'Overhead' : d.kind === 'volley' ? kind + ' volley' : d.kind === 'power' ? 'Power ' + kind.toLowerCase() : d.kind === 'powerVolley' ? 'Power ' + kind.toLowerCase() + ' volley' : kind;
        const timing = d.perfect ? 'Perfect timing'
          : d.note && Math.abs(d.errMs) < 15 ? d.note
          : (d.errMs > 0 ? 'Late ' : 'Early ') + Math.abs(d.errMs) + ' ms' + (d.note ? ' · ' + d.note : '');
        showShot([label, timing, d.overhit && 'Overhit', d.kmh + ' km/h', d.spin, d.curve].filter(Boolean).join(' · '));
        try { navigator.vibrate && navigator.vibrate(18); } catch (e) { /* optional */ }
      }
      hintForState();
    } else if (type === 'bounce') {
      if (zenOn()) realSfx('bounce', d); else blip(120, 0.05, 'sine', 0.07);
      if (net && net.role === 'guest') game.marks.push({ x: d.x, y: d.y, age: 0 });
    } else if (type === 'lineCall') {
      if (d.m > CLOSE_OUT || d.m < -CLOSE_IN) return;
      CT.showLineCall(renderer, d, 3);
      lineCallShown = true;
    } else if (type === 'net') {
      if (zenOn()) realSfx('net', d); else blip(90, 0.12, 'sawtooth', 0.05);
    } else if (type === 'whiff') {
      if (d.side === me) showShot(d.reason);
    } else if (type === 'fault') {
      if (boardScore()) CT.showBillboard(renderer, d.text === 'Net' || d.text === 'Serve clock' ? d.text.toUpperCase() : 'FAULT', '#ffc23d', 1.6);
      showMsg(d.text === 'Net' || d.text === 'Serve clock' ? d.text : 'Fault', 'Second serve', 'warn');
      if (zenOn()) realSfx('fault', d); else blip(160, 0.2, 'sawtooth', 0.05, 90);
    } else if (type === 'point') {
      if (tut) { onDrill({ ok: d.winner === me, text: d.winner === me ? 'Point' : d.text }); updateHud(); return; }
      const youWon = d.winner === me;
      let sub = names[d.winner] + ' wins the point';
      if (d.result === 'game') sub = names[d.winner] + ' takes the game';
      if (d.result === 'set') sub = names[d.winner] + ' wins the set';
      showMsg(d.text, sub, youWon ? 'good' : 'bad');
      const word = BOARD_WORDS[d.text];
      if (word && !lineCallShown) CT.showBillboard(renderer, word[0], word[1], 2.6);
      if (zenOn()) realSfx(youWon ? 'won' : 'lost', d); else blip(youWon ? 520 : 200, 0.25, 'triangle', 0.08, youWon ? 780 : 120);
      updateHud();
    } else if (type === 'serveReady') {
      lineCallShown = false;
      updateHud();
      hintForState();
    } else if (type === 'matchOver') {
      endMatch(d.winner);
    } else if (type === 'toss') {
      hintForState();
    } else if (type === 'drill') {
      if (tut) onDrill(d);
    }
  }

  function saveMatch() {
    if (game.match.over) { clearSaved(); return; }
    const s = { p0: game.players[0].ch.id, p1: game.players[1].ch.id, level: savedLevel,
      game: CT.saveGameState(game), tracker: tracker && tracker.state() };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* storage is optional */ }
  }
  function clearSaved() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage is optional */ }
  }
  function loadSaved() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      const m = s && s.game && s.game.match;
      if (m && !m.over && CT.CHARACTERS[s.p0] && CT.CHARACTERS[s.p1] && CT.CPU_LEVELS[s.level]
        && Array.isArray(m.games) && Array.isArray(m.points) && Array.isArray(s.game.stamina)) return s;
    } catch (e) { /* storage is optional */ }
    return null;
  }
  // the Resume button on the menu, with the score of the saved match
  function showSaved() {
    const s = loadSaved(), btn = $('resumeMatch');
    btn.hidden = !s;
    $('play').classList.toggle('primary', !s);
    if (!s) return;
    const m = s.game.match, name = (id) => CT.CHARACTERS[id].name;
    const pts = m.tiebreak ? m.points.join('–') : m.points[0] + m.points[1] ? CT.pointLabel(m, 0) + '–' + CT.pointLabel(m, 1) : '';
    $('resumeScore').textContent = [`${name(s.p0)} ${m.games[0]}–${m.games[1]} ${name(s.p1)}`, pts, s.level[0].toUpperCase() + s.level.slice(1)].filter(Boolean).join(' · ');
  }
  function resumeMatch() {
    const s = loadSaved();
    if (!s) { showSaved(); return; }
    me = 0;
    tut = null;
    savedLevel = s.level;
    canSave = true;
    beginMatch({ p0: s.p0, p1: s.p1, control: ['human', 'cpu'], autoMove: [autoMove, false], ...CT.levelOpts(s.level),
      resume: s.game, trackerState: s.tracker, mode: s.level });
  }

  function endMatch(winner) {
    const m = game.match;
    const w = game.players[winner].ch.name;
    const score = `${m.games[winner]}–${m.games[1 - winner]}` + (m.tiebreak ? ` (${m.points[winner]}–${m.points[1 - winner]})` : '');
    $('endTitle').textContent = winner === me ? 'You win the set' : `${w} wins the set`;
    $('endScore').textContent = score;
    const fresh = achNew.map((id) => CT.achievement(id).name);
    $('endNote').textContent = fresh.length ? 'Unlocked: ' + fresh.join(', ') : '';
    $('endNote').hidden = !fresh.length;
    $('rematch').textContent = 'Rematch';
    $('end').hidden = false;
    // in a headset the result goes up in each eye instead, with a choice of
    // what next (the end screen waits behind it for Exit VR)
    if (vr) vr.end = { title: $('endTitle').textContent.toUpperCase(), score, note: $('endNote').textContent };
    else leaveFullscreen();
    CT.Music.setPlaying(false);
  }

  // ---------------- input ----------------
  let touch = null;
  function onDown(e) {
    ensureAudio();
    if (audio && audio.state === 'suspended') audio.resume();
    if (vr) { e.preventDefault(); vrPress(); return; }
    if (!game || paused || touch) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional: the swipe still works without it */ }
    touch = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    e.preventDefault();
  }
  function onMove(e) {
    if (!touch || e.pointerId !== touch.id) return;
    touch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    e.preventDefault();
  }
  function onUp(e) {
    if (vr) { e.preventDefault(); vrRelease(); return; }
    if (!touch || e.pointerId !== touch.id) return;
    touch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const pts = touch.pts;
    touch = null;
    e.preventDefault();
    if (net && net.held) return;   // paused for lag
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    const dur = Math.max(1, b.t - a.t);
    // A quick touch that barely moved is a tap. One held still for longer is
    // a swipe the player thought better of, so it does nothing.
    if (chord < 30) { if (dur < 400) handleTap(b.x, b.y); return; }
    handleSwipe(pts, dx, dy, chord, dur, Math.min(window.innerWidth, window.innerHeight));
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
  // A lob: an upward swipe at least LOB_LEN screens long, averaging under
  // LOB_SPEED screens a second.
  const LOB_LEN = 0.22, LOB_SPEED = 1.4;

  // `dim` is the screen's short side in the same units as `pts`. `late`
  // (seconds) is how long the swipe took to get here from a swipe pad.
  function handleSwipe(pts, dx, dy, chord, dur, dim, late) {
    const end = pts[pts.length - 1];
    let k = pts.length - 1;
    while (k > 0 && end.t - pts[k].t < 110) k--;
    const tail = Math.hypot(end.x - pts[k].x, end.y - pts[k].y) / Math.max(16, end.t - pts[k].t);
    const v = Math.max(tail, chord / dur) * 1000;                // px per second
    const u = v / dim * sens.speed;  // screens per second, after the speed setting
    // A normal phone flick (about half the screen in ~150 ms) is close to full pace.
    const pace = CT.clamp((u - 0.7) / (3.8 - 0.7), 0, 1);
    // Swipe length sets depth: a short swipe drops the ball short, a swipe
    // of about 40% of the screen or more goes to the baseline.
    // The depth setting scales the length first.
    const depth = CT.clamp((chord / dim * sens.depth - 0.1) / 0.3, 0, 1);
    const over = CT.clamp((u - 7) / 4, 0, 1);
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
      const d = ((p.x - pts[0].x) * nx + (p.y - pts[0].y) * ny) / chord;
      if (Math.abs(d) > Math.abs(bulge)) bulge = d;
    }
    if (Math.abs(bulge) < 0.04) bulge = 0;
    const curve = -CT.clamp(bulge * 5, -1, 1);
    aim += CT.clamp(bulge * 0.45, -0.12, 0.12);
    // A slice is swiped the other way: top-left to bottom-right goes left.
    if (spinDir < 0) aim = -aim;
    // (a swipe pad's swipe has nothing to do with the view in the headset)
    const input = { aim, pace, over, spinDir, curve, depth, landX: vr ? undefined : pointAt(aim), lob };
    // A slow swipe is still going when the ball arrives: its timing counts
    // from partway through, not from when the finger lifts.
    // And it always goes deep, however long the swipe: a short lob is just a
    // smash for them.
    if (lob) { input.lead = dur / 2000; input.depth = 1; }
    playShot(input, late);
  }

  // Hit `input` (as CT.requestSwipe takes it) now, or as if `late` seconds
  // ago (a swipe from the swipe pad, timed from when the finger let go).
  function playShot(input, late) {
    const back = (late || 0) * game.timeScale;
    if (isGuest()) {
      // judge timing here, against the ball this player saw, play the shot
      // on this screen straight away, then send it to the host
      const tm = CT.swipeTiming(game, me);
      if (!tm) return;
      if (tm.whiff) { showShot(tm.whiff); return; }
      CT.predictSwipe(game, me, input, tm.err - back);
      send({ t: 'in', k: 'swipe', input, err: tm.err - back });
      return;
    }
    const tm = back > 0 ? CT.swipeTiming(game, me) : null;
    if (tm && !tm.whiff) CT.requestSwipe(game, me, input, tm.err - back);
    else CT.requestSwipe(game, me, input);
  }

  // ---------------- VR ----------------
  // The headset's button arrives as a touch (or the space bar, or a
  // gamepad's A). Press before play starts: that way is straight down the
  // court. Press looking at your feet: pause. On your serve a press tosses.
  // Otherwise letting go hits, and a long enough hold makes it a power shot;
  // where it goes is picked for you.
  function vrPress() {
    if (game && (paused || vr.end)) { vr.ignoreUp = true; vrMenuPick(); return; }
    if (!game || vr.press !== null) return;
    vr.ignoreUp = true;
    if (vr.wait) {
      CT.VR.recentre(vr.head);
      vr.wait = false;
      goFullscreen('landscape');
      return;
    }
    if (net && net.held) return;   // paused for lag
    const pitch = CT.VR.headPose(vr.head).pitch;
    if (pitch < CT.VR.PAUSE_PITCH) { setPaused(true); return; }
    if (pitch > CT.VR.RECENTRE_PITCH) { vrRecentre(); return; }
    if (game.phase === 'preServe' && game.server === me) {
      if (isGuest()) send({ t: 'in', k: 'toss' }); else CT.requestToss(game, me);
      return;
    }
    vr.ignoreUp = false;
    vr.press = performance.now();
  }

  // The pause menu in the headset: three choices around you, picked by
  // turning to one and pressing.
  // The same at the end of a match, with Rematch in the middle.
  const VR_MENU = [{ id: 'exit', label: 'EXIT VR', yaw: -0.55 }, { id: 'resume', label: 'RESUME', yaw: 0 }, { id: 'quit', label: 'QUIT', yaw: 0.55 }];
  const VR_END_MENU = [{ id: 'exit', label: 'EXIT VR', yaw: -0.55 }, { id: 'rematch', label: 'REMATCH', yaw: 0 }, { id: 'quit', label: 'MENU', yaw: 0.55 }];
  function vrMenuChoice() {
    const items = vr.end ? VR_END_MENU : VR_MENU, yaw = CT.VR.headPose(vr.head).yaw;
    let best = items[1];
    for (const it of items) if (Math.abs(yaw - it.yaw) < Math.abs(yaw - best.yaw)) best = it;
    return best;
  }
  function vrMenuPick() {
    const it = vrMenuChoice();
    if (it.id === 'resume') setPaused(false);
    else if (it.id === 'rematch') startMatch();
    else if (it.id === 'quit') { leaveFullscreen(); showMenu(); }
    else if (vr.end) {
      // to the normal end screen
      exitVR();
      setView('chase');
      layout();
      leaveFullscreen();
    } else {
      // back to the normal screen, still paused, to carry on when ready
      exitVR();
      setView('chase');
      layout();
      goFullscreen('portrait');
      setPaused(true);
    }
  }

  // Straight ahead becomes the way you face: at once (the pad's Recentre,
  // or R on a keyboard), or at your next press, once you've looked back
  // down the court (looking up at the sky and pressing, or the pause
  // menu's Recentre). Only the turn changes: up and down come from gravity.
  function vrRecentre(now) {
    if (!vr) return;
    vr.press = null;
    if (now === true && !vr.wait) { CT.VR.recentre(vr.head); blip(880, 0.08, 'sine', 0.06); return; }
    vr.wait = true;
    if (paused) setPaused(false);
  }

  function vrRelease() {
    if (vr.ignoreUp) { vr.ignoreUp = false; return; }
    if (vr.press === null) return;
    const hold = (performance.now() - vr.press) / 1000;
    vr.press = null;
    if (!game || paused || (net && net.held)) return;
    playShot(CT.VR.autoShot(game, me, hold >= CT.VR.POWER_HOLD));
  }

  // the countdown's beeps: [seconds before the moment to let go, pitch]
  const VR_TICKS = [[0.5, 660], [0.25, 660], [0, 1320]];

  // VR is for matches; the tutorial's lessons need their hints on screen.
  function enterVR() {
    if (!vr) {
      vr = { head: CT.VR.createHead(), wait: true, press: null, ignoreUp: false, pad: false, lastT: null };
      CT.VR.startHead(vr.head);
      CT.VR.keepAwake(true);
      document.body.classList.add('vr');
    }
    vr.wait = true; vr.press = null; vr.end = null;
    CT.setVR(renderer, { fov: VR_FOV[vrFit.fov], lens: VR_LENS[vrFit.lens], gfx: VR_GFX[vrFit.gfx] });
    // in a headset you can only look and press, so automove always runs
    if (game.control[me] === 'human') CT.setAutoMove(game, me, true);
    if (isGuest()) send({ t: 'auto', on: true });
  }

  function exitVR() {
    if (!vr) return;
    CT.VR.stopHead(vr.head);
    CT.VR.keepAwake(false);
    vr = null;
    document.body.classList.remove('vr');
    CT.setVR(renderer, null);
    if (game && game.control[me] === 'human') CT.setAutoMove(game, me, autoMove);
    if (isGuest()) send({ t: 'auto', on: autoMove });
    applyZen();
  }

  // Each frame: the head turns the view, a gamepad's A is the button too,
  // and the eyes show what to do.
  function vrFrame() {
    const v = renderer.vr, pose = CT.VR.headPose(vr.head);
    v.yaw = pose.yaw; v.pitch = pose.pitch; v.roll = pose.roll;
    let down = false;
    try { for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp && gp.buttons[0] && gp.buttons[0].pressed) down = true; } catch (e) { /* no gamepads here */ }
    if (down !== vr.pad) { vr.pad = down; if (down) vrPress(); else vrRelease(); }
    v.charge = vr.press === null ? 0 : Math.min(1, (performance.now() - vr.press) / 1000 / CT.VR.POWER_HOLD);
    // a countdown you can hear wherever you're looking: two ticks, then a
    // higher one on the moment to let go
    const hit = !paused && !vr.wait ? CT.VR.timeToHit(game, me, CT.incomingInfo(game, me)) : null;
    if (hit && hit.reach && vr.lastT !== null) {
      for (const [at, freq] of VR_TICKS) if (vr.lastT > at && hit.t <= at) blip(freq, 0.06, 'sine', 0.06);
    }
    vr.lastT = hit && hit.reach ? hit.t : null;
    v.prompt = ''; v.sub = '';
    v.menu = vr.end ? { items: VR_END_MENU, sel: vrMenuChoice().id } : paused ? { items: VR_MENU, sel: vrMenuChoice().id } : null;
    if (vr.end) { v.prompt = vr.end.title + ' ' + vr.end.score; v.sub = (vr.end.note ? vr.end.note + ' · ' : '') + 'Turn to choose, press to pick'; }
    else if (paused) { v.prompt = 'PAUSED'; v.sub = 'Turn to choose, press to pick'; }
    else if (window.innerHeight > window.innerWidth) { v.prompt = 'TURN SIDEWAYS'; v.sub = 'Hold the phone in landscape'; }
    else if (vr.wait) { v.prompt = 'LOOK DOWN THE COURT'; v.sub = pad && pad.linked ? 'Tap the pad to play' : 'Press the button to play'; }
    else if (pose.pitch < CT.VR.PAUSE_PITCH) { v.prompt = 'PAUSE?'; v.sub = 'Press to pause'; }
    else if (pose.pitch > CT.VR.RECENTRE_PITCH) { v.prompt = 'RECENTRE?'; v.sub = 'Press, then look down the court'; }
  }

  // ---------------- swipe pad ----------------
  // A second phone, held in your hand, as a swipe pad for the phone in the
  // headset: its swipes play exactly like swipes on the normal screen, and
  // a tap is the headset's button. The two phones pair through the online
  // relay with a room code of their own, so this works next to an online
  // match too. The headset phone measures the lag to the pad and takes it
  // off the swipe's timing, so a swipe counts from when the finger let go.
  let pad = null;      // on the headset phone: { code, link, linked, lag, timer, lastHeard }
  let padSide = null;  // on the pad phone: { code, link, linked, timer, lastHeard }
  let lobbyMode = null;  // 'pad' while the lobby screen is pairing a swipe pad
  const PAD_LOST = 4000;   // ms of silence before the link counts as lost

  function padStatus() {
    const on = !!(pad && pad.linked);
    $('padHost').textContent = on ? 'Unlink pad' : 'Link a phone';
    $('padState').textContent = on ? `Swipe pad linked (room ${pad.code}). Swipe on it to hit, tap it for the button.` : pad ? 'Waiting for the pad phone…' : 'Optional: a second phone in your hand as a swipe pad.';
  }

  function unlinkPad() {
    if (!pad) return;
    pad.link.send({ t: 'bye' });
    clearInterval(pad.timer);
    pad.link.close();
    pad = null;
    padStatus();
  }

  function hostPad() {
    if (pad) { unlinkPad(); return; }
    ensureAudio();
    const code = CT.Net.makeCode();
    const p = { code, linked: false, lag: CT.Net.createLagMeter(), lastHeard: performance.now() };
    pad = p;
    p.link = CT.Net.connect(code, 'host', (m) => onPadMsg(p, m), (st) => {
      if (pad !== p || p.linked || st === 'open') return;
      if (st === 'full') { unlinkPad(); hostPad(); return; }
      lobby("Couldn't reach the online server. Check your connection and try again.", '', false);
    });
    p.timer = setInterval(() => {
      if (pad !== p || !p.linked) return;
      const now = performance.now();
      p.lag.sent(now);
      p.link.send({ t: 'ping', at: now });
      if (now - p.lastHeard > PAD_LOST) { p.linked = false; padStatus(); showMsg('Swipe pad lost', 'Use the headset button', 'warn'); }
    }, CT.Net.PING_EVERY);
    lobbyMode = 'pad';
    lobby('On the phone for your hand, open the game, pick VR under Camera, tap "Be the pad" and enter this code.', code, false);
    padStatus();
  }

  function onPadMsg(p, m) {
    if (pad !== p || !m) return;
    p.lastHeard = performance.now();
    if (m.t === 'hello') {
      p.link.send({ t: 'padok' });
      if (!p.linked) {
        p.linked = true;
        padStatus();
        if (lobbyMode === 'pad') { lobbyMode = null; $('lobby').hidden = true; $('menu').hidden = false; }
        showMsg('Swipe pad linked', 'Swipe on it to hit', 'neutral');
      }
      return;
    }
    if (m.t === 'ping') { p.link.send({ t: 'pong', at: m.at }); return; }
    if (m.t === 'pong') { if (Number.isFinite(m.at)) p.lag.answered(m.at, performance.now()); return; }
    if (m.t === 'bye') { p.linked = false; padStatus(); return; }
    if (!p.linked || !vr || !game) return;
    if (m.t === 'recentre') { vrRecentre(true); return; }
    if (m.t === 'tap') {
      vrPress(); vrRelease();
      return;
    }
    if (m.t === 'swipe' && Array.isArray(m.pts) && m.pts.length >= 2 && m.pts.length <= 64) {
      if (paused || vr.wait || (net && net.held)) return;
      const pts = m.pts.map((q) => ({ x: +q[0], y: +q[1], t: +q[2] }));
      if (!pts.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.t))) return;
      const a = pts[0], b = pts[pts.length - 1];
      const dx = b.x - a.x, dy = b.y - a.y, chord = Math.hypot(dx, dy);
      if (chord <= 0) return;
      // half the round trip is the trip here (capped, in case of a spike)
      const late = Math.min(0.2, p.lag.state(performance.now()).ms / 2000);
      handleSwipe(pts, dx, dy, chord, Math.max(1, b.t - a.t), 1, late);
    }
  }

  // The pad phone: a dark screen to swipe on. Points go across as fractions
  // of the screen's short side, so phones of any size swipe the same.
  function joinPad(code) {
    ensureAudio();
    leavePad();
    const s = { code, linked: false, lastHeard: performance.now() };
    padSide = s;
    s.link = CT.Net.connect(code, 'guest', (m) => {
      if (padSide !== s || !m) return;
      s.lastHeard = performance.now();
      if (m.t === 'padok' && !s.linked) { s.linked = true; showPad(); }
      else if (m.t === 'ping') s.link.send({ t: 'pong', at: m.at });
      else if (m.t === 'bye') { leavePad(); showMenu(); showMsg('Headset phone unlinked', '', 'warn'); }
    }, (st) => {
      if (padSide !== s || s.linked || st === 'open') return;
      lobby(st === 'full' ? 'Room ' + code + ' already has a pad.' : "Couldn't reach the online server. Check your connection and try again.", '', true);
    });
    lobbyMode = 'pad';
    lobby('Linking to room ' + code + '…', '', false);
    const t0 = performance.now();
    s.timer = setInterval(() => {
      if (padSide !== s) return;
      const now = performance.now();
      if (!s.linked) {
        s.link.send({ t: 'hello' });
        if (now - t0 > 8000) lobby('No answer from room ' + code + '. Check the code on the headset phone.', '', true);
      } else $('padLost').hidden = now - s.lastHeard < PAD_LOST;
    }, 500);
    s.link.send({ t: 'hello' });
  }

  function showPad() {
    lobbyMode = null;
    $('lobby').hidden = true;
    $('menu').hidden = true;
    $('pad').hidden = false;
    $('padLost').hidden = true;
    CT.VR.keepAwake(true);
    goFullscreen('portrait');
  }

  function leavePad() {
    if (!padSide) return;
    clearInterval(padSide.timer);
    padSide.link.send({ t: 'bye' });
    padSide.link.close();
    padSide = null;
    $('pad').hidden = true;
    CT.VR.keepAwake(false);
  }

  let padTouch = null, padFingers = 0, padTwo = false;
  function padDown(e) {
    if (e.target.closest && e.target.closest('button')) return;   // Leave
    e.preventDefault();
    padFingers++;
    // a second finger down: a two-finger tap, which recentres
    if (padTouch) { padTwo = true; return; }
    padTwo = false;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    padTouch = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
  }
  function padMove(e) {
    if (!padTouch || e.pointerId !== padTouch.id) return;
    e.preventDefault();
    padTouch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  }
  function padUp(e) {
    padFingers = Math.max(0, padFingers - 1);
    if (padTwo) {
      if (padFingers === 0) {
        padTwo = false;
        const quick = padTouch && performance.now() - padTouch.pts[0].t < 600;
        padTouch = null;
        if (quick && padSide && padSide.linked) { padSide.link.send({ t: 'recentre' }); buzz([20, 60, 20]); }
      }
      return;
    }
    if (!padTouch || e.pointerId !== padTouch.id) return;
    e.preventDefault();
    padTouch.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    const pts = padTouch.pts;
    padTouch = null;
    if (!padSide || !padSide.linked) return;
    const a = pts[0], b = pts[pts.length - 1];
    const dim = Math.min(window.innerWidth, window.innerHeight);
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    // the same tap-or-swipe rule as the game screen
    if (chord < 30) {
      if (b.t - a.t < 400) { padSide.link.send({ t: 'tap' }); buzz(15); }
      return;
    }
    // at most 64 points: keep every nth, and always the last
    const step = Math.ceil(pts.length / 60);
    const keep = pts.filter((q, i) => i % step === 0 || i === pts.length - 1);
    const r = (v) => Math.round(v * 1000) / 1000;
    padSide.link.send({ t: 'swipe', pts: keep.map((q) => [r((q.x - a.x) / dim), r((q.y - a.y) / dim), Math.round(q.t - a.t)]) });
    buzz(25);
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* optional */ } }

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
    if (net.held) { $('msg').hidden = true; msgTimer = 0; }
    net = null;
    me = 0;
    CT.showPing(renderer, null);
  }

  function onNet(m) {
    if (!net) return;
    net.lastHeard = performance.now();
    if (m.t === 'bye') { leaveOnline(false); showMenu(); showMsg('Opponent left', 'Back to the menu', 'warn'); return; }
    if (m.t === 'ping') { send({ t: 'pong', at: m.at }); return; }
    if (m.t === 'pong') { if (net.lag && Number.isFinite(m.at)) net.lag.answered(m.at, performance.now()); return; }
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
        net.lastSnap = performance.now();
        startPings();
        me = 1;
        $('lobby').hidden = true;
        beginMatch({ p0: m.p0, p1: m.p1, timeScale: m.timeScale, control: ['remote', 'human'], remote: true, serveClock: m.serveClock });
      } else if (m.t === 'st' && game && game.remote) {
        net.lastSnap = performance.now();
        net.hostHeld = !!m.held;
        const was = game.phase + game.server;
        CT.applySnapshot(game, m.s);
        // events arrive just before the state they belong to, so the hint
        // is worked out again once that state is here
        if (game.phase + game.server !== was) hintForState();
      } else if (m.t === 'ev' && game && game.remote) {
        // this phone already played its own shot when the swipe was made
        if (m.type === 'hit' && m.d.side === me && game.predicted) return;
        if (m.type === 'whiff' && m.d.side === me) CT.cancelPrediction(game);
        onEvent(m.type, m.d);
      }
    }
  }

  // Both phones ping each other every half second to measure the lag.
  function startPings() {
    clearInterval(net.timer);
    net.lag = CT.Net.createLagMeter();
    net.held = false;
    net.timer = setInterval(() => {
      const now = performance.now();
      net.lag.sent(now);
      send({ t: 'ping', at: now });
    }, CT.Net.PING_EVERY);
  }

  // Is the online match paused for lag? The host decides from its own ping
  // and sends that with each snapshot; the guest also stops if the host's
  // snapshots stop coming. The ping goes up on the billboard over 150 ms
  // (all the time with ?ping in the page URL), saying whether the phones
  // have a direct link or go through the relay.
  const alwaysPing = /[?&]ping\b/.test(location.search);
  function checkLag(now) {
    const st = net.lag.state(now);
    const held = game.phase !== 'matchOver' && (net.role === 'host' ? st.held : !!net.hostHeld || now - net.lastSnap > CT.Net.LAG.pause);
    // the number on the sign changes at most four times a second
    if (!net.shown || now - net.shown.at > 250 || held !== net.held) net.shown = { at: now, ms: Math.round(st.ms / 10) * 10 };
    CT.showPing(renderer, st.level || held || alwaysPing ? { ms: net.shown.ms, red: st.level === 'red' || held, slow: !!st.level, held, direct: net.link.direct() } : null);
    if (held !== net.held) {
      net.held = held;
      if (held) { showMsg('Paused', 'Slow connection', 'warn'); msgTimer = Infinity; }
      else showMsg('Play on', '', 'neutral');
    }
    return held;
  }

  // only matters before the match starts; mid-match the 6 s silence check handles it
  function onLink(n, status) {
    if (net !== n || net.started || status === 'open') return;
    clearInterval(net.timer);
    if (status === 'full') {
      // (a host whose new code is somehow taken just picks another)
      if (net.role === 'host') hostRoom();
      else lobby('Room ' + net.code + ' already has two players.', '', true);
      return;
    }
    lobby("Couldn't reach the online server. Check your connection and try again.", '', net.role === 'guest');
  }

  function hostRoom() {
    ensureAudio();
    leaveOnline(true);
    lobbyMode = null;
    const code = CT.Net.makeCode();
    net = { role: 'host', code, started: false, lastHeard: performance.now(), sendT: 0 };
    const n = net;
    net.link = CT.Net.connect(code, 'host', onNet, (st) => onLink(n, st));
    lobby('Send this code to a friend. The match starts as soon as they join.', code, false);
  }

  function joinRoom(code) {
    ensureAudio();
    leaveOnline(true);
    lobbyMode = null;
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
    startPings();
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
    if (vr) { CT.resizeRenderer(renderer, W, H, 0, 0, 0); return; }
    const hud = $('hud').getBoundingClientRect();
    // leave a band of open sky between the scoreboard and the roof edge
    CT.resizeRenderer(renderer, W, H, hud.bottom + Math.min(80, H * 0.08), 56, hud.bottom);
  }

  // Fill the screen when a match starts (browsers only allow this from a
  // tap), turned the way the view needs (landscape for VR).
  function goFullscreen(orient) {
    const lock = () => { try { screen.orientation.lock(orient || 'portrait').catch(() => {}); } catch (e) { /* optional */ } };
    const el = document.documentElement;
    if (!fullOn) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) { lock(); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(lock).catch(() => {});
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
    exitVR();
    showFull(fullOn);
    leaveOnline(true);
    tut = null;
    canSave = false;
    showSaved();
    tracker = null;
    achQueue = [];
    $('lobby').hidden = true;
    CT.Music.setPlaying(false);
    $('end').hidden = true;
    $('pauseMenu').hidden = true;
    paused = false;
    $('menu').hidden = false;
    game = CT.createGame({ p0: 'octopus', p1: 'philosopher', timeScale: 0.6, control: ['cpu', 'cpu'], onEvent: () => {} });
    applyZen();
  }

  // Play vs CPU, or Rematch (online, the host restarts for both).
  function startMatch() {
    if (net) {
      if (net.role === 'host') hostStart(); else send({ t: 'rematch' });
      return;
    }
    me = 0;
    tut = null;
    clearSaved();
    savedLevel = level;
    canSave = true;
    const cpuChar = humanChar === 'octopus' ? 'philosopher' : 'octopus';
    beginMatch({ p0: humanChar, p1: cpuChar, control: ['human', 'cpu'], autoMove: [autoMove, false], ...CT.levelOpts(level) });
  }

  function beginMatch(cfg) {
    // a room code box left focused would keep the on-screen keyboard live
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const inVR = view === 'vr' && !cfg.drill;
    goFullscreen(inVR ? 'landscape' : 'portrait');
    showFull(isFullscreen());   // turns on when the browser says it went full screen
    CT.Music.setPlaying(true);
    touch = null;
    // events fired while the game is being built are ignored; the HUD is
    // refreshed below once it exists. The host also forwards every event.
    let g = null;
    tracker = tut || cfg.drill ? null : CT.createAchievementTracker(me, net ? 'online' : cfg.mode || level, cfg.trackerState);
    achQueue = []; achNew = [];
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
    if (inVR) enterVR(); else exitVR();
    applyZen();
    updateHud();
    hintForState();
    if (cfg.resume) {
      const m = g.match;
      showMsg('Match resumed', `${m.games[me]}–${m.games[1 - me]}` + (m.tiebreak ? ' · Tiebreak' : ''), 'neutral');
    } else if (!cfg.drill) showMsg('First to 6', 'Tiebreak at 6–6', 'neutral');
  }

  function frame(now) {
    // 60 frames a second at most: a 90 or 120 Hz phone would otherwise draw
    // the whole scene up to twice as often for little gain
    if (now < frameDue - 2) { requestAnimationFrame(frame); return; }
    frameDue = now - frameDue > 50 ? now + FRAME_MS : frameDue + FRAME_MS;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    // an online match can't be paused: the pause menu just sits over it.
    // It does stop while the link is too slow to play on.
    if (vr && game) vrFrame();
    // (in VR a match waits for its first press, except online, where it can't wait)
    if (game && (!paused || net) && !(vr && vr.wait && !net)) {
      const held = !!(net && net.started && net.lag) && checkLag(now);
      if (!held) CT.updateGame(game, dt);
      if (net && net.started) {
        if (net.role === 'host' && now - net.sendT > 50) { net.sendT = now; send({ t: 'st', s: CT.snapshot(game), held }); }
        if (now - net.lastHeard > 6000) { leaveOnline(false); showMenu(); showMsg('Connection lost', 'Back to the menu', 'warn'); }
      }
      updateHud();
      if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').hidden = true; }
      if (shotTimer > 0) { shotTimer -= dt; if (shotTimer <= 0) $('shot').hidden = true; }
      showAchievements(now / 1000);
    }
    if (game) {
      // draw the ball where it's shown (online it can lag the real one briefly)
      const info = paused ? null : CT.incomingInfo(game, me), ball = game.ball;
      const land = paused || zenOn() ? null : CT.landingFor(game, me, info);
      game.ball = CT.viewBall(game);
      try { CT.renderGame(renderer, game, me, info, land); } finally { game.ball = ball; }
    }
    requestAnimationFrame(frame);
  }

  function pickChar(id) {
    humanChar = id;
    document.querySelectorAll('.pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.char === id)));
  }

  function setAutoMove(on) {
    autoMove = on;
    try { localStorage.setItem('ct.autoMove', on ? '1' : '0'); } catch (e) { /* storage is optional */ }
    document.querySelectorAll('[data-auto]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
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
    document.querySelectorAll('[data-music]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    const pb = $('musicPause');
    pb.setAttribute('aria-pressed', String(on));
    pb.textContent = on ? 'Music on' : 'Music off';
    ensureAudio();
    CT.Music.setOn(on);
  }

  function inMatch() { return !!game && $('menu').hidden; }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  // In a match the buttons show whether the page really is full screen (the
  // browser can leave it on its own, e.g. when switching apps); in the menu
  // they show the setting.
  function showFull(on) {
    document.querySelectorAll('[data-full]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    const pb = $('fullPause');
    pb.setAttribute('aria-pressed', String(on));
    pb.textContent = on ? 'Full screen on' : 'Full screen off';
  }

  function setFull(on) {
    fullOn = on;
    try { localStorage.setItem('ct.full', on ? '1' : '0'); } catch (e) { /* storage is optional */ }
    showFull(on);
    // from the pause menu, the tap itself can go full screen
    if (!on) leaveFullscreen(); else if (inMatch()) goFullscreen(vr ? 'landscape' : 'portrait');
  }

  function setSens(k, pct) {
    sens[k] = CT.clamp(pct / 100, SENS_MIN, SENS_MAX);
    try { localStorage.setItem('ct.sens', JSON.stringify(sens)); } catch (e) { /* storage is optional */ }
    showSens();
  }
  function showSens() {
    for (const k of ['depth', 'speed']) {
      const pct = Math.round(sens[k] * 100);
      document.querySelectorAll(`[data-sens="${k}"]`).forEach((r) => { r.value = String(pct); });
      document.querySelectorAll(`[data-sens-out="${k}"]`).forEach((o) => { o.textContent = pct + '%'; });
    }
  }

  function setZen(on) {
    zen = on;
    try { localStorage.setItem('ct.zen', on ? '1' : '0'); } catch (e) { /* storage is optional */ }
    document.querySelectorAll('[data-zen]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    const pb = $('zenPause');
    pb.setAttribute('aria-pressed', String(on));
    pb.textContent = on ? 'Zen mode on' : 'Zen mode off';
    applyZen();
  }

  function setView(v) {
    view = v;
    try { localStorage.setItem('ct.view', v); } catch (e) { /* storage is optional */ }
    CT.setView(renderer, v === 'chase' ? 'chase' : 'first');
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    $('vrOpts').hidden = v !== 'vr';
    const cb = $('camBtn');
    cb.textContent = v === 'first' ? '3P' : '1P';
    cb.setAttribute('aria-label', v === 'first' ? 'Switch to chase view' : 'Switch to first-person view');
  }

  function setPaused(v) {
    if (!game || game.phase === 'matchOver') return;
    paused = v;
    $('pauseMenu').hidden = !v;
    // back in the headset: look down the court and press to carry on
    if (vr) { vr.press = null; if (!v) vr.wait = true; }
  }

  function setVRFit(key, value) {
    vrFit = { ...vrFit, [key]: value };
    try { localStorage.setItem('ct.vrFit', JSON.stringify(vrFit)); } catch (e) { /* storage is optional */ }
    document.querySelectorAll(`[data-vr-${key}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(`data-vr-${key}`) === value)));
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

  // ---------------- achievements screen ----------------
  // Only unlocked achievements are listed; locked ones stay hidden.
  const STAT_ROWS = [['Matches', (s) => s.played], ['Won', (s) => s.won + (s.played ? ' (' + Math.round(100 * s.won / s.played) + '%)' : '')],
    ['Win streak', (s) => s.streak], ['Best streak', (s) => s.bestStreak], ['Games won', (s) => s.games], ['Points won', (s) => s.points],
    ['Aces', (s) => s.aces], ['Double faults', (s) => s.doubleFaults], ['Longest rally', (s) => s.longestRally ? s.longestRally + ' shots' : '–'],
    ['Fastest serve', (s) => s.fastestServe ? s.fastestServe + ' km/h' : '–']];
  let statMode = 'all';
  function showTrophies() {
    const got = CT.ACHIEVEMENTS.filter((a) => ach.earned[a.id]);
    const list = $('achList');
    list.textContent = '';
    for (const a of got) {
      const li = document.createElement('li');
      const nm = document.createElement('b'); nm.textContent = a.name;
      if (a.pro) { const t = document.createElement('i'); t.textContent = 'Pro'; nm.append(' ', t); }
      const ds = document.createElement('span'); ds.textContent = a.desc;
      const n = document.createElement('em'); n.textContent = '×' + ach.earned[a.id].n;
      li.append(nm, n, ds);
      list.append(li);
    }
    $('achEmpty').hidden = got.length > 0;
    showStats(statMode);
    $('trophies').hidden = false;
  }
  function showStats(mode) {
    statMode = mode;
    document.querySelectorAll('[data-stats]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stats === mode)));
    const s = CT.achievementStats(ach, mode), dl = $('statList');
    dl.textContent = '';
    for (const [label, f] of STAT_ROWS) {
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = f(s);
      dl.append(dt, dd);
    }
  }

  function init() {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp, { passive: false });
    canvas.addEventListener('pointercancel', () => { touch = null; });
    window.addEventListener('resize', () => { if (game) layout(); });
    document.addEventListener('visibilitychange', () => {
      // (the CPU rally behind the menu isn't a match, so there's nothing to pause)
      if (document.hidden) { if ($('menu').hidden && $('lobby').hidden && $('pad').hidden) setPaused(true); if (audio) audio.suspend(); }
      else if (audio) audio.resume();
    });
    document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => pickChar(b.dataset.char)));
    const pickLevel = (id) => {
      level = id;
      try { localStorage.setItem('ct.level', id); } catch (e) { /* storage is optional */ }
      document.querySelectorAll('[data-level]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.level === id)));
    };
    document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => pickLevel(b.dataset.level)));
    pickLevel(level);
    document.querySelectorAll('[data-auto]').forEach((b) => b.addEventListener('click', () => setAutoMove(!autoMove)));
    $('autoPause').addEventListener('click', () => setAutoMove(!autoMove));
    setAutoMove(autoMove);
    document.querySelectorAll('[data-music]').forEach((b) => b.addEventListener('click', () => setMusic(!musicOn)));
    $('musicPause').addEventListener('click', () => setMusic(!musicOn));
    document.querySelectorAll('[data-music]').forEach((b) => b.setAttribute('aria-pressed', String(musicOn)));
    $('musicPause').textContent = musicOn ? 'Music on' : 'Music off';
    document.querySelectorAll('[data-zen]').forEach((b) => b.addEventListener('click', () => setZen(!zen)));
    $('zenPause').addEventListener('click', () => setZen(!zen));
    document.querySelectorAll('[data-full]').forEach((b) => b.addEventListener('click', () => setFull(!fullOn)));
    // the setting does nothing where pages can't go full screen (iPhone)
    $('fullPause').addEventListener('click', () => setFull($('fullPause').getAttribute('aria-pressed') !== 'true'));
    const onFullChange = () => showFull(inMatch() ? isFullscreen() : fullOn);
    document.addEventListener('fullscreenchange', onFullChange);
    document.addEventListener('webkitfullscreenchange', onFullChange);
    $('fullBtn').hidden = $('fullPause').hidden = !canFull;
    document.querySelectorAll('[data-sens]').forEach((r) => r.addEventListener('input', () => setSens(r.dataset.sens, Number(r.value))));
    showSens();
    $('play').addEventListener('click', () => { ensureAudio(); startMatch(); });
    $('resumeMatch').addEventListener('click', () => { ensureAudio(); resumeMatch(); });
    $('rematch').addEventListener('click', startMatch);
    $('toMenu').addEventListener('click', showMenu);
    $('pauseBtn').addEventListener('click', () => setPaused(true));
    document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('camBtn').addEventListener('click', () => setView(view === 'first' ? 'chase' : 'first'));
    document.addEventListener('keydown', (e) => {
      // on a laptop the space bar is the headset's button
      if (vr && e.key === ' ') { e.preventDefault(); if (!e.repeat) vrPress(); return; }
      if (vr && (e.key === 'r' || e.key === 'R')) { vrRecentre(true); return; }
      if ((e.key === 'c' || e.key === 'C') && e.target === document.body) setView(view === 'first' ? 'chase' : 'first');
    });
    document.addEventListener('keyup', (e) => { if (vr && e.key === ' ') { e.preventDefault(); vrRelease(); } });
    setView(view);
    for (const key of ['fov', 'lens', 'gfx']) {
      document.querySelectorAll(`[data-vr-${key}]`).forEach((b) => b.addEventListener('click', () => setVRFit(key, b.getAttribute(`data-vr-${key}`))));
      setVRFit(key, vrFit[key]);
    }
    // iPhones only share the motion sensor once it's allowed, from a tap:
    // ask on any tap while VR is picked (Play, or Create or Join online)
    document.addEventListener('click', () => { if (view === 'vr') CT.VR.askMotion(); }, true);
    $('resume').addEventListener('click', () => setPaused(false));
    // the match stays saved, so the menu offers to resume it
    $('quit').addEventListener('click', () => { leaveFullscreen(); showMenu(); });
    $('howBtn').addEventListener('click', () => { $('help').hidden = false; });
    $('tutBtn').addEventListener('click', () => { ensureAudio(); startTutorial(); });
    $('helpTut').addEventListener('click', () => { $('help').hidden = true; ensureAudio(); startTutorial(); });
    $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
    $('achBtn').addEventListener('click', showTrophies);
    $('achClose').addEventListener('click', () => { $('trophies').hidden = true; });
    document.querySelectorAll('[data-stats]').forEach((b) => b.addEventListener('click', () => showStats(b.dataset.stats)));
    $('hostBtn').addEventListener('click', hostRoom);
    $('joinBtn').addEventListener('click', () => { leaveOnline(true); lobbyMode = null; lobby('Enter the 4-letter code your friend sees.', '', true); $('codeInput').value = ''; $('codeInput').focus(); });
    $('lobbyGo').addEventListener('click', () => {
      const code = $('codeInput').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length === 4) { if (lobbyMode === 'pad') joinPad(code); else joinRoom(code); }
    });
    $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lobbyGo').click(); });
    $('lobbyCancel').addEventListener('click', () => {
      if (lobbyMode === 'pad') { if (pad && !pad.linked) unlinkPad(); leavePad(); lobbyMode = null; }
      showMenu();
    });
    $('padHost').addEventListener('click', hostPad);
    $('padJoin').addEventListener('click', () => { unlinkPad(); leavePad(); lobbyMode = 'pad'; lobby('Enter the 4-letter code on the headset phone.', '', true); $('codeInput').value = ''; $('codeInput').focus(); });
    $('padLeave').addEventListener('click', () => { leavePad(); showMenu(); });
    // in a headset the pause menu is drawn in each eye instead (vrFrame),
    // and a press anywhere picks from it
    $('pauseMenu').addEventListener('pointerdown', (e) => { if (vr) { e.preventDefault(); vrPress(); } });
    $('end').addEventListener('pointerdown', (e) => { if (vr) { e.preventDefault(); vrPress(); } });
    const padEl = $('pad');
    padEl.addEventListener('pointerdown', padDown, { passive: false });
    padEl.addEventListener('pointermove', padMove, { passive: false });
    padEl.addEventListener('pointerup', padUp, { passive: false });
    padEl.addEventListener('pointercancel', () => { padTouch = null; padFingers = 0; padTwo = false; });
    padStatus();
    window.addEventListener('pagehide', () => { leaveOnline(true); unlinkPad(); leavePad(); });
    $('mute').addEventListener('click', () => {
      muted = !muted;
      $('mute').setAttribute('aria-pressed', String(muted));
      $('mute').textContent = muted ? 'Sound off' : 'Sound on';
    });
    pickChar('octopus');
    showMenu();
    setZen(zen);
    setFull(fullOn);
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(() => { drawPortraits(); if (game) layout(); });
    drawPortraits();
    requestAnimationFrame(frame);
    window.__CT_GAME = () => game;   // handy for debugging in the console
    window.__cam = renderer.cam;
  }

  init();
})();
