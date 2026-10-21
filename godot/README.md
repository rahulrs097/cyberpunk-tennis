# Cyberpunk Tennis in Godot

The rebuild of the web game as a 3D Godot 4.5 app for Android. The web game
in the repository root stays as it is. Both run the same rules, and the
tests prove it.

## Layout

| Path | What it holds |
| --- | --- |
| `engine/` | The match engine, a line-for-line GDScript port of `js/physics.js`, `js/match.js`, `js/game.js` and the stats in `js/characters.js` |
| `native/` | `FastFlight`, the ball flight in C++ (a GDExtension). The shot solver flies thousands of trial balls per shot. That is 10 to 40 ms in GDScript and under 1 ms in C++. If the library isn't built, the engine falls back to GDScript with identical results |
| `game/` | The app. `arena.gd` is the rooftop court, `actors.gd` the players and ball, `camera_rig.gd` the chase and first-person views, `main.gd` the input and match loop, `hud.gd` the menus and HUD (the web game's design, from `neon.gd`), `billboard.gd` the HHORNS sign, and `settings.gd` the saved settings and graphics presets |
| `art/` | Assets from the Blender art tests: the parked cars, the character portraits, and `skyline_pano.png`, the city skyline baked into a 360° strip by `skyline_pano.py` from the court scene (the sky shader draws it behind everything, on every preset). Also the billboard photo |
| `fonts/` | Tektur and Chakra Petch, the web game's fonts (SIL Open Font License) |
| `tests/` | `js_trace.js` records seeded sets from the JS engine. `parity.gd` replays them in GDScript and checks every event. `input_smoke.gd` drives the app with touches |

## Graphics presets

Every preset targets a steady 60 fps (`Engine.max_fps = 60`):

| | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| 3D resolution | 60% | 75% | 90% | 100% |
| Anti-aliasing | none | FXAA | MSAA 2x | MSAA 4x |
| Neon glow | off | on | high | high |
| Lamp shadows | none | none | 2 lamps | all 6 |
| Car underglow lights, outer car rows | no | no | yes | yes |

**Auto** is the default. On first launch it times the High preset in the menu for three seconds, using GPU time per frame, and picks the preset that fits. During play, if three seconds average under 50 fps, it drops one preset and says so. You can pick a preset yourself in the menu or the pause screen.

## Running it

- **Editor:** open `godot/project.godot` in Godot 4.5.1. To use FastFlight, build it first (see below). Without it, the game runs on the GDScript fallback.
- **Tests:** run these from the repository root:
  ```
  node godot/tests/js_trace.js
  godot --headless --path godot -s tests/parity.gd
  CT_NO_NATIVE=1 godot --headless --path godot -s tests/parity.gd
  godot --headless --path godot -s tests/input_smoke.gd
  ```
- **FastFlight:** you need a checkout of godot-cpp at tag `godot-4.5-stable`:
  ```
  cd godot/native
  GODOT_CPP=/path/to/godot-cpp scons platform=linux target=template_release
  ```
  It is built with `-ffp-contract=off`, so it matches the other engines bit for bit.
- **APK:** the `Godot` GitHub Actions workflow builds a debug-signed `cyberpunk-tennis.apk` on every push. Download it from the run's artifacts and sideload it. The workflow also runs the tests above.
- **Screenshots:** this command renders a screenshot without touching the screen:
  ```
  godot --path godot -- --shot=out.png --at=8 --preset=high --demo
  ```

## Still to come

- The real Octopus and Philosopher models with rigs and animation, replacing the stand-ins
- Online multiplayer: the same room codes and relay as the web game, so phones cross-play with browsers
- The tutorial (the engine already has the drills), sound and music
- Baked lighting and textures for the court
