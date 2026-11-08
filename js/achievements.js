// Achievements and stats: what counts, a tracker that follows one side
// through a match from its events, and the record saved on this phone
// (localStorage).
(function () {
  const CT = (window.CT = window.CT || {});

  // `pro`: only counts against the Pro CPU. `char`: only counts playing that
  // character. `common` ones only go up on the billboard the first time.
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
    { id: 'paint', name: 'Painting the Lines', desc: 'Hit a winner or an ace that lands on the line' },
    { id: 'saveMP', name: 'Escape Artist', desc: 'Save a match point and go on to win the match' },
    { id: 'parking', name: 'Parallel Parking', desc: 'Make your opponent run past the yellow line into the parking bays' },
    { id: 'clinical', name: 'Clinical', desc: 'Win a match with only 24 points won' },
    { id: 'tentacle', name: 'The Tentacle', desc: 'Hit a winner from outside the court, past the sideline', char: 'octopus' },
    { id: 'thought', name: 'The Thought', desc: 'Hit a forehand, a backhand, a volley and a smash in one rally, and win it with a winner', char: 'philosopher' },
    { id: 'goldenSet', name: 'Golden Set', desc: 'Win a match without losing a single point', pro: true },
  ];
  const BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  const RALLY = 20;
  // a bounce that keeps no more than this much of the ball (m) inside the
  // line's outer edge is on the line (the same as the billboard's close call)
  const ON_LINE = 0.05;
  const ROCKET = 200;   // km/h: only a perfect full-pace serve on fresh legs gets there

  // Follows `side` through one match. mode: the CPU level id, or 'online'.
  // point(d) takes each 'point' event (winner, text, result, server, shots,
  // matchPoint: [side 0 had one, side 1 had one], lineM: the last bounce's line margin,
  // tiebreak, games), hit(d) each 'hit' and parked(d) each 'parked' (side: who
  // ran past the yellow line); all return what they changed:
  // { earned: [ids, in list order], stats: { name: amount }, best: { name: value },
  // over: { won, games, tiebreak, totals } once the match is over: games is
  // the set score and tiebreak the tiebreak's points (or null), both ours
  // first; totals is this match's stats, for the match history }.
  // `saved`: what state() returned, to carry on a resumed match. char: the
  // character `side` plays.
  function createTracker(side, mode, saved, char) {
    const opp = 1 - side, pro = mode === 'pro';
    let aces = 0;                  // aces this game
    let won = [0, 0];              // points each side has in the current game
    let everyGame = true;          // scored at least once in every game so far
    let lostPoint = false;
    let maxBehind = 0;
    let savedMP = false;           // won a point that was their match point
    // our last serve's speed: it only counts (fastest serve, rocket) once
    // it has landed in, i.e. they returned it or the point was played out
    let serveKmh = 0;
    // this rally: the kinds of shot we've hit (fh, bh, volley, smash), and
    // our last shot, if it was hit from past the sideline
    let kinds = new Set(), wideShot = false;
    // our last rally shot was hit under pressure (stretched, jammed or on
    // the run), so missing it is a forced error, not an unforced one
    let pressed = false, lastRally = false;
    // this match's own stats (the saved record only keeps running totals)
    let totals = blankTotals();
    if (saved) {
      ({ aces, won, everyGame, lostPoint, maxBehind } = saved);
      savedMP = !!saved.savedMP;
      if (saved.totals) for (const k in totals) if (typeof saved.totals[k] === 'number') totals[k] = saved.totals[k];
    }
    const state = () => ({ aces, won: won.slice(), everyGame, lostPoint, maxBehind, savedMP, totals: { ...totals } });
    function out(got, stats, best, over) {
      for (const k in stats) if (k in totals) totals[k] += stats[k];
      for (const k in best) if (k in totals) totals[k] = Math.max(totals[k], best[k]);
      if (over) over.totals = { ...totals };
      return { earned: ACHIEVEMENTS.filter((x) => got.has(x.id) && (pro || !x.pro) && (!x.char || x.char === char)).map((x) => x.id), stats, best, over };
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
      if (mine && d.text === 'Winner') stats.winners = 1;
      if (mine && (d.text === 'Winner' || d.text === 'Ace') && d.lineM != null && d.lineM <= 0 && d.lineM >= -ON_LINE) got.add('paint');
      if (mine && d.matchPoint && d.matchPoint[opp]) savedMP = true;
      // (a missed serve is a fault; the second one counts as a double fault)
      if (!mine && (d.text === 'Out' || d.text === 'Net') && lastRally && !pressed) stats.unforcedErrors = 1;
      if (mine && d.shots >= RALLY) got.add('marathon');
      if (mine && d.text === 'Winner') {
        if (wideShot) got.add('tentacle');
        if (kinds.size === 4) got.add('thought');
      }
      kinds = new Set(); wideShot = false; pressed = false; lastRally = false;
      if (d.shots) best.longestRally = d.shots;
      if (!mine) lostPoint = true;
      won[d.winner]++;
      totals.played++;
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
        const g = d.games || [0, 0], p = d.points || [0, 0];
        over = { won: mine, games: [g[side], g[opp]], tiebreak: d.tiebreak ? [p[side], p[opp]] : null };
        if (mine) {
          const [a, b] = [d.games[side], d.games[opp]];
          ['match', 'proChampion'].forEach((id) => got.add(id));
          if (d.tiebreak) got.add('tiebreak');
          if (maxBehind >= 3) got.add('comeback');
          // (once a match, however many match points were saved)
          if (savedMP) got.add('saveMP');
          if (a === 6 && b === 1) got.add('breadstick');
          if (a === 6 && b === 0) got.add('bagel');
          if (everyGame) got.add('noLove');
          if (!lostPoint) got.add('goldenSet');
          // the fewest points a match can be won with: every game won with
          // exactly four points, and none at all in the games lost
          if (totals.points + (stats.points || 0) === 24) got.add('clinical');
        }
      }
      return out(got, stats, best, over);
    }
    function hit(d) {
      const got = new Set(), best = {};
      // (a fault is followed by the second serve, which replaces it)
      if (d.side === side && d.kind === 'serve') serveKmh = d.kmh || 0;
      else if (d.side === opp) serveIn(got, best);
      if (d.kind === 'serve') { kinds = new Set(); wideShot = false; }
      if (d.side === side) {
        const ground = d.kind === 'ground' || d.kind === 'power';
        if (ground) kinds.add(d.wing);
        else if (d.kind === 'volley' || d.kind === 'powerVolley') kinds.add('volley');
        else if (d.kind === 'overhead') kinds.add('smash');
        wideShot = d.kind !== 'serve' && !!d.wide;
        pressed = !!d.stretched || !!d.note;
      }
      // whose shot is in the air: an error is only ours when it was our rally shot
      lastRally = d.side === side && d.kind !== 'serve';
      return out(got, {}, best, null);
    }
    // the opponent just ran past the yellow line into the parking bays
    // (it counts there and then, whoever goes on to win the point)
    function parked(d) {
      const got = new Set();
      if (d.side === opp) got.add('parking');
      return out(got, {}, {}, null);
    }
    return { side, mode, point, hit, parked, state };
  }

  // one match's stats: points won (and played), aces and so on
  const TOTAL_KEYS = ['points', 'played', 'aces', 'doubleFaults', 'winners', 'unforcedErrors', 'longestRally', 'fastestServe'];
  function blankTotals() { return Object.fromEntries(TOTAL_KEYS.map((k) => [k, 0])); }

  // ---------------- saved record ----------------
  // { earned: { id: { n: times earned, at: first earned (ms since 1970) } },
  //   stats: { all | chill | club | pro | online: STAT_KEYS } }
  const KEY = 'ct.achievements';
  const STAT_KEYS = ['played', 'won', 'streak', 'bestStreak', 'games', 'points', 'aces', 'doubleFaults', 'winners', 'unforcedErrors', 'longestRally', 'fastestServe'];
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

  // ---------------- match history ----------------
  // Finished matches, newest first, saved under 'ct.history' (the last
  // HISTORY_MAX of them). Each is { at (ms since 1970), mode (CPU level id
  // or 'online'), me, opp (character ids), won, games: [ours, theirs],
  // tiebreak: [ours, theirs] or null, totals: this match's stats }.
  // A match that was quit before the end isn't in it.
  const HISTORY_KEY = 'ct.history', HISTORY_MAX = 50;
  function loadHistory() {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(HISTORY_KEY) || 'null'); } catch (e) { /* storage is optional */ }
    return Array.isArray(v) ? v.filter((h) => h && typeof h === 'object' && Array.isArray(h.games)) : [];
  }
  function addHistory(entry) {
    const list = [entry, ...loadHistory()].slice(0, HISTORY_MAX);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* storage is optional */ }
    return list;
  }

  CT.ACHIEVEMENTS = ACHIEVEMENTS;
  CT.loadHistory = loadHistory;
  CT.addHistory = addHistory;
  CT.HISTORY_MAX = HISTORY_MAX;
  CT.achievement = (id) => BY_ID[id];
  CT.createAchievementTracker = createTracker;
  CT.loadAchievements = load;
  CT.recordAchievements = record;
  CT.achievementStats = (rec, mode) => (rec.stats[mode] ? statsFor(rec, mode) : blankStats());
})();
