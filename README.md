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
| `js/render.js` | Perspective camera and neon arena |
| `js/main.js` | Touch input, HUD, sound, frame loop |

## How the spec maps to the code

- **Swipe = shot, tap = move.** `main.js` `handleSwipe` / `handleTap`.
- **Direction** is where the swipe points on screen: from the ball, along the swipe, to the back of the court (`pointAt` in `main.js`), so it allows for the camera's angle and perspective. The spot is kept 0.45 m inside the sidelines. **Swipe speed** sets `pace`: fast = fast and flat, slow = more spin and less speed (`computeShot`). A well-timed shot always lands in: when clearing the net would carry it long, it comes off with less pace.
- **Up = topspin, down = backspin, a bowed swipe = sidespin** (`spinDir`, `curve`).
- **Lob:** a slow upward swipe (under 0.55 screens per second, and not a short one) sets `input.lob`, the same topspin lob the CPU uses.
- **Timing.** Each wing has its own window per character (`window.fh` / `window.bh`). Being late or early by `err` drifts the shot: late forehand right, early forehand left, late backhand left, early backhand right. It also costs power and height in proportion to how far off it was (`powerF`), so a badly mistimed ball lands short or finds the net.
- **Stamina.** Running drains it, and every metre run also lowers a hard cap for the rest of the set (`cap`). Repeated power shots cost 3, 6, 9… Low stamina slows running, cuts power and narrows timing windows; below 35 the bar pulses red and the CPU starts running you side to side. Between points you get a fixed breather (10, or 20 at a changeover); waiting before you serve adds nothing.
- **Overheads** above the player's `overheadZ` are very fast and cost no stamina. **Power shots** happen above 1.3 m. **Volleys** happen when you meet the ball before it bounces.
- **Randomness** only appears in `cpuChooseShot` / `cpuChooseServe`. CPU errors on groundstrokes are deterministic: they come from being rushed, tired, the pace of the incoming ball, and how much pace the CPU itself chose. CPU serves get a random timing error, so some miss.
- **CPU tactics** come from each character's `tactics` block: Octopus counterpunches (steady pace, away from the lines, passes or lobs a net rusher); Philosopher attacks (aims at your weaker wing, follows short balls in, sometimes serves and volleys). The ball speed setting also sets how often the CPU mistimes, how fast it reads a shot and how well it covers the angles (`CPU_ERR`, `CPU_REACT`, `CPU_COVER` in `main.js`). The CPU keeps 0.4 m over the net and lifts low balls (a dug-out drop shot) instead of driving them.
- **Serve clock.** Online, a server has 20 seconds to toss; running out costs the serve.

## Multiplayer later

All input goes through `CT.requestMove`, `CT.requestToss` and `CT.requestSwipe(game, side, input)`, and
`game.control` marks each side as `human` or `cpu`. An online mode can relay those calls between two
clients (or run the engine on a server) without changing the rules code; the simulation is fixed-step and deterministic.
