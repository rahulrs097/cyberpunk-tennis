// Scoring for one set, with a first-to-7 (win by 2) tiebreak at 6-6.
(function () {
  const CT = (window.CT = window.CT || {});

  function createMatch(firstServer) {
    return {
      games: [0, 0],
      points: [0, 0],
      tiebreak: false,
      tbFirstServer: 0,
      server: firstServer,
      firstServe: true,
      over: false,
      winner: -1,
      log: [],
    };
  }

  function pointsPlayed(m) { return m.points[0] + m.points[1]; }

  // true when the next serve is from the deuce (right-hand) court
  function deuceSide(m) { return pointsPlayed(m) % 2 === 0; }

  function currentServer(m) {
    if (!m.tiebreak) return m.server;
    const n = pointsPlayed(m);
    const block = Math.floor((n + 1) / 2);
    return block % 2 === 0 ? m.tbFirstServer : 1 - m.tbFirstServer;
  }

  // Award a point. Returns 'point' | 'game' | 'set'.
  function awardPoint(m, w) {
    const o = 1 - w;
    m.points[w]++;
    m.firstServe = true;
    if (m.tiebreak) {
      if (m.points[w] >= 7 && m.points[w] - m.points[o] >= 2) {
        m.games[w]++;
        m.log.push(m.points.slice());
        m.over = true; m.winner = w;
        return 'set';
      }
      return 'point';
    }
    if (m.points[w] >= 4 && m.points[w] - m.points[o] >= 2) {
      m.games[w]++;
      m.points = [0, 0];
      m.server = 1 - m.server;
      const gw = m.games[w], go = m.games[o];
      if (gw >= 6 && gw - go >= 2) { m.over = true; m.winner = w; return 'set'; }
      if (gw === 6 && go === 6) { m.tiebreak = true; m.tbFirstServer = m.server; }
      return 'game';
    }
    return 'point';
  }

  function pointLabel(m, side) {
    if (m.tiebreak) return String(m.points[side]);
    const a = m.points[side], b = m.points[1 - side];
    if (a >= 3 && b >= 3) {
      if (a === b) return '40';
      return a > b ? 'AD' : '40';
    }
    return ['0', '15', '30', '40'][a];
  }

  function callout(m) {
    if (m.tiebreak) return 'Tiebreak';
    const [a, b] = m.points;
    if (a >= 3 && b >= 3 && a === b) return 'Deuce';
    return '';
  }

  CT.createMatch = createMatch;
  CT.awardPoint = awardPoint;
  CT.pointLabel = pointLabel;
  CT.deuceSide = deuceSide;
  CT.currentServer = currentServer;
  CT.matchCallout = callout;
})();
