# Rooftop bake (3D graphics level)

Makes `models/rooftop/`, the scenery the 3D graphics level (js/render3d.js)
draws, in the style of three.js's "Littlest Tokyo" example: low-poly shapes
with all their light baked into textures in Blender, so the phone draws them
with no live lights.

- `scene.py` builds the rooftop at night to the game's layout (the court, the
  lamps and their colours, the cars in the game's bays, parapets, stair tower,
  HVAC units). It is `court.py` from the Blender court test, with its render
  step removed.
- `bake.py` adds the clutter (water tank, vending machines, crates, barrels,
  plants, pipes, festoon lights), removes what the game draws itself (net,
  billboard, skyline, moon), then:
  - renders the ground straight down (`ground.png`: x -30..30 m,
    y -21.8..17.8 m) with everything standing on it casting light and shadow,
  - joins everything standing on the roof into one low-poly mesh, bakes its
    diffuse light into one atlas (`props.png`) and exports the mesh
    (`props.glb`, no materials).

Glossy light is left out (roughness 1 everywhere): a bake is seen from every
angle, so only diffuse light holds up.

## Run

Needs Blender's Python module (`pip install bpy`, Python 3.11).

```
python bake.py OUT GROUND_WIDTH_PX PROPS_ATLAS_PX SAMPLES
python bake.py out 4096 4096 64
```

Then convert the two PNGs to JPEG (quality ~85) and copy them with
`props.glb` into `models/rooftop/` as `ground.jpg`, `props.jpg`, `props.glb`.
If the ground's extent changes, change `GROUND` in js/render3d.js to match.
