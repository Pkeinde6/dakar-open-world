# Arbres du Senegal pour Godot : neem (nim) feuillu, cocotier/palmier, baobab. Troncs avec branches,
# feuillage en touffes irregulieres, palmes courbes. usage: blender --background --python tools/arbres_blender.py -- <dossier>
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix, noise
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for c in (bpy.data.meshes, bpy.data.materials): [c.remove(x) for x in list(c)]
def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'); b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    return m
class Tree:
    def __init__(self): self.parts = {}
    def bm(self, m): return self.parts.setdefault(m.name, (m, bmesh.new()))[1]
    def limb(self, m, p0, p1, r0, r1, n=8):
        p0, p1 = Vector(p0), Vector(p1); d = p1 - p0
        M = Matrix.Translation((p0 + p1) / 2) @ d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        bmesh.ops.create_cone(self.bm(m), cap_ends=True, segments=n, radius1=r0, radius2=r1, depth=d.length, matrix=M)
    def blob(self, m, c, r, squash=0.75, rough=0.35, sub=2):
        b = self.bm(m); ret = bmesh.ops.create_icosphere(b, subdivisions=sub, radius=r, matrix=Matrix.Translation(c))
        for v in ret['verts']:  # touffe irreguliere : bosses de bruit, aplatie dessous
            o = v.co - Vector(c); k = 1 + rough * noise.noise(v.co * 0.9 + Vector((random.random() * 9,) * 3)); o *= k; o.z *= squash if o.z > 0 else squash * 0.6
            v.co = Vector(c) + o
    def leaves(self, m, c, r, n=260, size=0.32):
        """feuilles : petits quads orientes au hasard sur et dans la touffe (texture a trous dans le jeu)"""
        b = self.bm(m); uv = b.loops.layers.uv.verify()
        for _ in range(n):
            d = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1))).normalized(); p = Vector(c) + d * r * random.uniform(0.75, 1.12); p.z = Vector(c).z + (p.z - Vector(c).z) * 0.8
            u = d.cross(Vector((random.random(), random.random(), random.random())) - Vector((0.5, 0.5, 0.5))).normalized(); v = d.cross(u).normalized(); s = size * random.uniform(0.7, 1.3)
            vs = [b.verts.new(p + (-u - v) * s), b.verts.new(p + (u - v) * s), b.verts.new(p + (u + v) * s), b.verts.new(p + (-u + v) * s)]
            f = b.faces.new(vs)
            for lp, (x, y) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): lp[uv].uv = (x, y)
    def frond(self, m, base, ang, length=4.2, droop=0.55, w=0.9):
        b = self.bm(m); prev = None; segs = 7
        for i in range(segs + 1):
            t = i / segs; d = Vector((math.cos(ang), math.sin(ang), 0)); p = Vector(base) + d * length * t + Vector((0, 0, 0.9 * t - droop * length * t * t))
            side = Vector((-d.y, d.x, 0)) * w * math.sin(math.pi * min(1, t * 1.2)) * 0.5
            l, r = b.verts.new(p - side + Vector((0, 0, -0.12 * (1 - t)))), b.verts.new(p + side + Vector((0, 0, -0.12 * (1 - t)))); c = b.verts.new(p + Vector((0, 0, 0.08)))
            if prev: b.faces.new((prev[0], l, c, prev[2])); b.faces.new((prev[2], c, r, prev[1]))
            prev = (l, r, c)
    def build(self, name):
        objs = []
        for mn, (m, b) in self.parts.items():
            me = bpy.data.meshes.new(mn); b.to_mesh(me); b.free(); o = bpy.data.objects.new(mn, me); o.data.materials.append(m); bpy.context.collection.objects.link(o); objs.append(o)
            for p in me.polygons: p.use_smooth = True
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); objs[0].name = name
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', use_selection=True, export_yup=True)

bark, leaf = lambda: mat('Ecorce', (0.24, 0.18, 0.12)), lambda: mat('Feuillage', (0.16, 0.3, 0.07), 0.8)
def neem(seed):
    random.seed(seed); reset(); T = Tree(); b, l = bark(), leaf(); core = mat('Coeur', (0.08, 0.16, 0.04)); f = mat('Feuilles', (0.25, 0.42, 0.12), 0.7); h = random.uniform(3.2, 4.2)
    T.limb(b, (0, 0, 0), (0.1, 0, h), 0.32, 0.22)
    for i in range(5):  # branches maitresses en eventail
        a = i * 2.4 + random.random(); top = Vector((math.cos(a) * 2.2, math.sin(a) * 2.2, h + random.uniform(1.4, 2.6)))
        T.limb(b, (0.1, 0, h - 0.3), top, 0.17, 0.07, 6)
        for k in range(3):
            c = top + Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-0.2, 0.8))); r = random.uniform(1.3, 1.9)
            T.blob(core, c, r * 0.8); T.leaves(f, c, r)
    T.blob(core, (0, 0, h + 2.8), 1.8); T.leaves(f, (0, 0, h + 2.8), 2.2, 420)
    T.build(f'arbre_neem{seed}')
def palmier(seed):
    random.seed(seed); reset(); T = Tree(); b = mat('Stipe', (0.42, 0.36, 0.28)); l = mat('Palme', (0.2, 0.33, 0.08), 0.75)
    h = random.uniform(7, 10); lean = Vector((random.uniform(-0.6, 0.6), random.uniform(-0.6, 0.6), 0)); prev = Vector((0, 0, 0))
    for i in range(1, 9):  # stipe legerement courbe, bagues
        t = i / 8; p = lean * t * t * 1.5 + Vector((0, 0, h * t)); T.limb(b, prev, p, 0.26 - 0.06 * t + 0.02, 0.24 - 0.06 * t, 8); prev = p
    for k in range(13): T.frond(l, prev, k * 2 * math.pi / 13 + random.random() * 0.3, random.uniform(3.6, 4.6), random.uniform(0.35, 0.65))
    T.blob(mat('Noix', (0.35, 0.28, 0.1)), prev + Vector((0, 0, -0.35)), 0.38, 1, 0.1, 1)
    T.build(f'arbre_palmier{seed}')
def baobab(seed):
    random.seed(seed); reset(); T = Tree(); b = mat('EcorceBaobab', (0.5, 0.45, 0.4)); l = leaf()
    T.limb(b, (0, 0, 0), (0, 0, 6), 1.9, 1.3, 14)  # tronc enorme en bouteille
    for i in range(7):
        a = i * 0.9 + random.random(); e = Vector((math.cos(a) * random.uniform(3, 5), math.sin(a) * random.uniform(3, 5), random.uniform(8, 10.5)))
        T.limb(b, (0, 0, 5.6), e, 0.6, 0.18, 7)
        if random.random() < 0.6: T.leaves(mat('Feuilles', (0.25, 0.42, 0.12), 0.7), e + Vector((0, 0, 0.4)), random.uniform(0.9, 1.4), 90, 0.25)  # baobab presque nu en saison seche
    T.build(f'arbre_baobab{seed}')
for s in (1, 2, 3): neem(s)
for s in (1, 2): palmier(s)
baobab(1)
