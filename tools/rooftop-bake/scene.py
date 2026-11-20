# The game's rooftop parking-lot court at night, built to the same layout as js/render.js.
# Game coordinates: x across the court, y along it (net at y=0, the player's baseline at -HL), z up.
# Usage: python court.py SAMPLES player|aerial|ground|all
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix
sys.path.insert(0, __import__("os").path.dirname(__file__))
from rlib import setup_cycles, cam, render
from owl_lib import node, math_, mix

OUT = "/tmp/claude-0/oct/out"

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
random.seed(11)

HL, SW, DW, SL, LW = 11.885, 4.115, 5.485, 6.40, 0.05
NET_C, NET_P, POST_X = 0.914, 1.07, 6.4
LOT_EDGE, LOT_BACK, LOT_X = 17.5, -21.5, 45.0
STALL_IN, STALL_OUT, STALL_W = 8.0, 13.2, 2.6
DROP = 24.0   # the deck's height above the street

def hash_(n):
    s = math.sin(n * 127.1) * 43758.5453
    return s - math.floor(s)
def net_h(x): return NET_C + (NET_P - NET_C) * min(1, abs(x) / POST_X)
def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1,)

def M(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]
def emit(name, color, strength, base=(0, 0, 0, 1)):
    m, N, L, p = M(name)
    p.inputs["Base Color"].default_value = base
    p.inputs["Emission Color"].default_value = color; p.inputs["Emission Strength"].default_value = strength
    return m
def link(o): scn.collection.objects.link(o); return o
def mesh_obj(name, verts, faces, mat=None):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    o = link(bpy.data.objects.new(name, me))
    if mat: me.materials.append(mat)
    return o
def box(name, c0, c1, mat=None, bevel=0.0):
    """Axis-aligned box between corners c0 and c1."""
    (x0, y0, z0), (x1, y1, z1) = c0, c1
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    o = mesh_obj(name, v, f, mat)
    if bevel:
        b = o.modifiers.new("b", 'BEVEL'); b.width = bevel; b.segments = 2; b.limit_method = 'ANGLE'
    return o
def cyl(name, loc, r, h, mat=None, verts=24, axis='Z'):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=h)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = len(p.vertices) == 4
    o = link(bpy.data.objects.new(name, me)); o.location = loc
    if axis == 'Y': o.rotation_euler = (math.radians(90), 0, 0)
    if axis == 'X': o.rotation_euler = (0, math.radians(90), 0)
    if mat: me.materials.append(mat)
    return o
def spot(name, loc, color, energy, size_deg, aim=(0, 0, -1), soft=0.3):
    l = bpy.data.lights.new(name, 'SPOT'); l.energy = energy; l.color = color[:3]
    l.spot_size = math.radians(size_deg); l.spot_blend = 0.8; l.shadow_soft_size = soft
    o = link(bpy.data.objects.new(name, l)); o.location = loc
    o.rotation_euler = Vector(aim).to_track_quat('-Z', 'Y').to_euler()
    return o
def area_light(name, loc, color, energy, sx, sy):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.color = color[:3]
    l.shape = 'RECTANGLE'; l.size = sx; l.size_y = sy
    o = link(bpy.data.objects.new(name, l)); o.location = loc
    return o

# ---------------------------------------------------------------- sky: the game's gradient, stars, moon
w = bpy.data.worlds.new("night"); scn.world = w; w.use_nodes = True
N, L = w.node_tree.nodes, w.node_tree.links
bg = N["Background"]
d = N.new("ShaderNodeTexCoord").outputs["Generated"]
sep = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": d})
ramp = N.new("ShaderNodeValToRGB"); L.new(sep.outputs["Z"], ramp.inputs[0])
cr = ramp.color_ramp; cr.elements[0].position = 0.0; cr.elements[0].color = srgb("#4a1d4f")
cr.elements[1].position = 0.45; cr.elements[1].color = srgb("#02030a")
for pos, h in ((0.03, "#2b1645"), (0.12, "#0a0d26")): e = cr.elements.new(pos); e.color = srgb(h)
vor = node(N, L, "ShaderNodeTexVoronoi", {"Vector": d, "Scale": 420.0})
star = math_(N, L, 'LESS_THAN', vor.outputs["Distance"], 0.045)
star = math_(N, L, 'MULTIPLY', star, math_(N, L, 'GREATER_THAN', vor.outputs["Color"], 0.55))
star = math_(N, L, 'MULTIPLY', star, math_(N, L, 'GREATER_THAN', sep.outputs["Z"], 0.04))
sky = node(N, L, "ShaderNodeMix", {"A": ramp.outputs[0], "B": (2.5, 2.6, 3.0, 1), "Factor": star}, data_type='RGBA').outputs[2]
L.new(sky, bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.6

moon_m = emit("Moon", (0.85, 0.88, 1.0, 1), 6.0)
bpy.ops.mesh.primitive_uv_sphere_add(radius=9, location=(330, 900, 210)); bpy.context.active_object.data.materials.append(moon_m)
moon = bpy.data.lights.new("moonlight", 'SUN'); moon.energy = 0.06; moon.color = (0.6, 0.7, 1.0); moon.angle = math.radians(1)
mo = link(bpy.data.objects.new("moonlight", moon)); mo.rotation_euler = Vector((-330, -900, -210)).to_track_quat('-Z', 'Y').to_euler()

# ---------------------------------------------------------------- the deck: wet asphalt with puddles, cracks and oil stains
m, N, L, p = M("Asphalt")
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
big = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 0.16, "Detail": 8.0, "Roughness": 0.6}).outputs["Fac"]
wet = node(N, L, "ShaderNodeMapRange", {"Value": big, "From Min": 0.52, "From Max": 0.62, "To Min": 0.0, "To Max": 1.0}).outputs[0]
agg = node(N, L, "ShaderNodeTexVoronoi", {"Vector": tc, "Scale": 140.0})
grain = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 6.0, "Detail": 10.0}).outputs["Fac"]
crack = node(N, L, "ShaderNodeTexVoronoi", {"Vector": tc, "Scale": 0.45, "Detail": 0.0}, feature='DISTANCE_TO_EDGE').outputs["Distance"]
crackm = math_(N, L, 'LESS_THAN', math_(N, L, 'ADD', crack, math_(N, L, 'MULTIPLY', grain, 0.012)), 0.010)
crackm = math_(N, L, 'MULTIPLY', crackm, math_(N, L, 'GREATER_THAN', node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 0.7}).outputs["Fac"], 0.52))
base = mix(N, L, srgb("#1b1c24"), srgb("#101117"), grain)
base = mix(N, L, base, (0.008, 0.008, 0.01, 1), math_(N, L, 'MULTIPLY', wet, 0.3))
base = mix(N, L, base, (0.002, 0.002, 0.002, 1), crackm)
L.new(base, p.inputs["Base Color"])
L.new(node(N, L, "ShaderNodeMapRange", {"Value": wet, "To Min": 0.5, "To Max": 0.05}).outputs[0], p.inputs["Roughness"])
bh = math_(N, L, 'MULTIPLY', math_(N, L, 'SUBTRACT', 1.0, wet), math_(N, L, 'SUBTRACT', agg.outputs["Distance"], math_(N, L, 'MULTIPLY', crackm, 2.0)))
L.new(node(N, L, "ShaderNodeBump", {"Height": bh, "Strength": 0.35, "Distance": 0.003}).outputs["Normal"], p.inputs["Normal"])
asphalt = m
box("Deck", (-LOT_X, LOT_BACK, -0.35), (LOT_X, LOT_EDGE + 0.3, 0.0), asphalt)

conc, N, L, p = M("Concrete")
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
cn = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 3.0, "Detail": 12.0}).outputs["Fac"]
streak = node(N, L, "ShaderNodeTexNoise", {"Vector": node(N, L, "ShaderNodeMapping", {"Vector": tc, "Scale": (2.0, 2.0, 0.08)}).outputs[0], "Scale": 4.0}).outputs["Fac"]
L.new(mix(N, L, srgb("#3a3a42"), srgb("#1e1e24"), math_(N, L, 'MULTIPLY', cn, streak)), p.inputs["Base Color"])
p.inputs["Roughness"].default_value = 0.85
L.new(node(N, L, "ShaderNodeBump", {"Height": cn, "Strength": 0.25}).outputs["Normal"], p.inputs["Normal"])

# the parking structure under the deck: floor slabs with dark open bays, seen in the aerial
under, N, L, p = M("Structure")
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
sz = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": tc})
slab = math_(N, L, 'GREATER_THAN', math_(N, L, 'FRACT', math_(N, L, 'DIVIDE', sz.outputs["Z"], 3.2)), 0.72)
L.new(mix(N, L, (0.004, 0.004, 0.006, 1), srgb("#2a2a30"), slab), p.inputs["Base Color"])
L.new(mix(N, L, (0.18, 0.12, 0.05, 1), (0, 0, 0, 1), slab), p.inputs["Emission Color"]); p.inputs["Emission Strength"].default_value = 0.12
box("Structure", (-LOT_X + 0.3, LOT_BACK + 0.3, -DROP), (LOT_X - 0.3, LOT_EDGE, -0.35), under)
street, N, L, p = M("Street"); p.inputs["Base Color"].default_value = (0.01, 0.01, 0.012, 1); p.inputs["Roughness"].default_value = 0.3
box("Street", (-400, -200, -DROP - 0.1), (400, 600, -DROP), street)

# parapets: 1 m concrete walls on all four edges, a cyan strip light along the top inner edge
cyan_strip = emit("StripCyan", srgb("#25d9ff"), 9.0)
for y0, y1, inner in ((LOT_EDGE, LOT_EDGE + 0.3, LOT_EDGE), (LOT_BACK - 0.3, LOT_BACK, LOT_BACK)):
    box("Parapet", (-LOT_X, y0, 0), (LOT_X, y1, 1.0), conc, bevel=0.02)
    box("ParapetStrip", (-LOT_X, inner - 0.03 if inner > 0 else inner, 0.97), (LOT_X, inner if inner > 0 else inner + 0.03, 1.0), cyan_strip)
for sx in (-1, 1):
    box("Parapet", (sx * LOT_X - (0.3 if sx > 0 else 0), LOT_BACK, 0), (sx * LOT_X + (0 if sx > 0 else 0.3), LOT_EDGE, 1.0), conc)

# ---------------------------------------------------------------- court: two-tone acrylic, LED-lit lines
def acrylic(name, hexc):
    m, N, L, p = M(name)
    tc = N.new("ShaderNodeTexCoord").outputs["Object"]
    g = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 900.0, "Detail": 4.0}).outputs["Fac"]
    wear = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 0.5, "Detail": 6.0}).outputs["Fac"]
    c = srgb(hexc)
    L.new(mix(N, L, c, tuple(v * 1.35 for v in c[:3]) + (1,), wear), p.inputs["Base Color"])
    wetc = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 0.22, "Detail": 6.0}).outputs["Fac"]
    L.new(node(N, L, "ShaderNodeMapRange", {"Value": wetc, "From Min": 0.45, "From Max": 0.7, "To Min": 0.4, "To Max": 0.18}).outputs[0], p.inputs["Roughness"])
    L.new(node(N, L, "ShaderNodeBump", {"Height": g, "Strength": 0.18, "Distance": 0.001}).outputs["Normal"], p.inputs["Normal"])
    return m
box("CourtSurround", (-DW - 1.2, -HL - 2.5, 0), (DW + 1.2, HL + 2.5, 0.003), acrylic("CourtOuter", "#17294a"))
box("CourtSingles", (-SW, -HL, 0.003), (SW, HL, 0.004), acrylic("CourtInner", "#1b3a66"))
line_m, N, L, p = M("CourtLine")
p.inputs["Base Color"].default_value = (0.85, 0.95, 1.0, 1); p.inputs["Roughness"].default_value = 0.3
p.inputs["Emission Color"].default_value = srgb("#7af6ff"); p.inputs["Emission Strength"].default_value = 5.0
def line(x0, y0, x1, y1, wdt=LW):
    if x0 == x1: box("Line", (x0 - wdt / 2, y0, 0.004), (x0 + wdt / 2, y1, 0.007), line_m)
    else: box("Line", (x0, y0 - wdt / 2, 0.004), (x1, y0 + wdt / 2, 0.007), line_m)
for yy in (-HL, HL): line(-DW, yy, DW, yy, 0.10)
for xx in (-DW, DW, -SW, SW): line(xx, -HL, xx, HL)
for yy in (-SL, SL): line(-SW, yy, SW, yy)
line(0, -SL, 0, SL)
line(0, -HL, 0, -HL + 0.3); line(0, HL - 0.3, 0, HL)
# the lines light the court a little, as the neon glow does in the game
for yy in (-HL, HL):
    area_light("LineGlow", (0, yy, 0.05), srgb("#25d9ff"), 25, 2 * DW, 0.2).rotation_euler = (math.pi, 0, 0)

# ---------------------------------------------------------------- net: cord mesh, pink neon headband, posts
metal, N, L, p = M("PostMetal"); p.inputs["Base Color"].default_value = srgb("#1c1b2a"); p.inputs["Metallic"].default_value = 0.8; p.inputs["Roughness"].default_value = 0.35
cord, N, L, p = M("NetCord"); p.inputs["Base Color"].default_value = (0.05, 0.045, 0.06, 1); p.inputs["Roughness"].default_value = 0.7
p.inputs["Emission Color"].default_value = srgb("#ff3fb4"); p.inputs["Emission Strength"].default_value = 0.08
nx, cell = int(2 * POST_X / 0.045), 0.045
verts, faces = [], []
rows = int(NET_P / cell) + 1
for j in range(rows + 1):
    for i in range(nx + 1):
        x = -POST_X + i * 2 * POST_X / nx
        z = min(j * cell, net_h(x) - 0.03)
        verts.append((x, 0, z))
for j in range(rows):
    for i in range(nx):
        a = j * (nx + 1) + i
        faces.append((a, a + 1, a + nx + 2, a + nx + 1))
net = mesh_obj("Net", verts, faces, cord)
wf = net.modifiers.new("w", 'WIREFRAME'); wf.thickness = 0.0034; wf.use_even_offset = False
band_m = emit("NetBand", srgb("#ff3fb4"), 7.0, base=(0.9, 0.85, 0.9, 1))
bp = [Vector((-POST_X + i * 2 * POST_X / 64, 0, net_h(-POST_X + i * 2 * POST_X / 64) - 0.025)) for i in range(65)]
bv, bf = [], []
for k, q in enumerate(bp):
    for dy, dz in ((-0.012, -0.03), (0.012, -0.03), (0.012, 0.03), (-0.012, 0.03)): bv.append((q.x, q.y + dy, q.z + dz))
for k in range(64):
    for s in range(4):
        a, b = 4 * k + s, 4 * k + (s + 1) % 4
        bf.append((a, b, b + 4, a + 4))
mesh_obj("NetBand", bv, bf, band_m)
box("CentreStrap", (-0.025, -0.006, 0), (0.025, 0.006, NET_C - 0.02), emit("Strap", (0.9, 0.9, 1, 1), 1.0, base=(0.9, 0.9, 0.9, 1)))
for sx in (-1, 1):
    cyl("NetPost", (sx * (POST_X + 0.04), 0, (NET_P + 0.05) / 2), 0.04, NET_P + 0.05, metal)
    cyl("PostCap", (sx * (POST_X + 0.04), 0, NET_P + 0.06), 0.045, 0.02, metal)
cable = cyl("NetCable", (0, 0, NET_C), 0.004, 2 * POST_X, metal, axis='X')

# a few balls by the post
ball, N, L, p = M("Ball"); p.inputs["Base Color"].default_value = (0.70, 0.92, 0.04, 1); p.inputs["Roughness"].default_value = 0.85
p.inputs["Sheen Weight"].default_value = 1.0; p.inputs["Sheen Tint"].default_value = (0.9, 1.0, 0.4, 1)
p.inputs["Emission Color"].default_value = srgb("#c6ff2e"); p.inputs["Emission Strength"].default_value = 0.3
for bx, by in ((6.9, -0.6), (7.05, -0.45), (6.8, -0.35), (-3.0, -8.7)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.0335, location=(bx, by, 0.0335), segments=24, ring_count=12)
    bpy.context.active_object.data.materials.append(ball); bpy.ops.object.shade_smooth()

# ---------------------------------------------------------------- lot markings, wheel stops, bollards
paint, N, L, p = M("LotPaint"); p.inputs["Base Color"].default_value = (0.62, 0.61, 0.55, 1); p.inputs["Roughness"].default_value = 0.6
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
L.new(node(N, L, "ShaderNodeMapRange", {"Value": node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 14.0, "Detail": 8.0}).outputs["Fac"], "From Min": 0.35, "From Max": 0.5}).outputs[0], p.inputs["Alpha"])
yellow, N, L, p = M("LaneYellow"); p.inputs["Base Color"].default_value = (0.85, 0.55, 0.02, 1); p.inputs["Roughness"].default_value = 0.55
for sx in (-1, 1):
    y = -19.5
    while y <= LOT_EDGE - 0.5:
        x0, x1 = sorted((sx * STALL_IN, sx * STALL_OUT))
        box("Bay", (x0, y - 0.05, 0), (x1, y + 0.05, 0.004), paint)
        y += STALL_W
    y = LOT_BACK + 0.5
    while y < LOT_EDGE - 0.5:
        box("Lane", (sx * 7.2 - 0.06, y, 0), (sx * 7.2 + 0.06, min(y + 1.6, LOT_EDGE), 0.004), yellow)
        y += 3.2
hazard, N, L, p = M("Hazard")
tc = N.new("ShaderNodeTexCoord").outputs["Object"]
ss = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": tc})
band = math_(N, L, 'GREATER_THAN', math_(N, L, 'FRACT', math_(N, L, 'MULTIPLY', math_(N, L, 'ADD', ss.outputs["X"], ss.outputs["Z"]), 3.0)), 0.5)
L.new(mix(N, L, (0.9, 0.6, 0.02, 1), (0.01, 0.01, 0.01, 1), band), p.inputs["Base Color"]); p.inputs["Roughness"].default_value = 0.5

# ---------------------------------------------------------------- cars: same bays and gaps as the game
PALETTE = ['#2a2f45', '#3b1f3f', '#1d3340', '#40342a', '#262626', '#18203a']
CARS = []
for sx in (-1, 1):
    k = 0; y = -19.5
    while y < LOT_EDGE - STALL_W:
        if hash_(k * 7.3 + sx * 3.3) >= 0.38:
            CARS.append(dict(x=sx * (STALL_IN + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y=y + STALL_W / 2, sx=sx, k=k))
        y += STALL_W; k += 1
for y in (-17.6, -20.1):
    for x in (-5, 0, 5):
        k = 40 + round(x + y * 3)
        if hash_(k * 2.9) < 0.2: continue
        CARS.append(dict(x=x + (hash_(k * 1.3) - 0.5) * 0.4, y=y, sx=-1 if x < 0 else 1, k=k))
for sx in (-1, 1):
    k = 100; y = -19.5
    while y < LOT_EDGE - STALL_W:
        x0, x1 = sorted((sx * 16.0, sx * 21.2))
        box("Bay", (x0, y - 0.05, 0), (x1, y + 0.05, 0.004), paint)
        if hash_(k * 2.7 + sx) >= 0.45 and not (sx > 0 and 6.5 < y < 15.5):
            CARS.append(dict(x=sx * (16.0 + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y=y + STALL_W / 2, sx=-sx, k=k, outer=True))
        y += STALL_W; k += 1
print("cars", len(CARS))

def car_body(name, prof, width, cabin_w):
    """Extrude a side profile (x forward, z up), round it with a voxel remesh, pinch the cabin and cut the wheel arches."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, -width / 2, z)) for x, z in prof]
    f = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]: v.co.y += width
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    r = o.modifiers.new("r", 'REMESH'); r.mode = 'VOXEL'; r.voxel_size = 0.025
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier="r")
    s = o.modifiers.new("s", 'SMOOTH'); s.factor = 0.7; s.iterations = 6
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier="s")
    co = [0.0] * (len(me.vertices) * 3); me.vertices.foreach_get("co", co)
    for i in range(0, len(co), 3):
        z = co[i + 2]; t = min(1, max(0, (z - 0.92) / 0.4))
        co[i + 1] *= 1 - (1 - cabin_w) * t * t * (3 - 2 * t)
    me.vertices.foreach_set("co", co); me.update()
    for wx in (-1.35, 1.35):
        cut = cyl("arch", (wx, 0, 0.34), 0.41, 3.0, None, 32, 'Y')
        b = o.modifiers.new("b", 'BOOLEAN'); b.operation = 'DIFFERENCE'; b.object = cut; b.solver = 'EXACT'
        with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.modifier_apply(modifier="b")
        bpy.data.objects.remove(cut)
    for p_ in me.polygons: p_.use_smooth = True
    return o

SHAPES = {
    "sedan": ([(-2.15, 0.30), (2.15, 0.30), (2.24, 0.46), (2.2, 0.70), (2.0, 0.80), (0.95, 0.90), (0.20, 1.36), (-0.85, 1.38), (-1.55, 0.98), (-2.08, 0.93), (-2.22, 0.74), (-2.22, 0.45)], 1.80, 0.80),
    "hatch": ([(-2.0, 0.30), (2.0, 0.30), (2.09, 0.46), (2.06, 0.72), (1.85, 0.84), (0.85, 0.95), (0.15, 1.42), (-1.55, 1.40), (-1.98, 1.05), (-2.06, 0.74), (-2.06, 0.45)], 1.78, 0.82),
    "suv": ([(-2.2, 0.38), (2.2, 0.38), (2.3, 0.56), (2.28, 0.92), (2.05, 1.02), (1.15, 1.10), (0.55, 1.64), (-1.85, 1.66), (-2.2, 1.30), (-2.28, 0.92), (-2.28, 0.55)], 1.90, 0.86),
}
def car_paint(hexc):
    m, N, L, p = M("Paint" + hexc)
    tc = N.new("ShaderNodeTexCoord").outputs["Object"]
    sz = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": tc})
    X, Y, Z = sz.outputs["X"], sz.outputs["Y"], sz.outputs["Z"]
    # glasshouse: the band between the beltline and the roof, minus the pillars
    belt = math_(N, L, 'GREATER_THAN', Z, 0.97)
    under_roof = math_(N, L, 'LESS_THAN', Z, 1.31)
    bpil = math_(N, L, 'GREATER_THAN', math_(N, L, 'ABSOLUTE', math_(N, L, 'ADD', X, 0.30)), 0.06)
    glass = math_(N, L, 'MULTIPLY', math_(N, L, 'MULTIPLY', belt, under_roof), bpil)
    c = srgb(hexc)
    L.new(mix(N, L, tuple(v * 1.6 for v in c[:3]) + (1,), (0.004, 0.006, 0.01, 1), glass), p.inputs["Base Color"])
    p.inputs["Metallic"].default_value = 0.55
    L.new(node(N, L, "ShaderNodeMapRange", {"Value": glass, "To Min": 0.3, "To Max": 0.02}).outputs[0], p.inputs["Roughness"])
    p.inputs["Coat Weight"].default_value = 1.0; p.inputs["Coat Roughness"].default_value = 0.04
    return m
tyre, N, L, p = M("Tyre"); p.inputs["Base Color"].default_value = (0.012, 0.012, 0.012, 1); p.inputs["Roughness"].default_value = 0.8
rim, N, L, p = M("Rim"); p.inputs["Base Color"].default_value = (0.5, 0.5, 0.55, 1); p.inputs["Metallic"].default_value = 1.0; p.inputs["Roughness"].default_value = 0.3
head_m = emit("Headlight", (1.0, 0.95, 0.85, 1), 4.0, base=(0.8, 0.8, 0.8, 1))
tail_m = emit("Taillight", (1.0, 0.02, 0.02, 1), 1.5, base=(0.3, 0.0, 0.0, 1))
bodies = {n: car_body("Car_" + n, *SHAPES[n]) for n in SHAPES}
for o in bodies.values(): o.hide_render = True; o.hide_viewport = True; o.data.materials.append(tyre)
paints = {}
for car in CARS:
    kind = ("sedan", "hatch", "suv")[int(hash_(car["k"] * 4.3 + car["sx"]) * 3)]
    hexc = PALETTE[int(hash_(car["k"] * 3.7 + car["sx"]) * len(PALETTE))]
    if hexc not in paints: paints[hexc] = car_paint(hexc)
    prof, width, _ = SHAPES[kind]
    # nose towards the court: local +x points at x=0
    face = -1 if car["sx"] > 0 else 1
    rot = 0 if face > 0 else math.pi
    rot += (hash_(car["k"] * 6.1) - 0.5) * 0.06
    root = link(bpy.data.objects.new("Car", None)); root.location = (car["x"], car["y"], 0); root.rotation_euler = (0, 0, rot)
    b = link(bpy.data.objects.new("CarBody", bodies[kind].data)); b.parent = root
    b.material_slots[0].link = 'OBJECT'; b.material_slots[0].material = paints[hexc]
    zc = 0.38 if kind == "suv" else 0.34
    for wx in (-1.35, 1.35):
        for wy in (-1, 1):
            t = cyl("Tyre", (wx, wy * (width / 2 - 0.13), zc), zc, 0.22, tyre, 28, 'Y'); t.parent = root
            r_ = cyl("Rim", (wx, wy * (width / 2 - 0.015), zc), zc * 0.62, 0.02, rim, 20, 'Y'); r_.parent = root
    xf = max(x for x, z in prof); xr = min(x for x, z in prof)
    zl = [z for x, z in prof]
    for wy in (-1, 1):
        h = box("Head", (xf - 0.1, wy * (width / 2 - 0.12) - 0.18, 0.62 + (0.12 if kind == "suv" else 0)), (xf + 0.01, wy * (width / 2 - 0.12) + 0.18, 0.70 + (0.12 if kind == "suv" else 0)), head_m); h.parent = root
    tl = box("Tail", (xr - 0.02, -width / 2 + 0.15, 0.78 + (0.1 if kind == "suv" else 0)), (xr + 0.08, width / 2 - 0.15, 0.84 + (0.1 if kind == "suv" else 0)), tail_m); tl.parent = root
    # underglow, pink or cyan as in the game
    ug = srgb("#ff3fb4") if hash_(car["k"] * 5.1) > 0.5 else srgb("#25d9ff")
    al = area_light("Underglow", (0, 0, 0.18), ug, 120, 3.6, 1.4); al.parent = root; al.rotation_euler = (math.pi, 0, 0)
    # a concrete wheel stop in front of the nose (side rows only)
    if car.get("outer"):
        ws = box("WheelStop", (-0.12, -0.9, 0), (0.12, 0.9, 0.14), conc, bevel=0.03)
        ws.location = (-car["sx"] * 20.45, car["y"], 0)
    elif abs(car["x"]) > 7:
        ws = box("WheelStop", (-0.12, -0.9, 0), (0.12, 0.9, 0.14), conc, bevel=0.03)
        ws.location = (car["sx"] * (STALL_IN + 0.75), car["y"], 0)

# ---------------------------------------------------------------- lamps: positions and colours from the game
LAMPS = [(-7.7, 16.5, '#ffb04a'), (7.7, 16.5, '#ffb04a'), (-7.7, 3, '#ff4fc0'), (7.7, -3, '#3fdcff'), (-7.7, -12, '#ffb04a'), (7.7, -15, '#ffb04a')]
for x, y, hexc in LAMPS:
    col = srgb(hexc)
    cyl("LampBase", (x, y, 0.25), 0.28, 0.5, conc, 20)
    cyl("LampPole", (x, y, 3.9), 0.085, 7.4, metal, 16)
    hx = x * 0.75
    arm = cyl("LampArm", ((x + hx) / 2, y, 7.5), 0.05, abs(x - hx) + 0.1, metal, 12, 'X')
    box("LampHead", (hx - 0.45, y - 0.22, 7.38), (hx + 0.45, y + 0.22, 7.56), metal, bevel=0.03)
    box("LampLens", (hx - 0.38, y - 0.16, 7.365), (hx + 0.38, y + 0.16, 7.38), emit("Lens" + hexc, col, 40.0, base=(1, 1, 1, 1)))
    spot("Lamp", (hx, y, 7.33), col, 9000, 125, soft=0.25)

# ---------------------------------------------------------------- props: stair tower, HVAC units, bollards, bench
box("StairTower", (17.0, 8.0, 0), (23.0, 14.5, 4.2), conc, bevel=0.05)
box("StairRoof", (16.8, 7.8, 4.2), (23.2, 14.7, 4.4), metal)
door_m, N, L, p = M("Door"); p.inputs["Base Color"].default_value = (0.04, 0.04, 0.05, 1); p.inputs["Metallic"].default_value = 0.7; p.inputs["Roughness"].default_value = 0.4
box("Door", (18.5, 7.97, 0), (19.7, 8.0, 2.2), door_m)
box("Exit", (18.7, 7.95, 2.35), (19.5, 7.98, 2.6), emit("ExitGreen", (0.05, 1.0, 0.25, 1), 12.0))
spot("DoorLight", (19.1, 7.7, 2.8), (0.7, 1.0, 0.8, 1), 150, 100)
neon_m = emit("NeonP4", srgb("#25d9ff"), 20.0)
cu = bpy.data.curves.new("P4", 'FONT'); cu.body = "P4"; cu.size = 1.6; cu.align_x = 'CENTER'; cu.extrude = 0.02
t = link(bpy.data.objects.new("P4", cu)); t.location = (20.0, 7.94, 2.5); t.rotation_euler = (math.radians(90), 0, 0); cu.materials.append(neon_m)
hvac, N, L, p = M("HVAC"); p.inputs["Base Color"].default_value = (0.25, 0.26, 0.28, 1); p.inputs["Metallic"].default_value = 0.6; p.inputs["Roughness"].default_value = 0.5
for hx, hy in ((-20.0, 12.5), (-23.5, 12.5), (24.0, -16.0)):
    box("HVAC", (hx - 1.4, hy - 1.0, 0.15), (hx + 1.4, hy + 1.0, 1.6), hvac, bevel=0.04)
    cyl("Fan", (hx, hy, 1.62), 0.7, 0.05, metal, 24)
for bx_, by_ in ((-7.0, -14.6), (7.0, -14.6), (-7.0, 14.6), (7.0, 14.6), (-7.0, 0.0), (7.0, 0.0)):
    cyl("Bollard", (bx_, by_, 0.5), 0.1, 1.0, hazard, 16)
    cyl("BollardTop", (bx_, by_, 1.0), 0.1, 0.01, emit("BollardLED", srgb("#ff3fb4"), 6.0), 16)
box("Bench", (-8.2 + 0.0, -1.2, 0.42), (-7.75, 1.2, 0.47), hvac, bevel=0.01)
for by_ in (-1.0, 1.0): box("BenchLeg", (-8.15, by_ - 0.04, 0), (-7.8, by_ + 0.04, 0.42), metal)

# ---------------------------------------------------------------- billboard over the skyline (BOARD in render.js)
BX, BY, BZ, BWID, BHT, TURN = -6, 40, 5.5, 17, 5.2, 0.4
board = link(bpy.data.objects.new("Billboard", None)); board.location = (BX, BY, 0); board.rotation_euler = (0, 0, TURN)
def child(o): o.parent = board; return o
child(cyl("Pylon", (0, 0.6, (BZ - DROP) / 2), 0.5, BZ + DROP, metal, 20))
panel_m, N, L, p = M("BoardPanel"); p.inputs["Base Color"].default_value = srgb("#080616"); p.inputs["Roughness"].default_value = 0.5
child(box("BoardPanel", (-BWID / 2, 0.2, BZ), (BWID / 2, 0.5, BZ + BHT), panel_m))
pink = emit("BoardFrame", srgb("#ff3fb4"), 18.0)
for x0, z0, x1, z1 in ((-BWID / 2 + 0.2, BZ + 0.2, BWID / 2 - 0.2, BZ + 0.32), (-BWID / 2 + 0.2, BZ + BHT - 0.32, BWID / 2 - 0.2, BZ + BHT - 0.2),
                       (-BWID / 2 + 0.2, BZ + 0.2, -BWID / 2 + 0.32, BZ + BHT - 0.2), (BWID / 2 - 0.32, BZ + 0.2, BWID / 2 - 0.2, BZ + BHT - 0.2)):
    child(box("Frame", (x0, 0.12, z0), (x1, 0.2, z1), pink))
cu = bpy.data.curves.new("Tag", 'FONT'); cu.body = "HHORNS"; cu.size = 3.2; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.05
tag = child(link(bpy.data.objects.new("Tag", cu))); tag.location = (0, 0.1, BZ + BHT / 2); tag.rotation_euler = (math.radians(90), 0, 0)
cu.materials.append(emit("BoardTag", srgb("#25d9ff"), 22.0))
gl = child(area_light("BoardGlow", (0, -1.5, BZ + BHT / 2), srgb("#ff3fb4"), 3000, BWID, BHT)); gl.rotation_euler = (math.radians(-90), 0, 0)

# ---------------------------------------------------------------- skyline: dark towers with sparse lit windows, fading into purple haze
win, N, L, p = M("Towers")
geo = N.new("ShaderNodeNewGeometry")
sx_ = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": geo.outputs["Position"]})
u = math_(N, L, 'ADD', sx_.outputs["X"], sx_.outputs["Y"])
cx = node(N, L, "ShaderNodeCombineXYZ", {"X": u, "Y": sx_.outputs["Z"]})
br = node(N, L, "ShaderNodeTexBrick", {"Vector": cx.outputs[0], "Scale": 1.0, "Brick Width": 1.9, "Row Height": 3.4, "Mortar Size": 0.45, "Mortar Smooth": 0.1,
          "Color1": (0, 0, 0, 1), "Color2": (1, 1, 1, 1), "Mortar": (0, 0, 0, 1), "Bias": 0.0}, offset=0.0, squash=1.0)
r_ = node(N, L, "ShaderNodeSeparateColor", {"Color": br.outputs["Color"]}).outputs[0]
on = math_(N, L, 'MULTIPLY', math_(N, L, 'GREATER_THAN', r_, 0.82), math_(N, L, 'SUBTRACT', 1.0, br.outputs["Fac"]))
wcol = mix(N, L, srgb("#ffc878"), srgb("#25d9ff"), math_(N, L, 'GREATER_THAN', r_, 0.93))
wcol = mix(N, L, wcol, srgb("#ff3fb4"), math_(N, L, 'GREATER_THAN', r_, 0.975))
cam_d = N.new("ShaderNodeCameraData").outputs["View Distance"]
haze = math_(N, L, 'MULTIPLY', node(N, L, "ShaderNodeMapRange", {"Value": cam_d, "From Min": 150.0, "From Max": 750.0, "To Min": 0.0, "To Max": 0.8}).outputs[0],
             node(N, L, "ShaderNodeMapRange", {"Value": sx_.outputs["Z"], "From Min": 30.0, "From Max": -DROP, "To Min": 0.4, "To Max": 1.0}).outputs[0])
L.new(mix(N, L, (0.006, 0.005, 0.012, 1), (0.03, 0.008, 0.035, 1), haze), p.inputs["Base Color"])
L.new(mix(N, L, mix(N, L, (0, 0, 0, 1), wcol, on), srgb("#4a1d4f"), haze), p.inputs["Emission Color"])
p.inputs["Emission Strength"].default_value = 1.7; p.inputs["Roughness"].default_value = 0.35
beacon = emit("Beacon", (1.0, 0.05, 0.05, 1), 30.0)
rng = random.Random(4)
for i in range(170):
    ang = rng.uniform(-1.25, 1.25) if i < 110 else rng.uniform(1.25, 2.6) * rng.choice((-1, 1))
    dist = rng.uniform(220, 700)
    x, y = dist * math.sin(ang), dist * math.cos(ang)
    if abs(x) < LOT_X + 8 and LOT_BACK - 8 < y < LOT_EDGE + 25: continue
    h = rng.uniform(12, 60) * (1.8 if dist > 420 else 1.0) * (1.6 if rng.random() > 0.85 else 1.0)
    wx, wy = rng.uniform(18, 40), rng.uniform(18, 40)
    o = box("Tower", (-wx / 2, -wy / 2, -DROP), (wx / 2, wy / 2, h - DROP), win)
    o.location = (x, y, 0); o.rotation_euler = (0, 0, rng.uniform(-0.2, 0.2))
    if rng.random() > 0.65:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, location=(x, y, h - DROP + 1.2), segments=12, ring_count=6)
        bpy.context.active_object.data.materials.append(beacon)

# ---------------------------------------------------------------- oil stains (as in the game: 14 dark ellipses)
stain, N, L, p = M("Stain")
tc = N.new("ShaderNodeTexCoord").outputs["Generated"]
ss = node(N, L, "ShaderNodeSeparateXYZ", {"Vector": tc})
rr = math_(N, L, 'SQRT', math_(N, L, 'ADD', math_(N, L, 'POWER', math_(N, L, 'SUBTRACT', ss.outputs["X"], 0.5), 2.0), math_(N, L, 'POWER', math_(N, L, 'SUBTRACT', ss.outputs["Y"], 0.5), 2.0)))
nz = node(N, L, "ShaderNodeTexNoise", {"Vector": tc, "Scale": 4.0, "Detail": 6.0}).outputs["Fac"]
a = node(N, L, "ShaderNodeMapRange", {"Value": math_(N, L, 'ADD', rr, math_(N, L, 'MULTIPLY', nz, 0.25)), "From Min": 0.55, "From Max": 0.35, "To Min": 0.0, "To Max": 0.75}).outputs[0]
L.new(a, p.inputs["Alpha"]); p.inputs["Base Color"].default_value = (0.002, 0.002, 0.003, 1); p.inputs["Roughness"].default_value = 0.08
p.inputs["Thin Film Thickness"].default_value = 450.0
for i in range(14):
    x = (hash_(i * 13.3) - 0.5) * 22; y = -16 + hash_(i * 17.9) * 32
    if abs(x) < DW + 1.3 and abs(y) < HL + 2.6: x = math.copysign(abs(x) + DW + 2.5, x)
    bpy.ops.mesh.primitive_plane_add(size=1.4, location=(x, y, 0.0015))
    o = bpy.context.active_object; o.scale = (1.3, 0.9, 1); o.rotation_euler = (0, 0, hash_(i * 3.1) * 3); o.data.materials.append(stain)

