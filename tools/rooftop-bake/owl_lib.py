import bpy, bmesh, math
from mathutils import Vector
scn = bpy.context.scene
def link(o): bpy.context.scene.collection.objects.link(o); return o
def smooth01(x, a, b):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

def catmull(pts, n):
    out = []
    P = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    segs = len(pts) - 1
    for i in range(n):
        u = i / (n - 1) * segs
        k = min(int(u), segs - 1); t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return out

def blob(name, loc, scale, rot=(0, 0, 0), seg=40):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me)); o.location = loc; o.scale = scale; o.rotation_euler = rot
    return o

def tube(name, pts, rad, ring=16, cap=True):
    """Sweep a circle along pts; rad(t) gives the radius."""
    T = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
    up = Vector((0.3, 0.2, 1)).normalized()
    n = (up - T[0] * up.dot(T[0])).normalized(); Ns = [n]
    for i in range(1, len(pts)):
        n = Ns[-1] - T[i] * Ns[-1].dot(T[i]); Ns.append(n.normalized())
    bm = bmesh.new(); rows = []
    for i, p in enumerate(pts):
        r = rad(i / (len(pts) - 1)); b = T[i].cross(Ns[i])
        rows.append([bm.verts.new(p + (Ns[i] * math.cos(2 * math.pi * k / ring) + b * math.sin(2 * math.pi * k / ring)) * r) for k in range(ring)])
    for i in range(len(rows) - 1):
        for k in range(ring):
            bm.faces.new((rows[i][k], rows[i][(k + 1) % ring], rows[i + 1][(k + 1) % ring], rows[i + 1][k]))
    if cap:
        a = bm.verts.new(pts[-1] + T[-1] * rad(1.0) * 0.5); c = bm.verts.new(pts[0] - T[0] * rad(0.0) * 0.5)
        for k in range(ring):
            bm.faces.new((rows[-1][k], rows[-1][(k + 1) % ring], a)); bm.faces.new((rows[0][(k + 1) % ring], rows[0][k], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p_ in me.polygons: p_.use_smooth = True
    return link(bpy.data.objects.new(name, me))


def M(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]
def node(N, L, kind, inputs=None, **props):
    n = N.new(kind)
    for k, v in props.items(): setattr(n, k, v)
    for k, v in (inputs or {}).items():
        if hasattr(v, "is_output"): L.new(v, n.inputs[k])
        else: n.inputs[k].default_value = v
    return n
def math_(N, L, op, a, b=0.0): return node(N, L, "ShaderNodeMath", {0: a, 1: b}, operation=op).outputs[0]
def mix(N, L, a, b, f): return node(N, L, "ShaderNodeMix", {"A": a, "B": b, "Factor": f}, data_type='RGBA').outputs[2]

