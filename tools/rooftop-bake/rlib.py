import bpy, math, mathutils
def setup_cycles(samples=64, res=(900,1200)):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = samples
    s.cycles.use_denoising = True
    try: s.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception as e: print("denoiser", e)
    s.render.resolution_x, s.render.resolution_y = res
    s.render.film_transparent = False
    s.view_settings.view_transform = 'AgX'
    s.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [i.identifier for i in s.view_settings.bl_rna.properties['look'].enum_items] else 'None'
    s.cycles.max_bounces = 8
    s.render.image_settings.file_format = 'PNG'
def cam(name, loc, target, lens=50):
    c = bpy.data.cameras.new(name); c.lens = lens
    o = bpy.data.objects.new(name, c); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    return o
def area(name, loc, target, energy, size=1.0, color=(1,1,1)):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size; l.color = color
    o = bpy.data.objects.new(name, l); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    d = mathutils.Vector(target) - mathutils.Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z','Y').to_euler()
    return o
def render(camobj, path):
    s = bpy.context.scene; s.camera = camobj; s.render.filepath = path
    bpy.ops.render.render(write_still=True)
