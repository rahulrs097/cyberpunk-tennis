# Cyberpunk Tennis

Mobile-first tennis on an HTML canvas. Plain HTML and JavaScript, no build step:
open `index.html` through any static web server (or `_test.html` straight from disk,
which only adds the doctype and viewport tags the artifact host normally supplies).

## Files

| File | What it holds |
| --- | --- |
| `index.html` | Markup, styles, menus, HUD |
| `js/physics.js` | Court geometry, ball flight (drag, topspin dip, sidespin curve, bounce), shot solver |
| `js/characters.js` | Octopus and Philosopher stats and their procedurally drawn sprites |
| `js/match.js` | Scoring: one set, 7-point tiebreak at 6-6 |
| `js/game.js` | Match engine: serving, hitting, timing, line calls, stamina, CPU |
| `js/achievements.js` | Achievements and stats: what counts, the per-match tracker, the record saved in localStorage |
| `js/render.js` | Perspective camera (chase or first person) and neon arena |
| `js/main.js` | Touch input, HUD, sound, frame loop, tutorial lessons |
| `tests/` | Engine tests (`npm test`) and the balance simulation (`npm run sim`) |

## How the spec maps to the code

- **Swipe = shot, tap = move.** `main.js` `handleSwipe` / `handleTap`.
- **Direction** is where the swipe points on screen: from the ball, along the swipe, to the back of the court (`pointAt` in `main.js`), so it allows for the camera's angle and perspective. The spot is kept 0.45 m inside the sidelines. **Swipe speed** sets `pace`: fast = fast and flat, slow = more spin and less speed (`computeShot`). A well-timed shot always lands in: when clearing the net would carry it long, it comes off with less pace.
- **Up = topspin, down = backspin, a bowed swipe = sidespin** (`spinDir`, `curve`).
- **Lob:** a slow, long upward swipe (at least 0.22 screens, averaging under 1.4 screens per second over the whole swipe) sets `input.lob`, the same topspin lob the CPU uses. A player's lob always goes deep, its timing is judged from the middle of the swipe (`input.lead`, up to `LOB_LEAD`) rather than when the finger lifts, and its timing window is `LOB_EASE` times wider.
- **Timing.** Each wing has its own window per character (`window.fh` / `window.bh`). Being late or early by `err` drifts the shot: late forehand right, early forehand left, late backhand left, early backhand right. It also costs power and height in proportion to how far off it was (`powerF`), so a badly mistimed ball lands short or finds the net. Your position counts as extra mistiming (`balance` in `computeShot`): a ball jammed within 0.3 m of your body, one beyond 60% of your reach, or one hit while running faster than 30% of top speed. The shot callout says Jammed, Stretched or On the run. A swipe too early, too late or out of reach still swings the racket and misses (`swingMiss`); so does a CPU that gets to a ball a step too late.
- **Chasing.** The CPU and automove (`cpuPlan`) run at a ball that will land up to `CHASE_OUT` (1 m) out, as a real player would before reading it as out, then let it go. A ball further out than that, they leave and recover.
- **Stamina.** Running drains it, and every metre run also lowers a hard cap for the rest of the set (`cap`). Back-to-back power groundstrokes cost 3, 6, 9…; a volley, power volley or overhead costs nothing extra and resets the count, so attacking the net isn't punished. Low stamina slows running, cuts power and narrows timing windows; below 35 the bar pulses red and the CPU starts running you side to side. Every swing costs 0.4. Between points you get back 30% of what you're missing (60% at a changeover), so a long rally leaves you tired for the next few points and stamina wears down over a set; waiting before you serve adds nothing.
- **Overheads** above the player's `overheadZ` are very fast and cost no stamina. **Power shots** happen above 1.3 m. **Volleys** happen when you meet the ball before it bounces.
- **Randomness** only appears in `cpuChooseShot` / `cpuChooseServe`. CPU errors on groundstrokes are deterministic: they come from being rushed, tired, the pace of the incoming ball, and how much pace the CPU itself chose. CPU serves get a random timing error, so some miss.
- **CPU tactics** come from each character's `tactics` block: Octopus plays steady pressure (deep, heavy balls with big margins, worked into your weaker wing, few errors, rarely goes for broke, passes or lobs a net rusher); Philosopher is aggressive and creative (big pace, goes for winners early, follows short balls in, serves and volleys, mixes in drop shots, short angles and hitting behind you, likes the wide serve). Each has its own point patterns (`patterns`), appetite for winners (`attack`) and error rate (`err`). The menu's level (Chill, Club, Pro) sets the ball speed and how the CPU plays (`CT.CPU_LEVELS` in `game.js`): how often it mistimes, how fast it reads a shot, how well it covers the angles, how fast it runs, how hard and deep it hits, how often it goes for winners (`attack`) and how much it thinks (`smart`). A thinking CPU plays a pattern each point (work the weak wing then the open court, side to side, or behind you), learns during the match which of your wings misses more and whether you like the net (`g.scout`), serves to a target (wide, body or T, second serves to your weaker wing), and takes more risk when behind and less when well ahead. Its rally ball goes cross-court from a wide position (`cross`). It mistimes both ways, early (pulled across) as well as late (pushed down the line), and its misses are split between long or wide, the net, and short sitters (`cpuHit`). The CPU keeps 0.4 m over the net and lifts low balls (a dug-out drop shot) instead of driving them.
- **Tutorial.** Eleven lessons against a ball machine (`drill` in `createGame`): serve, forehand, backhand, aim left and right, slice, drop shot, lob, then volley and smash at the net (`drill.feed`), and finally a real point against the Chill CPU. The machine (control `'feeder'`) never returns the ball; each rep ends at the first bounce with a `drill` event, and `LESSONS` in `main.js` decides which reps count.
- **Camera.** Chase (behind and above you, the default) or first person (from your eyes, with your racket in the corner). Switch with the 1P/3P button in the HUD, the Camera option on the menu, or the C key; the choice is remembered (`setView` in `render.js`).
- **Achievements and stats.** `createAchievementTracker` follows your side through a match from its `point` and `hit` events and says what each point earned; `main.js` saves it to localStorage (`ct.achievements`), puts each unlock on the billboard after the point's word (the common ones only the first time), and lists unlocked achievements and per-level stats on the Achievements screen. Locked ones aren't shown anywhere. Pro achievements only count against the Pro CPU; the tutorial doesn't count.
- **Serve clock.** Online, a server has 20 seconds to toss; running out costs the serve.

## Tests

`npm test` runs the engine tests with Node's built-in test runner (Node 20+, nothing to install): scoring, the shot solver, timing penalties, whole CPU sets, the tutorial drills and online snapshots. GitHub Actions runs them on every push and pull request.

`npm run sim` plays seeded sets between a scripted player and each CPU level and prints who wins, how low stamina gets and how long the rallies are. Run it after changing anything that affects balance.

## Multiplayer later

All input goes through `CT.requestMove`, `CT.requestToss` and `CT.requestSwipe(game, side, input)`, and
`game.control` marks each side as `human` or `cpu`. An online mode can relay those calls between two
clients (or run the engine on a server) without changing the rules code; the simulation is fixed-step and deterministic.
