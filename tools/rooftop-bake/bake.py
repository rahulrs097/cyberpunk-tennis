# Bakes the rooftop (scene.py, from art/court-test/scripts/court.py) for the
# game's 3D graphics level, Littlest-Tokyo style: all the lighting is baked
# into textures, so the phone draws it with no live lights.
#
#   ground.png  a top-down render of the deck, court and markings
#               (x -30..30, y LOT_BACK..LOT_EDGE), with the props' shadows
#   props.glb + props.png  everything standing on the roof, joined into one
#               low-poly mesh with its light baked into one atlas
#
# Usage: python bake.py OUTDIR GROUND_W PROPS_SIZE SAMPLES
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
OUT, GW, PS, SAMPLES = sys.argv[-4], int(sys.argv[-3]), int(sys.argv[-2]), int(sys.argv[-1])
os.makedirs(OUT, exist_ok=True)
_OUT = OUT
exec(open(os.path.join(HERE, 'scene.py')).read())
OUT = _OUT
import bpy, bmesh
from mathutils import Vector

GX0, GX1 = -30.0, 30.0
GY0, GY1 = LOT_BACK - 0.3, LOT_EDGE + 0.3

# ------------------------------------------------ extra clutter (the diorama look)
def emit_m(name, hexc, k): return emit(name, srgb(hexc), k, base=(0.02, 0.02, 0.02, 1))
plastic, N_, L_, p_ = M("Plastic"); p_.inputs["Base Color"].default_value = srgb("#3a3f55"); p_.inputs["Roughness"].default_value = 0.6
rust, N_, L_, p_ = M("Rust"); p_.inputs["Base Color"].default_value = srgb("#5a3a2a"); p_.inputs["Roughness"].default_value = 0.8
leaf, N_, L_, p_ = M("Leaf"); p_.inputs["Base Color"].default_value = srgb("#1f5a3a"); p_.inputs["Roughness"].default_value = 0.7
wood, N_, L_, p_ = M("Wood"); p_.inputs["Base Color"].default_value = srgb("#6a4a2e"); p_.inputs["Roughness"].default_value = 0.8
# water tank on legs beside the stair tower
cyl("Tank", (21.5, 3.5, 4.6), 1.6, 2.6, rust, 20)
cyl("TankRoof", (21.5, 3.5, 6.05), 1.7, 0.3, metal, 20)
for dx, dy in ((-1.1, -1.1), (1.1, -1.1), (-1.1, 1.1), (1.1, 1.1)): cyl("TankLeg", (21.5 + dx, 3.5 + dy, 1.65), 0.08, 3.3, metal, 8)
# vending machines by the stair door, glowing fronts
for i, col in enumerate(("#25d9ff", "#ff3fb4")):
    x = 16.0 - i * 1.15
    box("Vending", (x - 0.5, 9.0, 0), (x + 0.5, 9.8, 1.9), plastic, bevel=0.02)
    box("VendFront", (x - 0.42, 8.97, 0.6), (x + 0.42, 9.0, 1.8), emit_m("Vend" + col, col, 6.0))
# crates and barrels in the corners
for i, (x, y) in enumerate(((-24, 15.5), (-22.6, 15.6), (-23.3, 14.4), (25, 15.2), (26.2, 15.0))):
    box("Crate", (x - 0.55, y - 0.55, 0), (x + 0.55, y + 0.55, 1.0 if i % 2 else 0.8), wood, bevel=0.02)
for x, y in ((-26, -19), (-25.1, -19.4), (26, -19.5)):
    cyl("Barrel", (x, y, 0.45), 0.32, 0.9, hazard if x > 0 else rust, 14)
# potted plants along the far parapet
for x in (-15, -11, 11, 15):
    cyl("Pot", (x, LOT_EDGE - 0.6, 0.3), 0.35, 0.6, plastic, 12)
    bpy.ops.mesh.primitive_ico_sphere_add(radius=0.55, subdivisions=1, location=(x, LOT_EDGE - 0.6, 0.95))
    o = bpy.context.active_object; o.name = "Bush"; o.data.materials.append(leaf)
# pipes along the side parapets: in the 2D game they're off screen, here
# they give the edges some detail
for sx in (-1, 1):
    for k, z in enumerate((0.35, 0.6)):
        cyl("Pipe", (sx * 27.5, (LOT_BACK + LOT_EDGE) / 2, z), 0.08 + k * 0.03, LOT_EDGE - LOT_BACK - 1, metal if k else rust, 10, 'Y')
# AC units and a dish on the stair roof
for dx in (-1.5, 1.2):
    box("RoofAC", (20 + dx - 0.7, 10, 4.4), (20 + dx + 0.7, 11.2, 5.2), hvac, bevel=0.03)
cyl("DishPole", (22, 13.5, 5.0), 0.05, 1.2, metal, 8)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.7, segments=16, ring_count=8, location=(22, 13.2, 5.7))
o = bpy.context.active_object; o.name = "Dish"; o.scale = (1, 0.3, 1); o.data.materials.append(metal)
# festoon lights strung between the far lamp posts and over the back
bulb = emit_m("Bulb", "#ffc878", 25.0)
def festoon(a, b, n, sag):
    for i in range(n + 1):
        t = i / n
        x = a[0] + (b[0] - a[0]) * t; y = a[1] + (b[1] - a[1]) * t
        z = a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)
        bpy.ops.mesh.primitive_ico_sphere_add(radius=0.07, subdivisions=1, location=(x, y, z))
        o = bpy.context.active_object; o.name = "Bulb"; o.data.materials.append(bulb)
    # the wire
    d = Vector(b) - Vector(a)
    cyl("Wire", ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 - sag * 0.6), 0.01, d.length, metal, 4, 'X').rotation_euler = (0, math.radians(90), math.atan2(d.y, d.x))
festoon((-7.7, 16.6, 6.0), (7.7, 16.6, 6.0), 22, 0.8)
for x in (-27, 27):
    festoon((x, LOT_BACK + 0.4, 2.4), (x, LOT_EDGE - 0.4, 2.4), 40, 0.4)

# ------------------------------------------------ what the game draws itself
def gone(o):
    bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    n = o.name.split('.')[0]
    if n in ("Billboard", "Tag", "BoardPanel", "Frame", "Pylon", "BoardGlow", "Tower", "Street", "Structure",
             "Net", "NetBand", "NetCable", "NetPost", "PostCap", "CentreStrap", "moonlight", "LineGlow"):
        gone(o)
    elif o.type == 'MESH' and n == "Sphere" and (max(o.dimensions) > 1.0 or o.location.z > 3):
        gone(o)   # the moon and the towers' beacons (the court-side balls stay)
# no glossy: a bake is seen from everywhere, so it holds only diffuse light
for m in bpy.data.materials:
    if not m.node_tree: continue
    for nd in m.node_tree.nodes:
        if nd.type == 'BSDF_PRINCIPLED':
            r_ = nd.inputs["Roughness"]
            for l in list(r_.links): m.node_tree.links.remove(l)
            r_.default_value = 1.0
            nd.inputs["Metallic"].default_value = min(nd.inputs["Metallic"].default_value, 0.3)
            for l in list(nd.inputs["Metallic"].links): m.node_tree.links.remove(l)
            if "Coat Weight" in nd.inputs: nd.inputs["Coat Weight"].default_value = 0.0
            if "Transmission Weight" in nd.inputs: nd.inputs["Transmission Weight"].default_value = 0.0
# the deck: just the part round the court, as a flat sheet
deck = bpy.data.objects["Deck"]; deck_mat = deck.data.materials[0]; gone(deck)
mesh_obj("Deck", [(-45, GY0, 0), (45, GY0, 0), (45, GY1, 0), (-45, GY1, 0)], [(0, 1, 2, 3)], deck_mat)

# Littlest Tokyo is lit softly all round, not just by its lamps: more sky
# light (the purple night), and a faint moon from above to shape the props
bg = scn.world.node_tree.nodes["Background"]
for l in list(bg.inputs["Color"].links): scn.world.node_tree.links.remove(l)
bg.inputs["Color"].default_value = (0.03, 0.028, 0.034, 1)   # a near-neutral night: no purple wash on the roof
bg.inputs["Strength"].default_value = float(os.environ.get("SKY", "2.2"))
moon = bpy.data.lights.new("moonfill", 'SUN'); moon.energy = float(os.environ.get("MOON", "0.25")); moon.color = (0.82, 0.85, 0.95); moon.angle = math.radians(8)
mo = link(bpy.data.objects.new("moonfill", moon)); mo.rotation_euler = Vector((-0.35, -0.6, -1.0)).to_track_quat('-Z', 'Y').to_euler()
# paint a little lighter, so the cars read under the lamps
for m in bpy.data.materials:
    if m.name.startswith("Paint") or m.name.startswith("Car"):
        for nd in (m.node_tree.nodes if m.node_tree else []):
            if nd.type == 'BSDF_PRINCIPLED':
                c = nd.inputs["Base Color"].default_value
                nd.inputs["Base Color"].default_value = (min(1, c[0] * 2.2), min(1, c[1] * 2.2), min(1, c[2] * 2.2), 1)

GROUND = ("Deck", "CourtSurround", "CourtSingles", "CourtPaint", "Line", "Lane", "Bay", "Plane", "Sphere")
def is_ground(o): return o.name.split('.')[0] in GROUND

scn.view_settings.view_transform = 'Standard'
scn.view_settings.look = 'None'
scn.render.engine = 'CYCLES'; scn.cycles.device = 'CPU'
scn.cycles.samples = SAMPLES; scn.cycles.use_denoising = True
scn.cycles.max_bounces = 4
scn.render.image_settings.file_format = 'OPEN_EXR'
scn.render.image_settings.color_depth = '32'
scn.render.film_transparent = False

# Baked light is stored linear, scaled by EXPOSE, clipped at white and
# sRGB-encoded (the game's tone mapping runs on top, as for everything else)
import numpy as np
from PIL import Image as PImage
EXPOSE = float(os.environ.get("EXPOSE", "3.0"))
def save_ldr(px, w, h, path, expose):
    a = np.asarray(px, dtype=np.float32).reshape(h, w, 4)[::-1, :, :3] * expose
    # a soft shoulder instead of a hard clip, so lamp pools don't burn out
    k = 0.6
    a = np.where(a < k, a, k + (1 - k) * (1 - np.exp(-(a - k) / (1 - k))))
    a = np.clip(a, 0, 1)
    a = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    PImage.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path, quality=88)

# ------------------------------------------------ 1. the ground: straight down, orthographic
for o in bpy.data.objects:
    if o.type in ('MESH', 'FONT', 'CURVE') and not is_ground(o):
        o.visible_camera = False   # still casts shadows and light
c = bpy.data.cameras.new("top"); c.type = 'ORTHO'; c.ortho_scale = GX1 - GX0
co = link(bpy.data.objects.new("top", c)); co.location = ((GX0 + GX1) / 2, (GY0 + GY1) / 2, 40); co.rotation_euler = (0, 0, 0)
c.clip_end = 100
scn.camera = co
scn.render.resolution_x = GW; scn.render.resolution_y = round(GW * (GY1 - GY0) / (GX1 - GX0))
scn.render.resolution_percentage = 100
scn.render.filepath = os.path.join(OUT, "ground.exr")
if GW > 0:
    bpy.ops.render.render(write_still=True)
    gi = bpy.data.images.load(os.path.join(OUT, "ground.exr"))
    save_ldr(gi.pixels[:], gi.size[0], gi.size[1], os.path.join(OUT, "ground.jpg"), EXPOSE)
print("GROUND", GX0, GX1, GY0, GY1, scn.render.resolution_x, scn.render.resolution_y)

# ------------------------------------------------ 2. the props: one mesh, one atlas
for o in bpy.data.objects:
    if o.type in ('MESH', 'FONT', 'CURVE'): o.visible_camera = True
props = []
bpy.ops.object.select_all(action='DESELECT')
for o in list(bpy.data.objects):
    if o.type == 'FONT':
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.convert(target='MESH'); o.select_set(False)
for o in list(bpy.data.objects):
    if o.type != 'MESH' or is_ground(o) or o.name.startswith("Car_"): continue
    if o.hide_render or o.hide_get(): continue
    props.append(o)
# low poly: cars were sculpted for stills
for o in props:
    n = o.name.split('.')[0]
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    cap = 900 if n == "CarBody" else 1200
    if tris > cap:
        d = o.modifiers.new("dec", 'DECIMATE'); d.ratio = max(0.01, cap / tris)
dg = bpy.context.evaluated_depsgraph_get()
bm_all = bmesh.new()
mats = []
for o in props:
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    me.transform(o.matrix_world)
    remap = {}
    for i, m in enumerate(me.materials):
        if m not in mats: mats.append(m)
        remap[i] = mats.index(m)
    for p in me.polygons: p.material_index = remap.get(p.material_index, 0)
    bm_all.from_mesh(me)
    ev.to_mesh_clear()
me = bpy.data.meshes.new("Props"); bm_all.to_mesh(me); bm_all.free()
for m in mats: me.materials.append(m)
po = link(bpy.data.objects.new("Props", me))
print("PROPS tris", sum(len(p.vertices) - 2 for p in me.polygons))
# the originals stay for the light, out of the bake
for o in props: o.hide_render = True
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = po; po.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0)
bpy.ops.object.mode_set(mode='OBJECT')
img = bpy.data.images.new("props", PS, PS, alpha=False, float_buffer=True)
for m in mats:
    nt = m.node_tree
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = img
    for nd in nt.nodes: nd.select = False
    tn.select = True; nt.nodes.active = tn
scn.cycles.samples = SAMPLES
b = scn.render.bake
b.use_pass_direct = b.use_pass_indirect = b.use_pass_color = True
b.use_pass_diffuse = True; b.use_pass_glossy = False; b.use_pass_transmission = False; b.use_pass_emit = True
b.margin = 6
bpy.ops.object.bake(type='COMBINED')
save_ldr(img.pixels[:], PS, PS, os.path.join(OUT, "props.jpg"), EXPOSE * float(os.environ.get("PROPS_EXTRA", "1.6")))
# geometry only: the game puts the baked atlas on it
for m in list(me.materials): pass
me.materials.clear()
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "props.glb"), use_selection=True, export_format='GLB',
                          export_materials='NONE', export_normals=False, export_yup=True, export_apply=True)
print("DONE")
