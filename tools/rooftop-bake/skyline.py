# The skyline round the roof as a panorama strip (skyline.png), seen from
# the court at eye height: towers, their windows, beacons and the moon, on
# a clear background (the game draws the sky behind it).
# Usage: python skyline.py OUTDIR WIDTH SAMPLES
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
_OUT, W, SAMPLES = sys.argv[-3], int(sys.argv[-2]), int(sys.argv[-1])
exec(open(os.path.join(HERE, 'scene.py')).read())
OUT = _OUT; os.makedirs(OUT, exist_ok=True)
import bpy
LAT0, LAT1 = -6.0, 24.0    # degrees below and above the horizon
for o in list(bpy.data.objects):
    n = o.name.split('.')[0]
    keep = n == "Tower" or (o.type == 'MESH' and n == "Sphere" and (max(o.dimensions) > 1.0 or o.location.z > 3))
    if not keep: bpy.data.objects.remove(o, do_unlink=True)
scn.render.engine = 'CYCLES'; scn.cycles.device = 'CPU'; scn.cycles.samples = SAMPLES; scn.cycles.use_denoising = True
scn.render.film_transparent = True
scn.view_settings.view_transform = 'Standard'; scn.view_settings.look = 'None'
scn.view_settings.exposure = float(os.environ.get("EXPOSURE", "0.6"))
c = bpy.data.cameras.new("pano"); c.type = 'PANO'; c.panorama_type = 'EQUIRECTANGULAR'
c.latitude_min, c.latitude_max = math.radians(LAT0), math.radians(LAT1)
c.longitude_min, c.longitude_max = -math.pi, math.pi
c.clip_end = 3000
co = link(bpy.data.objects.new("pano", c)); co.location = (0, 0, 5); co.rotation_euler = (math.pi / 2, 0, 0)   # facing +y, down the court
scn.camera = co
scn.render.resolution_x = W; scn.render.resolution_y = round(W * (LAT1 - LAT0) / 360)
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
scn.render.filepath = os.path.join(OUT, "skyline.png")
bpy.ops.render.render(write_still=True)
print("SKYLINE", W, scn.render.resolution_y, LAT0, LAT1)
