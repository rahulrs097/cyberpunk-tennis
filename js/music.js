// Background music, synthesised with Web Audio. No samples, nothing to download.
// Two tracks:
//  - match: a prog rock / 8-bit EDM track. Square-wave bass and arps, a pulse
//    lead, noise drums, and a 7/8 verse that opens into a 4/4 drop.
//  - zen: a slow neon-ambient track for zen mode. Soft detuned pads, a deep
//    sine bass, a glassy pluck arp and a bell melody through a long echo, with
//    a gentle kick and hats in the middle.
(function () {
  const CT = (window.CT = window.CT || {});

  const LOOKAHEAD = 0.15;              // seconds scheduled ahead of the clock
  const VOLUME = 1.0;                  // master level; the game's limiter catches peaks
  const FADE = 0.6;                    // crossfade time constant when the track changes

  // MIDI note helpers
  const A2 = 45;
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Chords as semitone offsets from A2. Minor-key prog moves: i, VI, III, VII,
  // then the borrowed bII and a major V to pull back round.
  const CH = {
    Am: [0, 3, 7], F: [-4, 0, 3], C: [3, 7, 10], G: [-2, 2, 5],
    Dm: [5, 8, 12], Bb: [1, 5, 8], E: [7, 11, 14], Em: [7, 10, 14],
  };

  let ctx = null, out = null, noise = null;
  let on = true, playing = false, timer = null;
  let track = 'match';
  let section = 0, bar = 0, step = 0, nextTime = 0;

  function makeNoise() {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // fixed pseudo-random sequence so the hats sound the same every time
    let s = 12345;
    for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    return buf;
  }

  function tone(dest, type, f, t, dur, vol, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // A held note with a slow attack and release, for pads and the bass swell.
  function swell(dest, type, f, t, dur, vol, attack, detune) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - attack));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + attack);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + attack + 0.05);
  }

  function hit(dest, t, dur, vol, hp) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, (step * 0.137) % 0.8); s.stop(t + dur + 0.02);
  }

  // ---------------- match track ----------------
  // Sections: bar length in sixteenths, the chords (one per bar) and which
  // parts play. 7/8 bars are 14 steps, 4/4 bars are 16.
  const MATCH_SECTIONS = [
    { len: 14, chords: ['Am', 'Am', 'F', 'G'], parts: { arp: 1, bass: 1, hat: 1 } },                      // intro
    { len: 14, chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E'], parts: { arp: 1, bass: 1, hat: 1, kick: 1, snare: 1, lead: 1 } },
    { len: 16, chords: ['Dm', 'Bb', 'F', 'E'], parts: { bass: 1, hat: 1, kick: 1, riser: 1, arp: 1 } },    // build
    { len: 16, chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Bb', 'E'], parts: { arp: 1, bass: 1, hat: 1, kick: 1, snare: 1, lead: 2 } }, // drop
    { len: 14, chords: ['Em', 'C', 'Dm', 'E'], parts: { arp: 1, bass: 1, hat: 1, snare: 1 } },             // breakdown
  ];

  // Lead melodies as semitone offsets from the chord root (null = rest),
  // one entry per eighth note. Phrases are cut to the bar length.
  const LEAD_A = [12, null, 15, 14, 12, null, 10, 12, null, 7, 10, null, 12, 15, 19, null];
  const LEAD_B = [19, 17, 15, null, 19, 22, 24, null, 22, 19, 17, 15, 14, null, 12, null];

  function playMatchStep(dest, t, sec, chord, STEP) {
    const P = sec.parts;
    const root = A2 + chord[0];
    const odd = sec.len === 14;
    // 7/8 groups as 2+2+3 eighths (steps 0, 4, 8); 4/4 is four on the floor
    const beat = odd ? (step === 0 || step === 4 || step === 8) : step % 4 === 0;

    if (P.kick && beat) tone(dest, 'sine', 150, t, 0.18, 0.55, 42);
    if (P.snare && (odd ? step === 8 : step % 8 === 4)) { hit(dest, t, 0.16, 0.22, 1200); tone(dest, 'triangle', 220, t, 0.08, 0.12, 120); }
    if (P.hat && step % 2 === 1) hit(dest, t, 0.04, 0.07, 7000);
    if (P.hat && !odd && step % 4 === 2) hit(dest, t, 0.09, 0.05, 5000);

    // bass: driving eighth notes with an octave jump, ducked after the kick
    if (P.bass && step % 2 === 0) {
      const oct = (step / 2) % 4 === 3 ? 12 : 0;
      tone(dest, 'square', freq(root - 12 + oct), t, STEP * 1.7, beat && P.kick ? 0.05 : 0.09);
    }
    // arpeggio: chord tones climbing over two octaves in sixteenths
    if (P.arp) {
      const seq = [0, 1, 2, 0 + 3, 1 + 3, 2 + 3];
      const k = seq[step % seq.length];
      const n = A2 + 12 + chord[k % 3] + (k >= 3 ? 12 : 0);
      tone(dest, 'square', freq(n), t, STEP * 0.9, 0.028);
    }
    // lead on eighth notes; louder and an octave up in the drop
    if (P.lead && step % 2 === 0) {
      const phrase = bar % 2 ? LEAD_B : LEAD_A;
      const off = phrase[(step / 2) % phrase.length];
      if (off !== null) {
        const n = A2 + chord[0] + off + (P.lead === 2 ? 12 : 0);
        tone(dest, 'sawtooth', freq(n), t, STEP * 1.8, P.lead === 2 ? 0.04 : 0.03);
      }
    }
    // build-up: rising noise sweep across the section's last bar
    if (P.riser && bar === sec.chords.length - 1 && step % 2 === 0) hit(dest, t, STEP * 2, 0.02 + (step / sec.len) * 0.08, 600 + step * 300);
  }

  // ---------------- zen track ----------------
  // Same A minor world as the match track, but slow, with sevenths and ninths
  // added (as offsets from the chord root) so the pads float.
  const ZEN_CH = {
    Am9: [0, 3, 7, 10, 14], Fmaj9: [-4, 0, 3, 7, 11], Cmaj7: [3, 7, 10, 14], G6: [-2, 2, 5, 7],
    Dm9: [5, 8, 12, 15, 19], Em7: [7, 10, 14, 17],
  };
  const ZEN_SECTIONS = [
    { len: 16, chords: ['Am9', 'Fmaj9', 'Cmaj7', 'G6'], parts: { pad: 1, sub: 1 } },                                   // drift in
    { len: 16, chords: ['Am9', 'Fmaj9', 'Cmaj7', 'G6', 'Am9', 'Fmaj9', 'Dm9', 'Em7'], parts: { pad: 1, sub: 1, pluck: 1, hat: 1 } },
    { len: 16, chords: ['Am9', 'Fmaj9', 'Cmaj7', 'G6', 'Dm9', 'Fmaj9', 'Am9', 'Em7'], parts: { pad: 1, sub: 1, pluck: 1, hat: 1, kick: 1, bell: 1 } },
    { len: 16, chords: ['Fmaj9', 'Cmaj7', 'Dm9', 'Em7'], parts: { pad: 1, pluck: 1, bell: 1 } },                     // float
  ];
  // Pluck pattern: which sixteenths sound, and which chord tone (index into the
  // chord, wrapping up an octave) each one picks. Sparse and off the beat.
  const PLUCK = { 0: 0, 3: 2, 6: 4, 8: 1, 10: 3, 13: 5 };
  // Bell melody in A minor pentatonic, as semitones above A4, two bars per
  // phrase, one entry per quarter note (null = rest).
  const BELL = [12, null, 10, 7, null, null, 5, null, 3, null, 5, 7, 10, null, null, null];

  function playZenStep(dest, t, sec, chord, STEP) {
    const P = sec.parts;
    const root = A2 + chord[0];
    const barDur = STEP * sec.len;

    // pads: each chord note on two slightly detuned voices, swelling in
    if (P.pad && step === 0) {
      for (let i = 0; i < chord.length; i++) {
        const n = freq(A2 + 12 + chord[i]);
        swell(zen.pad, 'sawtooth', n, t, barDur, 0.012, 0.9, -7);
        swell(zen.pad, 'triangle', n, t, barDur, 0.02, 0.9, 7);
      }
    }
    // sub bass: a long sine root, with a softer fifth on the half bar
    if (P.sub && step === 0) swell(dest, 'sine', freq(root - 12), t, barDur * 0.55, 0.16, 0.08);
    if (P.sub && step === 8) swell(dest, 'sine', freq(root - 12 + 7), t, barDur * 0.4, 0.08, 0.1);
    // soft kick on beats one and three
    if (P.kick && step % 8 === 0) tone(dest, 'sine', 95, t, 0.3, 0.28, 40);
    // hats: quiet, ticking on the off eighths
    if (P.hat && step % 4 === 2) hit(dest, t, 0.05, 0.025, 8000);
    if (P.hat && step % 8 === 7) hit(dest, t, 0.03, 0.012, 9000);
    // glassy pluck through the echo
    if (P.pluck && PLUCK[step] !== undefined) {
      const k = PLUCK[step];
      const n = A2 + 24 + chord[k % chord.length] + (k >= chord.length ? 12 : 0);
      tone(zen.echo, 'triangle', freq(n), t, STEP * 3, 0.05);
      tone(zen.echo, 'sine', freq(n + 12), t, STEP * 1.5, 0.015);
    }
    // bell melody on quarter notes, ringing long into the echo
    if (P.bell && step % 4 === 0) {
      const off = BELL[(bar % 4) * 4 + step / 4];
      if (off !== null) {
        const n = 69 + off;
        tone(zen.echo, 'sine', freq(n), t, STEP * 10, 0.06);
        tone(zen.echo, 'sine', freq(n) * 2.01, t, STEP * 4, 0.012);
      }
    }
  }

  const TRACKS = {
    match: { step: 60 / 140 / 4, sections: MATCH_SECTIONS, chords: CH, play: playMatchStep, level: 1, gain: null },
    // the zen track sits lower than the match track: it should stay under the game
    zen: { step: 60 / 74 / 4, sections: ZEN_SECTIONS, chords: ZEN_CH, play: playZenStep, level: 0.4, gain: null },
  };
  // the zen track's extra buses (set up in start)
  const zen = { pad: null, echo: null };

  function playStep(t) {
    const T = TRACKS[track];
    const sec = T.sections[section];
    T.play(T.gain, t, sec, T.chords[sec.chords[bar]], T.step);
  }

  function advance() {
    const T = TRACKS[track];
    if (++step >= T.sections[section].len) {
      step = 0;
      if (++bar >= T.sections[section].chords.length) { bar = 0; section = (section + 1) % T.sections.length; }
    }
  }

  function schedule() {
    if (!ctx || !on || !playing || ctx.state !== 'running') return;
    // after a stall, don't try to catch up on missed notes
    if (nextTime < ctx.currentTime - 0.05) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      playStep(nextTime);
      advance();
      nextTime += TRACKS[track].step;
    }
  }

  // Attach to the game's AudioContext (created on the first tap).
  function start(audioCtx, dest) {
    if (ctx || !audioCtx) return;
    ctx = audioCtx;
    out = ctx.createGain();
    out.gain.value = on && playing ? VOLUME : 0;
    out.connect(dest || ctx.destination);

    // match: soften the square waves a little
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000;
    TRACKS.match.gain = ctx.createGain();
    TRACKS.match.gain.connect(lp).connect(out);

    // zen: a darker top end, pads through a low filter, and a dotted-eighth
    // echo that feeds back through a lowpass so each repeat gets duller
    const zlp = ctx.createBiquadFilter();
    zlp.type = 'lowpass'; zlp.frequency.value = 4200;
    TRACKS.zen.gain = ctx.createGain();
    TRACKS.zen.gain.connect(zlp).connect(out);
    const padLp = ctx.createBiquadFilter();
    padLp.type = 'lowpass'; padLp.frequency.value = 1100; padLp.Q.value = 0.7;
    zen.pad = ctx.createGain();
    zen.pad.connect(padLp).connect(TRACKS.zen.gain);
    zen.echo = ctx.createGain();
    const delay = ctx.createDelay(2), fb = ctx.createGain(), fbLp = ctx.createBiquadFilter();
    delay.delayTime.value = TRACKS.zen.step * 3;
    fb.gain.value = 0.45;
    fbLp.type = 'lowpass'; fbLp.frequency.value = 2500;
    zen.echo.connect(TRACKS.zen.gain);
    zen.echo.connect(delay);
    delay.connect(fbLp).connect(fb).connect(delay);
    fbLp.connect(TRACKS.zen.gain);

    noise = makeNoise();
    for (const k in TRACKS) TRACKS[k].gain.gain.value = k === track ? TRACKS[k].level : 0;
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 50);
  }

  function setOn(v) {
    on = !!v;
    if (!ctx) return;
    out.gain.setTargetAtTime(on && playing ? VOLUME : 0, ctx.currentTime, 0.05);
    if (on) nextTime = ctx.currentTime + 0.05;
  }

  // The track plays during a match only: it starts from the top when a match
  // begins and fades out when it ends.
  function setPlaying(v) {
    v = !!v;
    if (v === playing) return;
    playing = v;
    if (v) { section = 0; bar = 0; step = 0; }
    if (!ctx) return;
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setTargetAtTime(on && playing ? VOLUME : 0, ctx.currentTime, playing ? 0.05 : 0.25);
    if (v) nextTime = ctx.currentTime + 0.05;
  }

  // Pick the track ('match' or 'zen'). A change mid-match crossfades: the old
  // track's last notes ring out while the new one starts from its top.
  function setTrack(name) {
    if (!TRACKS[name] || name === track) return;
    track = name;
    section = 0; bar = 0; step = 0;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const k in TRACKS) {
      const g = TRACKS[k].gain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(k === name ? TRACKS[k].level : 0, now, k === name ? FADE * 0.5 : FADE);
    }
    nextTime = now + 0.05;
  }

  CT.Music = { start, setOn, setPlaying, setTrack, track: () => track, isOn: () => on, isPlaying: () => playing };
})();
