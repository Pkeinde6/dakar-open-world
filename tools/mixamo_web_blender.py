# Passant realiste pour le site : le personnage Mixamo (godot/models/mixamo) allege pour le web.
# Marche, attendre et courir dans un seul GLB (actions Walk, Idle, Run), maillage reduit a ~15 %, textures en 512 px.
# usage: blender --background --python tools/mixamo_web_blender.py -- <dossier mixamo> <sortie.glb>
import bpy, sys, os
src, out = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
def imp(f):
    before = set(bpy.data.actions); bpy.ops.import_scene.fbx(filepath=os.path.join(src, f), automatic_bone_orientation=False)
    return [a for a in bpy.data.actions if a not in before]
walk = imp('leonard.fbx'); arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
keep = set(bpy.data.objects)
for name, f in (('Idle', 'idle.fbx'), ('Run', 'running.fbx')):
    acts = imp(f)
    for a in acts: a.name = name; a.use_fake_user = True
    for o in list(bpy.data.objects): # on ne garde que l'animation, pas le second squelette
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
for a in walk: a.name = 'Walk'; a.use_fake_user = True
for o in bpy.data.objects:
    if o.type == 'MESH':
        m = o.modifiers.new('allege', 'DECIMATE'); m.ratio = 0.15
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='allege')
for img in bpy.data.images:
    if img.size[0] > 512: img.scale(512, 512 * img.size[1] // max(1, img.size[0]))
arm.animation_data_create(); arm.animation_data.action = bpy.data.actions['Walk']
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS', export_image_format='JPEG', export_jpeg_quality=80)
print('->', out, [a.name for a in bpy.data.actions])
