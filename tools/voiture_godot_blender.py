# Prepare une voiture Sketchfab pour Godot : roues separees (4 objets, pivot au centre), caisse a part, taille reelle.
# usage: blender --background --python tools/voiture_godot_blender.py -- <entree.glb> <sortie.glb> <longueur_m> <objet_roues>
# Sortie : nodes "Caisse", "Roue_AVG", "Roue_AVD", "Roue_ARG", "Roue_ARD"; avant vers -Y Blender (= +Z glTF), sol a z=0.
import bpy, sys
from mathutils import Vector
src, dst, length, wheel_name = sys.argv[sys.argv.index('--') + 1:]; length = float(length)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in meshes:  # bake every transform so the parts live in world space
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
for o in bpy.data.objects:
    if o.type != 'MESH': o.select_set(False)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM'); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
wheels = [o for o in meshes if o.name.lower().startswith(wheel_name.lower())]; body = [o for o in meshes if o not in wheels]
# total size -> scale to the real length, long axis along Y
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector([min(p[i] for p in pts) for i in range(3)]); mx = Vector([max(p[i] for p in pts) for i in range(3)]); size = mx - mn
long_x = size.x > size.y; k = length / (size.x if long_x else size.y); centre = (mn + mx) / 2
for o in meshes:
    o.location -= Vector((centre.x, centre.y, mn.z)); bpy.context.view_layer.objects.active = o
for o in meshes: o.select_set(True)
bpy.ops.object.transform_apply(location=True)
for o in meshes: o.scale = (k, k, k)
if long_x:
    for o in meshes: o.rotation_euler = (0, 0, 1.5708)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
# split the wheel object into loose parts and gather them in 4 corners
bpy.ops.object.select_all(action='DESELECT')
for w in wheels: w.select_set(True)
bpy.context.view_layer.objects.active = wheels[0]; bpy.ops.object.join(); W = bpy.context.object
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
parts = [o for o in bpy.context.selected_objects]
groups = {}
for o in parts:
    c = sum((o.matrix_world @ Vector(v) for v in o.bound_box), Vector()) / 8
    groups.setdefault(('AV' if c.y < 0 else 'AR') + ('G' if c.x > 0 else 'D'), []).append(o)
for name, objs in groups.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); o = bpy.context.object
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS'); o.name = 'Roue_' + name
bpy.ops.object.select_all(action='DESELECT')
for o in body: o.select_set(True)
bpy.context.view_layer.objects.active = body[0]; bpy.ops.object.join(); bpy.context.object.name = 'Caisse'
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
print('roues', sorted(groups), {k: len(v) for k, v in groups.items()})
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_yup=True)
