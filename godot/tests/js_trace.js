// Plays seeded sets with the JS engine and writes every hit, bounce and point
// to tests/traces/*.json, for the GDScript port to replay (parity.gd).
// Run from the repo root: node godot/tests/js_trace.js
const fs = require('fs');
const path = require('path');
const { loadEngine, makeBot } = require('../../tests/engine.js');

// [name, seed, level, p0, p1, control of side 0]
const CASES = [
  ['cpu_pro_octo_phil', 1, 'pro', 'octopus', 'philosopher', 'cpu'],
  ['cpu_chill_phil_octo', 7, 'chill', 'philosopher', 'octopus', 'cpu'],
  ['bot_club_octo_phil', 3, 'club', 'octopus', 'philosopher', 'bot'],
];

function trace(name, seed, level, p0, p1, ctl) {
  const CT = loadEngine(seed);
  const events = [];
  let g = null;
  const opts = {
    p0, p1, control: [ctl === 'bot' ? 'human' : 'cpu', 'cpu'], autoMove: [ctl === 'bot', false], ...CT.levelOpts(level),
    onEvent: (t, d) => {
      const b = g ? g.ball : null;
      if (t === 'hit') events.push(['hit', g.time, d.side, d.kind, d.wing, b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.spin, b.side]);
      else if (t === 'bounce') events.push(['bounce', g.time, d.x, d.y]);
      else if (t === 'point') events.push(['point', g.time, d.winner, d.text, d.result]);
      else if (t === 'fault') events.push(['fault', g.time, d.text]);
      else if (t === 'whiff') events.push(['whiff', g.time, d.side, d.reason]);
    },
  };
  g = CT.createGame(opts);
  const bot = ctl === 'bot' ? makeBot(CT, g, 0, 0.5, CT.rand) : null;
  let wall = 0;
  while (g.phase !== 'matchOver' && wall < 3600) {
    if (bot) bot();
    CT.updateGame(g, 1 / 60);
    wall += 1 / 60;
  }
  const out = { name, seed, level, p0, p1, ctl, games: g.match.games, events };
  fs.writeFileSync(path.join(__dirname, 'traces', name + '.json'), JSON.stringify(out));
  console.log(name, g.match.games.join('-'), events.length, 'events');
}

for (const c of CASES) trace(...c);
