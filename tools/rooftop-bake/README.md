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
python bake.py out 4096 4096 64   # what models/rooftop uses (about 40 min on 4 cores)
```

Then convert the two PNGs to JPEG (quality ~85) and copy them with
`props.glb` into `models/rooftop/` as `ground.jpg`, `props.jpg`, `props.glb`.
If the ground's extent changes, change `GROUND` in js/render3d.js to match.

## Skyline

`skyline.py` renders a far-off city (1.2-4 km away: small hazy towers with
speckled windows, beacons, dark streets below) as a 360° strip (`skyline.png`,
transparent sky, latitude -4..14°) from the middle of the court. render3d.js
wraps it on a far cylinder, with a dark skirt below it so the city never
floats. If LAT0/LAT1 change, change them in render3d.js's loadSkyline too.

```
python skyline.py out 4096 48
```

## After the bake

```
python decimate.py out/props.glb ../../models/rooftop/props.glb 0.5   # 77k -> 39k triangles, UVs kept
```

Also save half-size copies of the two pictures as `ground_2k.jpg` and
`props_2k.jpg` (quality ~88). The Smooth and Balanced graphics levels load
those: a quarter of the GPU memory.

## skyline_city.png (the 3D themes' skyline)

`models/rooftop/skyline_city.png` is cut from the **Shanghai Bund** HDRI on Poly Haven (https://polyhaven.com/a/shanghai_bund), licensed CC0, using its tonemapped 8K JPG. To remake it, run `skyline_city.py` from the folder that holds `shanghai_bund.jpg`. It keeps the same -4..14 degree, 4096 x 205 layout as `skyline.py`, so `loadSkyline` in js/render3d.js takes either file.

## car.glb (the covered cars)

The 3D themes park Poly Haven's scanned **Covered Car** (https://polyhaven.com/a/covered_car, CC0) in about a third of the bays (a hash pick); `props.glb` no longer holds the baked cars in those bays. To redo it after a new bake, download the 1k glTF and then run:

```
python3 covered_car.py <folder with covered_car_1k.gltf>   # car.glb, car.jpg (colour x AO), car_nor.jpg; strips those bays' cars from props.glb (run once per fresh props.glb)
npm i meshoptimizer@0.21.0 && node car_lod.mjs 2000 160    # 12.6k -> ~4.1k triangles (cover, each wheel)
```

`loadCars` in js/render3d.js draws them as one instanced mesh, lit in its shader by the six lamps (the roof has no live lights).
