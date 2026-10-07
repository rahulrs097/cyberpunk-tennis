// Background music: a looping prog rock / 8-bit EDM track synthesised with
// Web Audio. Square-wave bass and arps, a pulse lead, noise drums, and a
// 7/8 verse that opens into a 4/4 drop. No samples, nothing to download.
(function () {
  const CT = (window.CT = window.CT || {});

  const BPM = 140;
  const STEP = 60 / BPM / 4;          // one sixteenth note
  const LOOKAHEAD = 0.15;              // seconds scheduled ahead of the clock
  const VOLUME = 1.0;                  // master level; the game's limiter catches peaks

  // MIDI note helpers
  const A2 = 45;
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Chords as semitone offsets from A2. Minor-key prog moves: i, VI, III, VII,
  // then the borrowed bII and a major V to pull back round.
  const CH = {
    Am: [0, 3, 7], F: [-4, 0, 3], C: [3, 7, 10], G: [-2, 2, 5],
    Dm: [5, 8, 12], Bb: [1, 5, 8], E: [7, 11, 14], Em: [7, 10, 14],
  };

  // Sections: bar length in sixteenths, the chords (one per bar) and which
  // parts play. 7/8 bars are 14 steps, 4/4 bars are 16.
  const SECTIONS = [
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

  let ctx = null, out = null, noise = null;
  let on = true, timer = null;
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

  function tone(type, f, t, dur, vol, glideTo) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function hit(t, dur, vol, hp) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = 'highpass'; f.frequency.value = hp;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, (step * 0.137) % 0.8); s.stop(t + dur + 0.02);
  }

  function playStep(t) {
    const sec = SECTIONS[section];
    const P = sec.parts;
    const chord = CH[sec.chords[bar]];
    const root = A2 + chord[0];
    const odd = sec.len === 14;
    // 7/8 groups as 2+2+3 eighths (steps 0, 4, 8); 4/4 is four on the floor
    const beat = odd ? (step === 0 || step === 4 || step === 8) : step % 4 === 0;

    if (P.kick && beat) tone('sine', 150, t, 0.18, 0.55, 42);
    if (P.snare && (odd ? step === 8 : step % 8 === 4)) { hit(t, 0.16, 0.22, 1200); tone('triangle', 220, t, 0.08, 0.12, 120); }
    if (P.hat && step % 2 === 1) hit(t, 0.04, 0.07, 7000);
    if (P.hat && !odd && step % 4 === 2) hit(t, 0.09, 0.05, 5000);

    // bass: driving eighth notes with an octave jump, ducked after the kick
    if (P.bass && step % 2 === 0) {
      const oct = (step / 2) % 4 === 3 ? 12 : 0;
      tone('square', freq(root - 12 + oct), t, STEP * 1.7, beat && P.kick ? 0.05 : 0.09);
    }
    // arpeggio: chord tones climbing over two octaves in sixteenths
    if (P.arp) {
      const seq = [0, 1, 2, 0 + 3, 1 + 3, 2 + 3];
      const k = seq[step % seq.length];
      const n = A2 + 12 + chord[k % 3] + (k >= 3 ? 12 : 0);
      tone('square', freq(n), t, STEP * 0.9, 0.028);
    }
    // lead on eighth notes; louder and an octave up in the drop
    if (P.lead && step % 2 === 0) {
      const phrase = bar % 2 ? LEAD_B : LEAD_A;
      const off = phrase[(step / 2) % phrase.length];
      if (off !== null) {
        const n = A2 + chord[0] + off + (P.lead === 2 ? 12 : 0);
        tone('sawtooth', freq(n), t, STEP * 1.8, P.lead === 2 ? 0.04 : 0.03);
      }
    }
    // build-up: rising noise sweep across the section's last bar
    if (P.riser && bar === sec.chords.length - 1 && step % 2 === 0) hit(t, STEP * 2, 0.02 + (step / sec.len) * 0.08, 600 + step * 300);
  }

  function advance() {
    const sec = SECTIONS[section];
    if (++step >= sec.len) {
      step = 0;
      if (++bar >= sec.chords.length) { bar = 0; section = (section + 1) % SECTIONS.length; }
    }
  }

  function schedule() {
    if (!ctx || !on || ctx.state !== 'running') return;
    // after a stall, don't try to catch up on missed notes
    if (nextTime < ctx.currentTime - 0.05) nextTime = ctx.currentTime + 0.05;
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      playStep(nextTime);
      advance();
      nextTime += STEP;
    }
  }

  // Attach to the game's AudioContext (created on the first tap).
  function start(audioCtx, dest) {
    if (ctx || !audioCtx) return;
    ctx = audioCtx;
    out = ctx.createGain();
    out.gain.value = on ? VOLUME : 0;
    // soften the square waves a little
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000;
    out.connect(lp).connect(dest || ctx.destination);
    noise = makeNoise();
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 50);
  }

  function setOn(v) {
    on = !!v;
    if (!ctx) return;
    out.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, 0.05);
    if (on) nextTime = ctx.currentTime + 0.05;
  }

  CT.Music = { start, setOn, isOn: () => on };
})();
