# Thins props.glb after the bake: collapse decimation keeps the UVs, so the
# baked atlas still fits. Usage: python decimate.py IN.glb OUT.glb RATIO
import sys, bpy
src, dst, ratio = sys.argv[-3], sys.argv[-2], float(sys.argv[-1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
before = after = 0
for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    before += sum(len(p.vertices) - 2 for p in o.data.polygons)
    m = o.modifiers.new("thin", 'DECIMATE'); m.decimate_type = 'COLLAPSE'; m.ratio = ratio
    m.use_collapse_triangulate = True
    m.delimit = {'UV', 'SEAM'}
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)
    after += sum(len(p.vertices) - 2 for p in o.data.polygons)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_materials='NONE', export_normals=False, export_yup=True)
print("TRIS", before, "->", after)
