// Balance check: a scripted player against each CPU level.
//   npm run sim                    all levels, three timing skills, 6 sets each
//   npm run sim -- club 0.7 10     one level and skill, 10 sets
// skill is the player's timing spread in timing windows: 0.4 is sharp,
// 0.7 average, 1.0 loose. Each set is seeded, so runs repeat exactly.
const { loadEngine, levelOpts, playSet } = require('./engine');

const [lv, sk, n] = process.argv.slice(2);
const levels = lv ? [lv] : ['chill', 'club', 'pro'];
const skills = sk ? [+sk] : [0.4, 0.7, 1.0];
const sets = +n || 6;

console.log('level  skill  sets won  games    lowest stamina (you/CPU)  tired at point end  shots/point');
for (const level of levels) {
  for (const skill of skills) {
    const won = [0, 0], games = [0, 0], low = [0, 0];
    let tired = 0, points = 0, shots = 0;
    for (let i = 0; i < sets; i++) {
      const CT = loadEngine(100 + i);
      const chars = i % 2 ? ['octopus', 'philosopher'] : ['philosopher', 'octopus'];
      const r = playSet(CT, { p0: chars[0], p1: chars[1], control: ['bot', 'cpu'], skill, extra: levelOpts(CT, level) });
      won[r.winner]++;
      games[0] += r.games[0]; games[1] += r.games[1];
      low[0] += r.stats.minStamina[0] / sets; low[1] += r.stats.minStamina[1] / sets;
      tired += r.stats.tiredPoints[0]; points += r.stats.points; shots += r.stats.shots;
    }
    console.log([level.padEnd(6), String(skill).padEnd(6), `${won[0]}-${won[1]}`.padEnd(9), `${games[0]}-${games[1]}`.padEnd(8),
      `${Math.round(low[0])}/${Math.round(low[1])}`.padEnd(25), `${Math.round((100 * tired) / points)}%`.padEnd(19), (shots / points).toFixed(1)].join(' '));
  }
}
