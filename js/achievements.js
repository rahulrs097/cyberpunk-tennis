// Achievements: what counts, a tracker that reads a match's 'point' events
// for one side, and the saved record on this phone (localStorage).
(function () {
  const CT = (window.CT = window.CT || {});

  // `common` ones only go up on the billboard the first time.
  const ACHIEVEMENTS = [
    { id: 'ace', name: 'Ace', desc: 'Serve an ace', common: true },
    { id: 'tetraAce', name: 'Tetra Ace', desc: 'Win four service points in a row with aces' },
    { id: 'pentaAce', name: 'Penta Ace', desc: 'Win five service points in a row with aces' },
    { id: 'loveGame', name: 'Love Game', desc: 'Win a game without losing a point', common: true },
    { id: 'break', name: 'Breaker', desc: 'Win a game on your opponent\'s serve', common: true },
    { id: 'marathon', name: 'Marathon', desc: 'Win a rally of 20 shots or more' },
    { id: 'win', name: 'Set Point', desc: 'Win a set' },
    { id: 'tiebreak', name: 'Ice Cold', desc: 'Win a set in the tiebreak' },
    { id: 'comeback', name: 'Comeback', desc: 'Win a set after trailing by three games' },
    { id: 'breadstick', name: 'Breadstick', desc: 'Win a set 6–1' },
    { id: 'bagel', name: 'Bagel', desc: 'Win a set 6–0' },
    { id: 'noLove', name: 'No Love', desc: 'Win a set and score in every game' },
    { id: 'goldenSet', name: 'Golden Set', desc: 'Win a set without losing a single point' },
  ];
  const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  const RALLY = 20;

  // Follows one side through a set. feed(d) takes each 'point' event
  // (winner, text, result, server, shots, tiebreak, games) and returns the
  // ids earned on that point, in list order.
  function createTracker(side) {
    const opp = 1 - side;
    let aceRun = 0;                // service points in a row won with an ace
    let won = [0, 0];              // points each side has in the current game
    let everyGame = true;          // scored at least once in every game so far
    let lostPoint = false;
    let maxBehind = 0;
    return function feed(d) {
      const got = new Set();
      const mine = d.winner === side;
      if (d.server === side) {
        if (mine && d.text === 'Ace') { aceRun++; got.add('ace'); } else aceRun = 0;
        if (aceRun === 4) got.add('tetraAce');
        if (aceRun === 5) got.add('pentaAce');
      }
      if (mine && d.shots >= RALLY) got.add('marathon');
      if (!mine) lostPoint = true;
      won[d.winner]++;
      if (d.result === 'game' || d.result === 'set') {
        if (won[side] === 0) everyGame = false;
        // (a tiebreak isn't a service game)
        if (mine && !d.tiebreak) {
          if (won[opp] === 0) got.add('loveGame');
          if (d.server !== side) got.add('break');
        }
        won = [0, 0];
      }
      if (d.games) maxBehind = Math.max(maxBehind, d.games[opp] - d.games[side]);
      if (d.result === 'set' && mine) {
        const [a, b] = [d.games[side], d.games[opp]];
        got.add('win');
        if (d.tiebreak) got.add('tiebreak');
        if (maxBehind >= 3) got.add('comeback');
        if (a === 6 && b === 1) got.add('breadstick');
        if (a === 6 && b === 0) got.add('bagel');
        if (everyGame) got.add('noLove');
        if (!lostPoint) got.add('goldenSet');
      }
      return ACHIEVEMENTS.filter((x) => got.has(x.id)).map((x) => x.id);
    };
  }

  // ---------------- saved record ----------------
  // { id: { n: times earned, at: first earned (ms since 1970) } }
  const KEY = 'ct.achievements';
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch (e) { return {}; }   // storage is optional
  }
  // Adds `ids` to `rec` and saves it. Returns the ids earned for the first time.
  function record(rec, ids, now) {
    const fresh = [];
    for (const id of ids) {
      if (!BY_ID[id]) continue;
      const e = rec[id];
      if (e) e.n++;
      else { rec[id] = { n: 1, at: now || Date.now() }; fresh.push(id); }
    }
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* storage is optional */ }
    return fresh;
  }

  CT.ACHIEVEMENTS = ACHIEVEMENTS;
  CT.achievement = (id) => BY_ID[id];
  CT.createAchievementTracker = createTracker;
  CT.loadAchievements = load;
  CT.recordAchievements = record;
})();
