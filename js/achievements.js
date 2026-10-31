// Achievements and stats: what counts, a tracker that follows one side
// through a match from its events, and the record saved on this phone
// (localStorage).
(function () {
  const CT = (window.CT = window.CT || {});

  // `pro`: only counts against the Pro CPU. `common` ones only go up on the
  // billboard the first time.
  const ACHIEVEMENTS = [
    { id: 'ace', name: 'Ace', desc: 'Serve an ace', common: true },
    { id: 'game', name: 'Game On', desc: 'Win a game', common: true },
    { id: 'loveGame', name: 'Love Game', desc: 'Win a game without losing a point', common: true },
    { id: 'break', name: 'Breaker', desc: 'Win a game on your opponent\'s serve', common: true },
    { id: 'rocket', name: 'Rocket Serve', desc: 'Serve at 200 km/h or faster' },
    { id: 'marathon', name: 'Marathon', desc: 'Win a rally of 20 shots or more' },
    { id: 'match', name: 'Match Won', desc: 'Win a match' },
    { id: 'tiebreak', name: 'Ice Cold', desc: 'Win a match in the tiebreak' },
    { id: 'comeback', name: 'Comeback', desc: 'Win a match after trailing by three games' },
    { id: 'noLove', name: 'No Love', desc: 'Win a match and score in every game' },
    { id: 'tetraAce', name: 'Tetra Ace', desc: 'Serve four aces in one game', pro: true },
    { id: 'pentaAce', name: 'Penta Ace', desc: 'Serve five aces in one game', pro: true },
    { id: 'breadstick', name: 'Breadstick', desc: 'Win a match 6–1', pro: true },
    { id: 'bagel', name: 'Bagel', desc: 'Win a match 6–0', pro: true },
    { id: 'proChampion', name: 'Pro Champion', desc: 'Win a match on Pro', pro: true },
    { id: 'goldenSet', name: 'Golden Set', desc: 'Win a match without losing a single point', pro: true },
  ];
  const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  const RALLY = 20;
  const ROCKET = 200;   // km/h: only a perfect full-pace serve on fresh legs gets there

  // Follows `side` through one match. mode: the CPU level id, or 'online'.
  // point(d) takes each 'point' event (winner, text, result, server, shots,
  // tiebreak, games) and hit(d) each 'hit'; both return what they changed:
  // { earned: [ids, in list order], stats: { name: amount }, best: { name: value },
  // over: { won } once the match is over }.
  // `saved`: what state() returned, to carry on a resumed match.
  function createTracker(side, mode, saved) {
    const opp = 1 - side, pro = mode === 'pro';
    let aces = 0;                  // aces this game
    let won = [0, 0];              // points each side has in the current game
    let everyGame = true;          // scored at least once in every game so far
    let lostPoint = false;
    let maxBehind = 0;
    // our last serve's speed: it only counts (fastest serve, rocket) once
    // it has landed in, i.e. they returned it or the point was played out
    let serveKmh = 0;
    if (saved) ({ aces, won, everyGame, lostPoint, maxBehind } = saved);
    const state = () => ({ aces, won: won.slice(), everyGame, lostPoint, maxBehind });
    function out(got, stats, best, over) {
      return { earned: ACHIEVEMENTS.filter((x) => got.has(x.id) && (pro || !x.pro)).map((x) => x.id), stats, best, over };
    }
    function serveIn(got, best) {
      if (!serveKmh) return;
      best.fastestServe = serveKmh;
      if (serveKmh >= ROCKET) got.add('rocket');
      serveKmh = 0;
    }
    function point(d) {
      const got = new Set(), stats = {}, best = {};
      const mine = d.winner === side;
      if (d.text === 'Double fault') serveKmh = 0;
      serveIn(got, best);
      if (mine) stats.points = 1;
      if (d.server === side) {
        if (mine && d.text === 'Ace') { aces++; got.add('ace'); stats.aces = 1; }
        if (!mine && d.text === 'Double fault') stats.doubleFaults = 1;
        if (aces === 4) got.add('tetraAce');
        if (aces === 5) got.add('pentaAce');
      }
      if (mine && d.shots >= RALLY) got.add('marathon');
      if (d.shots) best.longestRally = d.shots;
      if (!mine) lostPoint = true;
      won[d.winner]++;
      if (d.result === 'game' || d.result === 'set') {
        if (won[side] === 0) everyGame = false;
        if (mine) { stats.games = 1; got.add('game'); }
        // (a tiebreak isn't a service game)
        if (mine && !d.tiebreak) {
          if (won[opp] === 0) got.add('loveGame');
          if (d.server !== side) got.add('break');
        }
        won = [0, 0];
        aces = 0;
      }
      if (d.games) maxBehind = Math.max(maxBehind, d.games[opp] - d.games[side]);
      let over = null;
      if (d.result === 'set') {
        over = { won: mine };
        if (mine) {
          const [a, b] = [d.games[side], d.games[opp]];
          ['match', 'proChampion'].forEach((id) => got.add(id));
          if (d.tiebreak) got.add('tiebreak');
          if (maxBehind >= 3) got.add('comeback');
          if (a === 6 && b === 1) got.add('breadstick');
          if (a === 6 && b === 0) got.add('bagel');
          if (everyGame) got.add('noLove');
          if (!lostPoint) got.add('goldenSet');
        }
      }
      return out(got, stats, best, over);
    }
    function hit(d) {
      const got = new Set(), best = {};
      // (a fault is followed by the second serve, which replaces it)
      if (d.side === side && d.kind === 'serve') serveKmh = d.kmh || 0;
      else if (d.side === opp) serveIn(got, best);
      return out(got, {}, best, null);
    }
    return { side, mode, point, hit, state };
  }

  // ---------------- saved record ----------------
  // { earned: { id: { n: times earned, at: first earned (ms since 1970) } },
  //   stats: { all | chill | club | pro | online: STAT_KEYS } }
  const KEY = 'ct.achievements';
  const STAT_KEYS = ['played', 'won', 'streak', 'bestStreak', 'games', 'points', 'aces', 'doubleFaults', 'longestRally', 'fastestServe'];
  const blankStats = () => Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));

  function load() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* storage is optional */ }
    if (!v || typeof v !== 'object') v = {};
    if (!v.earned || typeof v.earned !== 'object') v.earned = {};
    if (!v.stats || typeof v.stats !== 'object') v.stats = {};
    return v;
  }
  function save(rec) {
    try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) { /* storage is optional */ }
  }
  function statsFor(rec, mode) {
    const s = rec.stats[mode] || (rec.stats[mode] = {});
    for (const k of STAT_KEYS) if (typeof s[k] !== 'number') s[k] = 0;
    return s;
  }

  // Adds one tracker result (`res`, in `mode`) to `rec` and saves it if
  // anything changed (most shots change nothing, and saving is a
  // synchronous write). Returns the ids earned for the first time.
  function record(rec, res, mode, now) {
    const fresh = [];
    let changed = false;
    for (const id of res.earned || []) {
      if (!BY_ID[id]) continue;
      const e = rec.earned[id];
      if (e) e.n++;
      else { rec.earned[id] = { n: 1, at: now || Date.now() }; fresh.push(id); }
      changed = true;
    }
    for (const s of [statsFor(rec, 'all'), statsFor(rec, mode)]) {
      for (const k in res.stats || {}) { s[k] += res.stats[k]; changed = true; }
      for (const k in res.best || {}) if (res.best[k] > s[k]) { s[k] = res.best[k]; changed = true; }
      if (res.over) {
        s.played++;
        if (res.over.won) { s.won++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); } else s.streak = 0;
        changed = true;
      }
    }
    if (changed) save(rec);
    return fresh;
  }

  CT.ACHIEVEMENTS = ACHIEVEMENTS;
  CT.achievement = (id) => BY_ID[id];
  CT.createAchievementTracker = createTracker;
  CT.loadAchievements = load;
  CT.recordAchievements = record;
  CT.achievementStats = (rec, mode) => (rec.stats[mode] ? statsFor(rec, mode) : blankStats());
})();
