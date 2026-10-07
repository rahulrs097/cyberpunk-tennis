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
- **Direction** is the swipe angle (`aim`). **Swipe speed** sets `pace`: fast = fast and flat, slow = more spin and less speed (`computeShot`).
- **Up = topspin, down = backspin, a bowed swipe = sidespin** (`spinDir`, `curve`).
- **Timing.** Each wing has its own window per character (`window.fh` / `window.bh`). Being late or early by `err` drifts the shot: late forehand right, early forehand left, late backhand left, early backhand right. It also costs power in proportion to how far off it was (`powerF`).
- **Stamina.** Running drains it, and every metre run also lowers a hard cap for the rest of the set (`cap`). Repeated power shots cost 3, 6, 9… Low stamina slows running, cuts power and narrows timing windows.
- **Overheads** above the player's `overheadZ` are very fast and cost no stamina. **Power shots** happen above 1.3 m. **Volleys** happen when you meet the ball before it bounces.
- **Randomness** only appears in `cpuChooseShot` / `cpuChooseServe`. CPU errors are deterministic: they come from being rushed, tired, the pace of the incoming ball, and how much pace the CPU itself chose.

## Multiplayer later

All input goes through `CT.requestMove`, `CT.requestToss` and `CT.requestSwipe(game, side, input)`, and
`game.control` marks each side as `human` or `cpu`. An online mode can relay those calls between two
clients (or run the engine on a server) without changing the rules code; the simulation is fixed-step and deterministic.
