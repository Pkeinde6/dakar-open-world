# Gens de Dakar, chats et oiseaux, modelises et animes dans Blender, exportes en GLB pour le jeu.
# usage: blender --background --python tools/gens_blender.py -- <dossier models/>
# Each figure is low poly, rigidly skinned to a small armature, front toward -Y in Blender (= +Z in glTF).
# Actions: people "Walk" and "Idle"; cat "Walk" and "Idle"; bird "Fly" and "Peck".
# Materials recoloured in the game: Peau (skin), Tissu (main cloth, gets a wax print), Tissu2 (second cloth),
# Bassine (enamel basin), Pelage (cat fur), Plumage / Col (bird); the rest keep their colours.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
FPS = 24

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for c in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials): [c.remove(x) for x in list(c)]
    bpy.context.scene.render.fps = FPS

MATS = {}
def srgb(h):  # hex sRGB -> linear
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)
def mat(name, hexcol, rough=0.85, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*srgb(hexcol), 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    MATS[name] = m; return m

class Fig:
    """boxes, tubes and balls grouped by (material, bone); every vertex is weighted 1 to its bone"""
    def __init__(self, name): self.name = name; self.parts = {}
    def bm(self, m, bone):
        k = (m.name, bone)
        if k not in self.parts: b = bmesh.new(); b.loops.layers.uv.verify(); self.parts[k] = (m, bone, b)
        return self.parts[k][2]
    def tube(self, m, bone, p0, p1, r0, r1, sx=1.0, sy=1.0, n=10, caps=True):
        p0, p1 = Vector(p0), Vector(p1); d = p1 - p0; L = d.length
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        M = Matrix.Translation((p0 + p1) / 2) @ rot @ Matrix.Diagonal((sx, sy, 1, 1))
        bmesh.ops.create_cone(self.bm(m, bone), cap_ends=caps, segments=n, radius1=r0, radius2=r1, depth=L, matrix=M, calc_uvs=True)
    def ball(self, m, bone, c, r, sx=1.0, sy=1.0, sz=1.0, seg=10):
        M = Matrix.Translation(c) @ Matrix.Diagonal((sx, sy, sz, 1))
        bmesh.ops.create_uvsphere(self.bm(m, bone), u_segments=seg, v_segments=max(6, seg * 2 // 3), radius=r, matrix=M, calc_uvs=True)
    def box(self, m, bone, c, s):
        M = Matrix.Translation(c) @ Matrix.Diagonal((*s, 1))
        bmesh.ops.create_cube(self.bm(m, bone), size=1, matrix=M, calc_uvs=True)
    def build(self, arm):
        objs = []
        for (mn, bone), (m, bn, b) in self.parts.items():
            bmesh.ops.recalc_face_normals(b, faces=b.faces)
            me = bpy.data.meshes.new(f'{mn}_{bn}'); b.to_mesh(me); b.free()
            o = bpy.data.objects.new(me.name, me); o.data.materials.append(m); bpy.context.collection.objects.link(o)
            vg = o.vertex_groups.new(name=bn); vg.add(range(len(me.vertices)), 1.0, 'REPLACE'); objs.append(o)
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); body = objs[0]; body.name = self.name + '_corps'
        for p in body.data.polygons: p.use_smooth = False
        body.parent = arm; md = body.modifiers.new('Armature', 'ARMATURE'); md.object = arm
        return body

def armature(name, bones):
    """bones: [(name, head, tail, parent)]"""
    a = bpy.data.armatures.new(name); o = bpy.data.objects.new(name, a); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; bpy.ops.object.mode_set(mode='EDIT')
    for n, h, t, p in bones:
        e = a.edit_bones.new(n); e.head = h; e.tail = t; e.roll = 0
        if p: e.parent = a.edit_bones[p]; e.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in o.pose.bones: pb.rotation_mode = 'XYZ'
    return o

def tip(arm, b): bpy.context.view_layer.update(); return arm.matrix_world @ arm.pose.bones[b].tail
def clear(arm):
    for pb in arm.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
def axis_sign(arm, b, want, axis=0):
    """sign of a rotation about local `axis` that moves the bone tip along world vector `want`"""
    pb = arm.pose.bones[b]; t0 = tip(arm, b).copy(); r = [0, 0, 0]; r[axis] = 0.2; pb.rotation_euler = r
    t1 = tip(arm, b); pb.rotation_euler = (0, 0, 0); return 1 if (t1 - t0).dot(Vector(want)) > 0 else -1
def best_axis(arm, b, want):
    """local axis (0 x, 2 z) and sign whose rotation moves the tip most along `want`"""
    best = None
    for ax in (0, 2):
        pb = arm.pose.bones[b]; t0 = tip(arm, b).copy(); r = [0, 0, 0]; r[ax] = 0.2; pb.rotation_euler = r
        dv = (tip(arm, b) - t0).dot(Vector(want)); pb.rotation_euler = (0, 0, 0)
        if best is None or abs(dv) > abs(best[1]): best = (ax, dv)
    return best[0], 1 if best[1] > 0 else -1

def action(arm, name, frames, pose):
    """pose(frame) -> {bone: (axis, angle) or [(axis, angle), ...] or ('scale', s)}; keys every frame in `frames`"""
    arm.animation_data_create(); arm.animation_data.action = None
    for f in frames:
        clear(arm)
        for b, v in pose(f).items():
            pb = arm.pose.bones[b]
            if v[0] == 'scale': pb.scale = (v[1],) * 3; continue
            r = list(pb.rotation_euler)
            for ax, ang in (v if isinstance(v, list) else [v]): r[ax] += ang
            pb.rotation_euler = r
        for pb in arm.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=f); pb.keyframe_insert('scale', frame=f)
    act = arm.animation_data.action; act.name = name; act.use_fake_user = True
    return act

def export(path):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
                              export_skins=True, export_apply=False, export_yup=True)
    print('->', path)

# ------------------------------------------------------------------ people
HUMAN = [('hips', (0, 0, 0.95), (0, 0, 1.10), None), ('spine', (0, 0, 1.10), (0, 0, 1.42), 'hips'), ('head', (0, 0, 1.45), (0, 0, 1.78), 'spine'),
         ('arm_L', (0.19, 0, 1.40), (0.21, 0, 1.13), 'spine'), ('fore_L', (0.21, 0, 1.13), (0.22, -0.01, 0.88), 'arm_L'),
         ('arm_R', (-0.19, 0, 1.40), (-0.21, 0, 1.13), 'spine'), ('fore_R', (-0.21, 0, 1.13), (-0.22, -0.01, 0.88), 'arm_R'),
         ('thigh_L', (0.09, 0, 0.93), (0.09, 0, 0.51), 'hips'), ('shin_L', (0.09, 0, 0.51), (0.09, 0.01, 0.08), 'thigh_L'),
         ('thigh_R', (-0.09, 0, 0.93), (-0.09, 0, 0.51), 'hips'), ('shin_R', (-0.09, 0, 0.51), (-0.09, 0.01, 0.08), 'thigh_R')]

def base_body(F, skin, legs=None, shoes=None, arms=None, female=False, child=False):
    """head, neck, hands; legs and arms in `legs`/`arms` cloth or bare skin; shoes or sandals"""
    hair = mat('Cheveux', 0x141110, 0.9)
    F.ball(skin, 'head', (0, -0.005, 1.60), 0.105, 0.88, 0.98, 1.12)            # tete
    F.ball(skin, 'head', (0, -0.095, 1.585), 0.025, 1, 1, 1.1, seg=6)          # nez
    for s in (1, -1): F.ball(skin, 'head', (s * 0.093, 0.0, 1.6), 0.02, 0.5, 1, 1.2, seg=6)  # oreilles
    F.tube(skin, 'spine', (0, 0, 1.40), (0, 0, 1.50), 0.05, 0.045)            # cou
    if not female: F.ball(hair, 'head', (0, 0.01, 1.64), 0.104, 0.9, 0.98, 0.9)  # cheveux ras
    for s, a, f in ((1, 'arm_L', 'fore_L'), (-1, 'arm_R', 'fore_R')):
        x = s * 0.2
        F.tube(arms or skin, a, (x, 0, 1.41), (s * 0.21, 0, 1.13), 0.052, 0.042)
        F.tube(skin if arms is None or arms.name != 'Tissu' else arms, f, (s * 0.21, 0, 1.13), (s * 0.22, -0.01, 0.9), 0.04, 0.033)
        F.ball(skin, f, (s * 0.222, -0.015, 0.85), 0.042, 0.7, 1, 1.3, seg=8)   # main
    for s, t, sh in ((1, 'thigh_L', 'shin_L'), (-1, 'thigh_R', 'shin_R')):
        x = s * 0.09
        F.tube(legs or skin, t, (x, 0, 0.95), (x, 0, 0.51), 0.075, 0.055)
        F.tube(legs or skin, sh, (x, 0, 0.51), (x, 0.01, 0.09), 0.052, 0.04)
        F.box(shoes or skin, sh, (x, -0.04, 0.035), (0.09, 0.25, 0.07 if shoes else 0.05))  # chaussure ou pied nu dans la sandale
        if shoes is None: F.box(mat('Sandale', 0x5a3a22, 0.8), sh, (x, -0.04, 0.006), (0.1, 0.26, 0.012))

def torso(F, m, top=1.43, bottom=0.86, r0=0.15, r1=0.185, depth=0.62, female=False):
    F.tube(m, 'hips', (0, 0, bottom), (0, 0, 1.08), r0 + 0.01, r0, 1, depth)
    F.tube(m, 'spine', (0, 0, 1.08), (0, 0, top), r0, r1, 1, depth)
    if female:
        for s in (1, -1): F.ball(m, 'spine', (s * 0.065, -0.07, 1.27), 0.05, 1, 0.7, 0.85, seg=8)

def human(name, build, female=False):
    reset(); arm = armature(name, HUMAN); F = Fig(name)
    flags = build(F) or {}
    F.build(arm)
    fwd = {b: axis_sign(arm, b, (0, -1, 0)) for b in ('thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'arm_L', 'arm_R', 'fore_L', 'fore_R')}
    k = flags.get('stride', 1.0)
    def walk(f):
        ph = 2 * math.pi * f / FPS; s = math.sin(ph); c = math.cos(ph); P = {}
        for side, sg in (('L', 1), ('R', -1)):
            a = 0.42 * k * s * sg                                   # cuisse : avant / arriere
            P['thigh_' + side] = (0, fwd['thigh_' + side] * a)
            swing = max(0.0, c * sg)                                # jambe qui revient vers l'avant : genou plie
            P['shin_' + side] = (0, -fwd['shin_' + side] * (0.08 + 0.75 * k * swing))
            P['arm_' + side] = (0, -fwd['arm_' + side] * 0.32 * k * s * sg)
            P['fore_' + side] = (0, fwd['fore_' + side] * (0.22 + 0.12 * max(0.0, -s * sg)))
        P['hips'] = (1, 0.07 * s); P['spine'] = (1, -0.09 * s)
        for side, ang in flags.get('arm_up', {}).items():          # bras leve qui tient la bassine
            P['arm_' + side] = (0, fwd['arm_' + side] * ang); P['fore_' + side] = (0, fwd['fore_' + side] * 0.35)
        for side in flags.get('arm_still', ()):                     # main dans la poche / sur la sangle
            P['arm_' + side] = (0, fwd['arm_' + side] * 0.1); P['fore_' + side] = (0, fwd['fore_' + side] * 0.9)
        return P
    def idle(f):
        ph = 2 * math.pi * f / (FPS * 2); P = {'spine': (0, 0.02 * math.sin(ph)), 'head': (2, 0.18 * math.sin(ph * 0.5))}
        for side in ('L', 'R'): P['arm_' + side] = (0, fwd['arm_' + side] * 0.04 * math.sin(ph)); P['fore_' + side] = (0, fwd['fore_' + side] * 0.15)
        for side, ang in flags.get('arm_up', {}).items(): P['arm_' + side] = (0, fwd['arm_' + side] * ang); P['fore_' + side] = (0, fwd['fore_' + side] * 0.35)
        return P
    action(arm, 'Walk', range(0, FPS + 1, 2), walk)
    action(arm, 'Idle', range(0, FPS * 2 + 1, 4), idle)
    arm.animation_data.action = bpy.data.actions['Walk']; clear(arm)
    if flags.get('scale'): arm.scale = (flags['scale'],) * 3
    export(os.path.join(OUT, f'gens_{name}.glb'))

skin = lambda: mat('Peau', 0x5a3825, 0.6)
TISSU, TISSU2 = lambda: mat('Tissu', 0x2a7fd4, 0.75), lambda: mat('Tissu2', 0xf2f0ea, 0.8)

def grand_boubou(F):
    """homme en grand boubou de bazin, pantalon assorti, bonnet (kufi), babouches"""
    t, t2, sk = TISSU(), TISSU2(), skin()
    base_body(F, sk, legs=t, shoes=mat('Babouche', 0xe8dcc0, 0.7), arms=t)
    torso(F, t)
    F.tube(t, 'hips', (0, 0, 0.12), (0, 0, 1.0), 0.5, 0.26, 1, 0.58, caps=True)     # le boubou tombe large jusqu'aux chevilles
    F.tube(t, 'spine', (0, 0, 1.0), (0, 0, 1.44), 0.26, 0.21, 1, 0.55)
    F.box(mat('Brode', 0xd8c58a, 0.6), 'spine', (0, -0.115, 1.27), (0.16, 0.012, 0.26))  # broderie du plastron
    for s, a in ((1, 'arm_L'), (-1, 'arm_R')): F.tube(t, a, (s * 0.21, 0, 1.42), (s * 0.27, 0, 1.0), 0.09, 0.2, 0.6, 1)  # grandes manches
    F.tube(t2, 'head', (0, 0.005, 1.66), (0, 0.005, 1.76), 0.1, 0.095, 0.92, 1)       # bonnet
    return {'stride': 0.5}  # petits pas sous le boubou : les jambes restent dedans

def kaftan(F):
    """homme en kaftan (tunique longue) et pantalon, sandales"""
    t, t2, sk = TISSU(), TISSU2(), skin()
    base_body(F, sk, legs=t2, arms=t)
    torso(F, t); F.tube(t, 'hips', (0, 0, 0.42), (0, 0, 0.95), 0.27, 0.19, 1, 0.9)
    for b in range(4): F.ball(mat('Bouton', 0xd8c58a, 0.4, 0.6), 'spine', (0, -0.118, 1.38 - b * 0.06), 0.01, seg=6)
    return {'stride': 0.7}

def jeune(F):
    """jeune en t-shirt, jean, baskets et casquette"""
    t, sk = TISSU(), skin()
    base_body(F, sk, legs=mat('Jean', 0x2c4a73, 0.9), shoes=mat('Basket', 0xf2f2f0, 0.6))
    torso(F, t, r0=0.15, r1=0.19)
    for s, a in ((1, 'arm_L'), (-1, 'arm_R')): F.tube(t, a, (s * 0.2, 0, 1.42), (s * 0.21, 0, 1.25), 0.065, 0.06)  # manches courtes
    c = TISSU2(); F.tube(c, 'head', (0, 0.0, 1.66), (0, 0.0, 1.73), 0.108, 0.1, 0.92, 1); F.box(c, 'head', (0, -0.13, 1.67), (0.16, 0.12, 0.015))  # casquette
    return {'arm_still': ('R',)}

def costume(F):
    """homme en costume au Plateau"""
    t, sk = mat('Costume', 0x23262c, 0.6), skin()
    base_body(F, sk, legs=t, shoes=mat('Cuir', 0x1a1210, 0.4), arms=t)
    torso(F, t, r0=0.155, r1=0.2)
    F.box(mat('Chemise', 0xf4f4f2, 0.6), 'spine', (0, -0.115, 1.34), (0.08, 0.01, 0.16)); F.box(TISSU(), 'spine', (0, -0.122, 1.3), (0.03, 0.01, 0.15))  # cravate
    F.box(mat('Cuir', 0x1a1210, 0.4), 'fore_R', (-0.24, -0.02, 0.76), (0.08, 0.32, 0.24))  # serviette
    return {}

def drianke(F):
    """femme en taille-basse : haut cintre, pagne long, foulard (musoor) noue"""
    t, t2, sk = TISSU(), TISSU2(), skin()
    base_body(F, sk, legs=sk, female=True, arms=None)
    torso(F, t, r0=0.14, r1=0.17, female=True)
    F.tube(t, 'hips', (0, 0, 0.92), (0, 0, 1.05), 0.24, 0.15, 1, 0.75)               # basque du taille-basse
    F.tube(t, 'hips', (0, 0, 0.06), (0, 0, 0.95), 0.25, 0.17, 1, 0.95)                 # pagne jusqu'aux pieds
    for s, a in ((1, 'arm_L'), (-1, 'arm_R')): F.tube(t, a, (s * 0.2, 0, 1.42), (s * 0.23, 0, 1.18), 0.07, 0.1)  # manches bouffantes
    F.ball(t2, 'head', (0, 0.02, 1.66), 0.125, 0.95, 1.05, 0.95)                      # musoor
    F.ball(t2, 'head', (0, -0.02, 1.79), 0.075, 1.5, 0.8, 0.7, seg=8)                 # noeud du foulard
    for s in (1, -1): F.ball(mat('Or', 0xd9b24a, 0.3, 0.8), 'head', (s * 0.098, -0.005, 1.56), 0.012, seg=6)  # boucles d'oreilles
    return {'stride': 0.5}  # le pagne serre fait faire de petits pas

def vendeuse(F):
    """vendeuse : grand boubou de femme, foulard, bassine emaillee sur la tete tenue d'une main"""
    t, t2, sk = TISSU(), TISSU2(), skin()
    base_body(F, sk, legs=sk, female=True)
    torso(F, t, r0=0.15, r1=0.18, female=True)
    F.tube(t, 'hips', (0, 0, 0.06), (0, 0, 1.0), 0.36, 0.22, 1, 0.8)
    F.tube(t, 'spine', (0, 0, 1.0), (0, 0, 1.43), 0.22, 0.2, 1, 0.6)
    F.tube(t, 'arm_R', (-0.21, 0, 1.42), (-0.25, 0, 1.08), 0.08, 0.15, 0.6, 1); F.tube(t, 'arm_L', (0.2, 0, 1.42), (0.21, 0, 1.2), 0.065, 0.075)  # bras leve : manche retombee
    F.ball(t2, 'head', (0, 0.02, 1.66), 0.122, 0.95, 1.05, 0.85)
    F.tube(t2, 'head', (0, 0, 1.73), (0, 0, 1.76), 0.07, 0.07)                        # coussinet roule
    b = mat('Bassine', 0x2a7fd4, 0.25, 0.1)
    F.tube(b, 'head', (0, 0, 1.76), (0, 0, 1.9), 0.2, 0.3, n=16)                       # bassine
    F.tube(mat('Mangue', 0xf0a020, 0.6), 'head', (0, 0, 1.86), (0, 0, 1.92), 0.27, 0.22, n=12)  # fruits
    return {'stride': 0.5, 'arm_up': {'L': 2.75}}

def jeune_femme(F):
    """jeune femme en robe wax et foulard, sac a l'epaule"""
    t, t2, sk = TISSU(), TISSU2(), skin()
    base_body(F, sk, legs=sk, shoes=mat('Ballerine', 0x1a1210, 0.5), female=True)
    torso(F, t, r0=0.135, r1=0.165, female=True)
    F.tube(t, 'hips', (0, 0, 0.42), (0, 0, 1.0), 0.27, 0.15, 1, 1.0)                  # robe aux mollets
    F.ball(mat('Cheveux', 0x141110, 0.9), 'head', (0, 0.02, 1.64), 0.11, 0.95, 1, 0.95)  # tresses ramenees
    F.tube(t2, 'head', (0, 0.01, 1.65), (0, 0.01, 1.72), 0.115, 0.108, 0.95, 1.05)     # bandeau
    F.box(mat('Sac', 0x7a1b1b, 0.5), 'hips', (0.2, 0.04, 1.0), (0.06, 0.22, 0.18))
    return {'arm_still': ('L',), 'stride': 0.7}

def baye_fall(F):
    """Baye Fall : ndiakhass en patchwork, dreadlocks, collier de chapelet"""
    t, sk = mat('Patch', 0x6b4a2a, 0.9), skin()
    base_body(F, sk, legs=t, arms=t)
    torso(F, t, r0=0.16, r1=0.19)
    F.tube(t, 'hips', (0, 0, 0.3), (0, 0, 0.95), 0.3, 0.2, 1, 0.9)
    hair = mat('Cheveux', 0x141110, 0.9)
    for i in range(12):
        a = math.pi * 0.15 + i * math.pi * 1.7 / 11; x, y = math.cos(a) * 0.09, math.sin(a) * 0.08 + 0.03
        F.tube(hair, 'head', (x, y, 1.66), (x * 1.5, y * 1.4 + 0.03, 1.3 + (i % 3) * 0.04), 0.017, 0.013, n=5)   # dreadlocks
    for i in range(14):
        a = i * math.pi * 2 / 14; F.ball(mat('Chapelet', 0x2b1a10, 0.5), 'spine', (math.cos(a) * 0.11, math.sin(a) * 0.08 - 0.03, 1.36 - 0.07 * max(0, -math.sin(a))), 0.012, seg=5)
    return {'stride': 0.65}

def ecolier(F):
    """ecolier : chemise kaki, short bleu marine, cartable"""
    sk = skin()
    base_body(F, sk, legs=sk, shoes=mat('Basket', 0xf2f2f0, 0.6), arms=None)
    sh = mat('Kaki', 0xc8b27a, 0.8)
    torso(F, sh, r0=0.15, r1=0.18)
    for s, a in ((1, 'arm_L'), (-1, 'arm_R')): F.tube(sh, a, (s * 0.2, 0, 1.42), (s * 0.21, 0, 1.26), 0.062, 0.058)
    sht = mat('Marine', 0x1c2b4a, 0.8)
    for s, tb in ((1, 'thigh_L'), (-1, 'thigh_R')): F.tube(sht, tb, (s * 0.09, 0, 0.95), (s * 0.09, 0, 0.7), 0.085, 0.075)
    F.tube(sht, 'hips', (0, 0, 0.85), (0, 0, 0.98), 0.17, 0.16, 1, 0.62)
    F.box(TISSU(), 'spine', (0, 0.14, 1.2), (0.26, 0.12, 0.32))                    # cartable
    return {'scale': 0.78}

# ------------------------------------------------------------------ cat (chat de rue)
def chat():
    reset()
    arm = armature('chat', [('body', (0, 0.17, 0.25), (0, -0.14, 0.26), None), ('head', (0, -0.15, 0.28), (0, -0.25, 0.33), 'body'),
                            ('tail', (0, 0.19, 0.27), (0, 0.33, 0.3), 'body'), ('tail2', (0, 0.33, 0.3), (0, 0.42, 0.42), 'tail'),
                            ('legFL', (0.05, -0.1, 0.22), (0.05, -0.11, 0.02), 'body'), ('legFR', (-0.05, -0.1, 0.22), (-0.05, -0.11, 0.02), 'body'),
                            ('legBL', (0.055, 0.13, 0.22), (0.055, 0.15, 0.02), 'body'), ('legBR', (-0.055, 0.13, 0.22), (-0.055, 0.15, 0.02), 'body')])
    F = Fig('chat'); fur, eye = mat('Pelage', 0xc8783a, 0.95), mat('Oeil', 0xc9b020, 0.2)
    F.ball(fur, 'body', (0, 0.01, 0.26), 0.09, 0.75, 2.0, 0.85)                       # corps fin de chat de gouttiere
    F.ball(fur, 'head', (0, -0.22, 0.31), 0.06, 1, 0.95, 0.85)
    F.ball(fur, 'head', (0, -0.27, 0.295), 0.03, 1, 1, 0.75, seg=6)                   # museau
    for s in (1, -1):
        F.tube(fur, 'head', (s * 0.032, -0.21, 0.345), (s * 0.045, -0.2, 0.4), 0.022, 0.002, 1, 0.5, n=4)  # oreilles pointues
        F.ball(eye, 'head', (s * 0.025, -0.268, 0.32), 0.009, seg=6)
    F.tube(fur, 'tail', (0, 0.18, 0.27), (0, 0.33, 0.3), 0.017, 0.014, n=6); F.tube(fur, 'tail2', (0, 0.33, 0.3), (0, 0.42, 0.43), 0.014, 0.01, n=6)
    for b, x, y in (('legFL', 0.05, -0.1), ('legFR', -0.05, -0.1), ('legBL', 0.055, 0.13), ('legBR', -0.055, 0.13)):
        F.tube(fur, b, (x, y, 0.24), (x, y + (0.01 if y < 0 else 0.02), 0.02), 0.025, 0.016, n=6)
    F.build(arm)
    fwd = {b: axis_sign(arm, b, (0, -1, 0)) for b in ('legFL', 'legFR', 'legBL', 'legBR')}
    tax, tsg = best_axis(arm, 'tail', (1, 0, 0)); hax, hsg = best_axis(arm, 'head', (1, 0, 0))
    def walk(f):
        s = math.sin(2 * math.pi * f / 16)
        return {'legFL': (0, fwd['legFL'] * 0.5 * s), 'legBR': (0, fwd['legBR'] * 0.5 * s), 'legFR': (0, -fwd['legFR'] * 0.5 * s), 'legBL': (0, -fwd['legBL'] * 0.5 * s),
                'tail': (tax, tsg * 0.15 * s), 'tail2': (tax, tsg * 0.3 * math.cos(2 * math.pi * f / 16))}
    def idle(f):
        ph = 2 * math.pi * f / 48
        return {'tail': (tax, tsg * 0.35 * math.sin(ph)), 'tail2': (tax, tsg * 0.5 * math.sin(ph + 1)), 'head': (hax, hsg * 0.4 * math.sin(ph * 0.5))}
    action(arm, 'Walk', range(0, 17, 2), walk); action(arm, 'Idle', range(0, 49, 4), idle)
    arm.animation_data.action = bpy.data.actions['Walk']; clear(arm)
    export(os.path.join(OUT, 'chat.glb'))

# ------------------------------------------------------------------ bird (corbeau pie / pigeon, ~0.45 m)
def oiseau():
    reset()
    arm = armature('oiseau', [('body', (0, 0.12, 0.17), (0, -0.08, 0.2), None), ('head', (0, -0.09, 0.22), (0, -0.16, 0.27), 'body'),
                              ('wing_L', (0.05, -0.01, 0.21), (0.32, 0.03, 0.21), 'body'), ('wing_R', (-0.05, -0.01, 0.21), (-0.32, 0.03, 0.21), 'body')])
    F = Fig('oiseau'); pl, col, bk = mat('Plumage', 0x151515, 0.6), mat('Col', 0xf0f0ee, 0.7), mat('Bec', 0x1a1a1a, 0.4)
    F.ball(pl, 'body', (0, 0.02, 0.18), 0.07, 0.85, 1.7, 0.85)
    F.ball(col, 'body', (0, -0.045, 0.18), 0.062, 0.9, 1.0, 0.95)                     # plastron blanc du corbeau pie
    F.tube(pl, 'body', (0, 0.1, 0.19), (0, 0.24, 0.17), 0.045, 0.06, 1, 0.25, n=6)     # queue
    F.ball(pl, 'head', (0, -0.12, 0.25), 0.045, 0.9, 1.1, 1)
    F.tube(bk, 'head', (0, -0.155, 0.25), (0, -0.215, 0.24), 0.015, 0.002, n=6)
    for s in (1, -1):
        F.box(pl, 'body', (s * 0.055, 0.04, 0.2), (0.025, 0.2, 0.06))                  # ailes repliees
        F.tube(bk, 'body', (s * 0.025, 0.0, 0.12), (s * 0.025, -0.005, 0.0), 0.007, 0.006, n=4)  # pattes
        F.box(bk, 'body', (s * 0.025, -0.02, 0.004), (0.02, 0.05, 0.008))
    for s, w in ((1, 'wing_L'), (-1, 'wing_R')):
        F.box(pl, w, (s * 0.18, 0.04, 0.21), (0.27, 0.15, 0.012))                       # aile deployee
        F.box(pl, w, (s * 0.3, 0.07, 0.21), (0.1, 0.12, 0.01))                           # remiges
    F.build(arm)
    ups = {w: best_axis(arm, w, (0, 0, 1)) for w in ('wing_L', 'wing_R')}; hax = axis_sign(arm, 'head', (0, 0, -1))
    def fly(f):
        s = math.sin(2 * math.pi * f / 8)
        return {w: (ax, sg * 0.75 * s) for w, (ax, sg) in ups.items()}
    def peck(f):  # posé : ailes rangées, la tête picore
        ph = (f % 24) / 24; P = {'wing_L': ('scale', 0.01), 'wing_R': ('scale', 0.01)}
        P['head'] = (0, hax * (0.9 if ph < 0.25 or 0.5 < ph < 0.6 else 0.0)); return P
    action(arm, 'Fly', range(0, 9), fly); action(arm, 'Peck', range(0, 49, 2), peck)
    arm.animation_data.action = bpy.data.actions['Fly']; clear(arm)
    export(os.path.join(OUT, 'oiseau.glb'))

for n, b in (('boubou', grand_boubou), ('kaftan', kaftan), ('jeune', jeune), ('costume', costume), ('drianke', drianke),
             ('vendeuse', vendeuse), ('jeunefemme', jeune_femme), ('bayefall', baye_fall), ('ecolier', ecolier)):
    MATS.clear(); human(n, b)
MATS.clear(); chat()
MATS.clear(); oiseau()
