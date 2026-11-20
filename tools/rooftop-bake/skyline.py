# The city round the roof as a panorama strip (skyline.png), seen from the
# court at eye height: a far-off city (1.2-4 km away) of small hazy towers with
# speckled windows and beacons, the dark streets below it, and the moon, on a
# clear background (the game draws the sky behind it).
# Usage: python skyline.py OUTDIR WIDTH SAMPLES
import sys, os, math, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
_OUT, W, SAMPLES = sys.argv[-3], int(sys.argv[-2]), int(sys.argv[-1])
exec(open(os.path.join(HERE, 'scene.py')).read())
OUT = _OUT; os.makedirs(OUT, exist_ok=True)
import bpy
LAT0, LAT1 = -4.0, 14.0    # degrees below and above the horizon (must match render3d.js)
for o in list(bpy.data.objects):
    n = o.name.split('.')[0]
    keep = o.type == 'MESH' and n == "Sphere" and max(o.dimensions) > 10   # the moon only: the near towers go
    if not keep: bpy.data.objects.remove(o, do_unlink=True)

# ---- the far city: towers whose windows are a speckle at this distance, fading into purple haze
city, N, L, p = M("FarCity")
geo = N.new("ShaderNodeNewGeometry")
sx_ = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": geo.outputs["Position"]})
u = math_(N, L, 'ADD', sx_.outputs["X"], sx_.outputs["Y"])
cx = node(N, L, "ShaderNodeCombineXYZ", {"X": u, "Y": sx_.outputs["Z"]})
br = node(N, L, "ShaderNodeTexBrick", {"Vector": cx.outputs[0], "Scale": 1.0, "Brick Width": 3.0, "Row Height": 3.6, "Mortar Size": 0.8, "Mortar Smooth": 0.1,
          "Color1": (0, 0, 0, 1), "Color2": (1, 1, 1, 1), "Mortar": (0, 0, 0, 1), "Bias": 0.0}, offset=0.0, squash=1.0)
r_ = node(N, L, "ShaderNodeSeparateColor", {"Color": br.outputs["Color"]}).outputs[0]
on = math_(N, L, 'MULTIPLY', math_(N, L, 'GREATER_THAN', r_, 0.72), math_(N, L, 'SUBTRACT', 1.0, br.outputs["Fac"]))
wcol = mix(N, L, srgb("#ffc878"), srgb("#25d9ff"), math_(N, L, 'GREATER_THAN', r_, 0.9))
wcol = mix(N, L, wcol, srgb("#ff3fb4"), math_(N, L, 'GREATER_THAN', r_, 0.965))
cam_d = N.new("ShaderNodeCameraData").outputs["View Distance"]
haze = math_(N, L, 'MULTIPLY', node(N, L, "ShaderNodeMapRange", {"Value": cam_d, "From Min": 900.0, "From Max": 4200.0, "To Min": 0.25, "To Max": 0.9}).outputs[0],
             node(N, L, "ShaderNodeMapRange", {"Value": sx_.outputs["Z"], "From Min": 160.0, "From Max": -DROP, "To Min": 0.55, "To Max": 1.0}).outputs[0])
HAZE = srgb("#2a1033")
L.new(mix(N, L, (0.004, 0.003, 0.008, 1), (0.02, 0.006, 0.025, 1), haze), p.inputs["Base Color"])
L.new(mix(N, L, mix(N, L, (0, 0, 0, 1), wcol, on), HAZE, haze), p.inputs["Emission Color"])
p.inputs["Emission Strength"].default_value = 1.2; p.inputs["Roughness"].default_value = 1.0
beacon = emit("Beacon", (1.0, 0.05, 0.05, 1), 25.0)
rng = random.Random(9)
for i in range(1100):
    ang = rng.uniform(-math.pi, math.pi)
    dist = 1200 + 2800 * rng.random() ** 0.7
    x, y = dist * math.sin(ang), dist * math.cos(ang)
    # a denser downtown ahead, behind the far baseline
    tall = 1.0 + 1.6 * math.exp(-((ang - 0.15) / 0.35) ** 2)
    h = rng.uniform(20, 70) * tall * (2.2 if rng.random() > 0.9 else 1.0)
    wx, wy = rng.uniform(25, 60), rng.uniform(25, 60)
    o = box("Tower", (-wx / 2, -wy / 2, -DROP), (wx / 2, wy / 2, h - DROP), city)
    o.location = (x, y, 0); o.rotation_euler = (0, 0, rng.uniform(-0.6, 0.6))
    if h > 110 and rng.random() > 0.4:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=2.0, location=(x, y, h - DROP + 3), segments=8, ring_count=4)
        bpy.context.active_object.data.materials.append(beacon)

# ---- the streets below: dark, with a faint glow of street lights fading into the haze
street, N, L, p = M("Streets")
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
vor = node(N, L, "ShaderNodeTexVoronoi", {"Vector": tc, "Scale": 0.05})
lit = math_(N, L, 'LESS_THAN', vor.outputs["Distance"], 0.12)
cd2 = N.new("ShaderNodeCameraData").outputs["View Distance"]
fade = node(N, L, "ShaderNodeMapRange", {"Value": cd2, "From Min": 300.0, "From Max": 4000.0, "To Min": 0.1, "To Max": 0.85}).outputs[0]
L.new(mix(N, L, mix(N, L, (0.006, 0.004, 0.012, 1), srgb("#ffb35c"), lit), HAZE, fade), p.inputs["Emission Color"])
p.inputs["Emission Strength"].default_value = 0.6; p.inputs["Base Color"].default_value = (0, 0, 0, 1)
bpy.ops.mesh.primitive_plane_add(size=12000, location=(0, 0, -DROP - 0.5)); bpy.context.active_object.data.materials.append(street)

scn.render.engine = 'CYCLES'; scn.cycles.device = 'CPU'; scn.cycles.samples = SAMPLES; scn.cycles.use_denoising = True
scn.render.film_transparent = True
scn.view_settings.view_transform = 'Standard'; scn.view_settings.look = 'None'
scn.view_settings.exposure = float(os.environ.get("EXPOSURE", "0.6"))
c = bpy.data.cameras.new("pano"); c.type = 'PANO'; c.panorama_type = 'EQUIRECTANGULAR'
c.latitude_min, c.latitude_max = math.radians(LAT0), math.radians(LAT1)
c.longitude_min, c.longitude_max = -math.pi, math.pi
c.clip_end = 9000
co = link(bpy.data.objects.new("pano", c)); co.location = (0, 0, 5); co.rotation_euler = (math.pi / 2, 0, 0)   # facing +y, down the court
scn.camera = co
scn.render.resolution_x = W; scn.render.resolution_y = round(W * (LAT1 - LAT0) / 360)
scn.render.resolution_percentage = 100
scn.render.image_settings.file_format = 'PNG'; scn.render.image_settings.color_mode = 'RGBA'
scn.render.filepath = os.path.join(OUT, "skyline.png")
bpy.ops.render.render(write_still=True)
print("SKYLINE", W, scn.render.resolution_y, LAT0, LAT1)
