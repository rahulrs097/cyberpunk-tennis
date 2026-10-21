# Bake the Blender skyline (towers, beacons, the street below) into a panorama
# strip for Godot's sky shader. Everything near (the deck, court, cars, lamps,
# billboard, moon) is removed; the sky itself is transparent so Godot keeps
# its own gradient and stars.
# The strip covers every longitude and latitudes LAT_MIN..LAT_MAX. It is
# rendered 8192 wide and saved stacked as 4096 x 2H (left half on top) so it
# fits phones' 4096 texture limit.
# Usage: python skyline_pano.py SAMPLES OUT.png
import bpy, math, sys, os
import numpy as np
sys.path.insert(0, "/tmp/claude-0/oct")
from rlib import setup_cycles

SAMPLES = int(sys.argv[-2]); OUT = sys.argv[-1]
LAT_MIN, LAT_MAX = -10.0, 26.0
W = int(os.environ.get("PW", "8192")); H = int(round(W * (LAT_MAX - LAT_MIN) / 360.0))

bpy.ops.wm.open_mainfile(filepath="/tmp/claude-0/oct/out/court.blend")
scn = bpy.context.scene
keep_mats = {"Towers", "Beacon", "Street"}
for o in list(scn.objects):
    if o.type == 'LIGHT' and o.name == "moonlight":
        continue
    if o.type == 'MESH' and o.data.materials and o.data.materials[0] and o.data.materials[0].name in keep_mats:
        continue
    bpy.data.objects.remove(o, do_unlink=True)

# the street reaches the horizon all the way round
st = scn.objects["Street"]; st.scale = (4.0, 4.0, 1.0); st.location = (0, -200, 0)

c = bpy.data.cameras.new("pano"); c.type = 'PANO'
c.panorama_type = 'EQUIRECTANGULAR'
c.latitude_min, c.latitude_max = math.radians(LAT_MIN), math.radians(LAT_MAX)
c.longitude_min, c.longitude_max = -math.pi, math.pi
co = bpy.data.objects.new("pano", c); scn.collection.objects.link(co)
co.location = (0, -6, 5)          # over the court, at about the chase camera's height
co.rotation_euler = (math.radians(90), 0, 0)   # facing +y (the far end)
scn.camera = co

setup_cycles(SAMPLES, (W, H))
# Linear (Standard) so Godot tone-maps it once, with the court render's
# exposure (0.3) less GAIN stops so the brightest windows stay under 1.0;
# the sky shader multiplies by 2^GAIN to restore them (and they bloom).
GAIN = 1.7
scn.view_settings.view_transform = 'Standard'; scn.view_settings.look = 'None'
scn.view_settings.exposure = 0.3 - GAIN
scn.render.use_compositing = False
scn.render.film_transparent = True
scn.render.image_settings.color_mode = 'RGBA'
scn.render.filepath = OUT + ".full.png"
bpy.ops.render.render(write_still=True)

img = bpy.data.images.load(OUT + ".full.png")
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)   # rows bottom-up
st = np.concatenate([px[:, W // 2:], px[:, :W // 2]], axis=0)     # bottom rows: right half
out = bpy.data.images.new("stack", W // 2, 2 * H, alpha=True)
out.pixels[:] = st.ravel()
out.filepath_raw = OUT; out.file_format = 'PNG'
out.save()
print("PANO", W, H, LAT_MIN, LAT_MAX)
