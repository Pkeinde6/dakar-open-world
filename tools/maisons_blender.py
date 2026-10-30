# Maisons types de Dakar, modelisees d'apres Street View, exportees en GLB pour le jeu.
# usage: blender --background --python tools/maisons_blender.py -- <dossier models/>
# The front of each house faces -Y in Blender (= +Z in glTF, the side the game turns toward the street).
# Materials named "Facade" are recoloured in the game; the rest keep their colours.
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'

def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for m in list(bpy.data.materials): bpy.data.materials.remove(m)

MATS = {}
def mat(name, rgb, rough=0.85, metal=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    MATS[name] = m; return m

def srgb(h):  # hex sRGB -> linear
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)

class House:
    """collects boxes per material in one bmesh each, then builds one object"""
    def __init__(self, name): self.name = name; self.parts = {}
    def box(self, m, x0, y0, z0, x1, y1, z1):
        bm = self.parts.setdefault(m.name, (m, bmesh.new()))[1]
        v = [bm.verts.new((x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
        for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)): bm.faces.new([v[i] for i in f])
    def cyl(self, m, cx, cy, z0, r, h, n=12):
        bm = self.parts.setdefault(m.name, (m, bmesh.new()))[1]
        bmesh.ops.create_cone(bm, cap_ends=True, segments=n, radius1=r, radius2=r, depth=h, matrix=__import__('mathutils').Matrix.Translation((cx, cy, z0 + h / 2)))
    def build(self):
        objs = []
        for name, (m, bm) in self.parts.items():
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
            o = bpy.data.objects.new(f'{self.name}_{name}', me); o.data.materials.append(m); bpy.context.collection.objects.link(o); objs.append(o)
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs: o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]; bpy.ops.object.join(); objs[0].name = self.name
        return objs[0]

def window(H, F, T, G, M, x, y, z, w, h, front=True, grille=True, shutters=None):
    """window in the wall plane y (front faces -Y): frame, dark glass, iron grille, optional louvre shutters"""
    d = -1 if front else 1
    H.box(T, x - w / 2 - 0.12, y + d * 0.06, z - 0.12, x + w / 2 + 0.12, y - d * 0.02, z + h + 0.12)  # encadrement
    H.box(G, x - w / 2, y + d * 0.08, z, x + w / 2, y + d * 0.02, z + h)                               # vitre (en retrait du cadre)
    H.box(T, x - w / 2 - 0.18, y + d * 0.16, z - 0.18, x + w / 2 + 0.18, y - d * 0.0, z - 0.08)       # appui
    if grille:
        n = max(3, int(w / 0.14))
        for k in range(n + 1):
            xx = x - w / 2 + k * w / n; H.box(M, xx - 0.015, y + d * 0.14, z, xx + 0.015, y + d * 0.11, z + h)
        H.box(M, x - w / 2, y + d * 0.14, z + h / 2 - 0.02, x + w / 2, y + d * 0.11, z + h / 2 + 0.02)
    if shutters:
        for s in (-1, 1): H.box(shutters, x + s * (w / 2 + 0.05), y + d * 0.1, z, x + s * (w / 2 + 0.05 + w / 2), y + d * 0.06, z + h)

def railing(H, M, x0, x1, y, z, h=1.0, step=0.12):
    H.box(M, x0, y - 0.03, z + h - 0.05, x1, y + 0.03, z + h)
    H.box(M, x0, y - 0.03, z + 0.1, x1, y + 0.03, z + 0.14)
    n = int((x1 - x0) / step)
    for k in range(n + 1): xx = x0 + k * (x1 - x0) / n; H.box(M, xx - 0.012, y - 0.012, z, xx + 0.012, y + 0.012, z + h)

def parapet(H, F, C, W, D, z, h=0.9, t=0.18):
    for (x0, y0, x1, y1) in ((-W / 2, -D / 2, W / 2, -D / 2 + t), (-W / 2, D / 2 - t, W / 2, D / 2), (-W / 2, -D / 2, -W / 2 + t, D / 2), (W / 2 - t, -D / 2, W / 2, D / 2)):
        H.box(F, x0, y0, z, x1, y1, z + h); H.box(C, x0 - 0.04, y0 - 0.04, z + h, x1 + 0.04, y1 + 0.04, z + h + 0.07)

def slab_band(H, B, W, D, z):
    H.box(B, -W / 2 - 0.08, -D / 2 - 0.08, z - 0.14, W / 2 + 0.08, D / 2 + 0.08, z + 0.12)

def export(o, name):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_apply=True)
    print('export', path, len(o.data.polygons), 'faces')

# ---------- shared materials
F = mat('Facade', srgb(0xe8dcc4))
T = mat('Trim', srgb(0xf4f1ea), 0.7)
B = mat('Band', srgb(0xefe9dd), 0.8)
G = mat('Glass', srgb(0x1d2a33), 0.15, 0.3)
M = mat('Iron', srgb(0x23262a), 0.5, 0.6)
C = mat('Concrete', srgb(0xbdb6a8), 0.95)
TK = mat('Tank', srgb(0x161618), 0.6)

def maison_r1():
    """maison R+1 de banlieue / Sicap : 10 x 9 m, porte en fer, fenetres a grilles, balcon, cage d'escalier, citerne"""
    reset(); MATS.clear()
    global F, T, B, G, M, C, TK
    F = mat('Facade', srgb(0xe8dcc4)); T = mat('Trim', srgb(0xf4f1ea), 0.7); B = mat('Band', srgb(0xefe9dd)); G = mat('Glass', srgb(0x1d2a33), 0.15, 0.3)
    M = mat('Iron', srgb(0x23262a), 0.5, 0.6); C = mat('Concrete', srgb(0xbdb6a8), 0.95); TK = mat('Tank', srgb(0x161618), 0.6)
    DOOR = mat('Door', srgb(0x2a5d8f), 0.5, 0.4); SH = mat('Shutter', srgb(0x2f7d5b), 0.7)
    H = House('maison_r1'); W, D, fl = 10, 9, 3.1
    H.box(F, -W / 2, -D / 2, 0, W / 2, D / 2, 2 * fl)                       # volume
    H.box(C, -W / 2 + 0.1, -D / 2 + 0.1, 2 * fl, W / 2 - 0.1, D / 2 - 0.1, 2 * fl + 0.05)  # toit-terrasse
    parapet(H, F, C, W, D, 2 * fl)
    slab_band(H, B, W, D, fl)
    H.box(C, -W / 2 - 0.05, -D / 2 - 0.05, 0, W / 2 + 0.05, D / 2 + 0.05, 0.45)  # soubassement
    y = -D / 2
    H.box(T, -1.0, y - 0.05, 0, 1.0, y + 0.02, 2.5); H.box(DOOR, -0.85, y - 0.08, 0.05, 0.85, y - 0.03, 2.35)  # porte en tole
    for k in range(6): H.box(M, -0.85, y - 0.1, 0.4 + k * 0.33, 0.85, y - 0.07, 0.43 + k * 0.33)
    for x in (-3.3, 3.3): window(H, F, T, G, M, x, y, 0.95, 1.2, 1.2, shutters=SH)
    for x in (-3.3, 0, 3.3): window(H, F, T, G, M, x, y, fl + 0.9, 1.2, 1.3, shutters=SH if x else None)
    # balcon au centre de l'etage
    H.box(B, -1.8, y - 1.1, fl - 0.05, 1.8, y, fl + 0.14); railing(H, M, -1.8, 1.8, y - 1.05, fl + 0.14)
    for xx in (-1.8, 1.8): H.box(M, xx - 0.02, y - 1.05, fl + 0.14, xx + 0.02, y, fl + 1.14)
    for side in (-1, 1):  # fenetres laterales
        for z in (0.95, fl + 0.9):
            xw = side * W / 2
            H.box(T, xw - 0.06 * side, -1.4, z - 0.12, xw + 0.02 * side, 0.0, z + 1.32)
            H.box(G, xw + 0.02 * side, -1.28, z, xw + 0.07 * side, -0.12, z + 1.2)
    for x in (-3.3, 3.3): window(H, F, T, G, M, x, D / 2, fl + 0.9, 1.0, 1.1, front=False)
    # cage d'escalier + citerne + fers d'attente
    H.box(F, 1.6, 0.8, 2 * fl, 4.4, 3.9, 2 * fl + 2.5); H.box(C, 1.5, 0.7, 2 * fl + 2.5, 4.5, 4.0, 2 * fl + 2.62)
    H.box(DOOR, 2.4, 0.74, 2 * fl, 3.3, 0.8, 2 * fl + 2.0)
    H.cyl(TK, -2.8, 2.2, 2 * fl + 0.05, 0.55, 1.3); H.cyl(TK, -2.8, 2.2, 2 * fl + 1.35, 0.25, 0.15)
    for (x, yy) in ((-W / 2 + 0.3, -D / 2 + 0.3), (W / 2 - 0.3, -D / 2 + 0.3), (-W / 2 + 0.3, D / 2 - 0.3)):
        H.box(C, x - 0.15, yy - 0.15, 2 * fl + 0.9, x + 0.15, yy + 0.15, 2 * fl + 1.6)
        for dx in (-0.08, 0.08): H.box(M, x + dx - 0.01, yy - 0.01, 2 * fl + 1.6, x + dx + 0.01, yy + 0.01, 2 * fl + 2.4)
    return export(H.build(), 'maison_r1')

def villa():
    """villa de Fann / Mermoz : blanche, grandes baies, porche a colonnes, terrasse a balustres, auvent en tuiles"""
    reset(); MATS.clear()
    F2 = mat('Facade', srgb(0xf6f2ea)); T2 = mat('Trim', srgb(0xd9c9a8), 0.7); G2 = mat('Glass', srgb(0x26343d), 0.1, 0.4)
    M2 = mat('Iron', srgb(0x1f1f22), 0.5, 0.6); C2 = mat('Concrete', srgb(0xc7c0b2), 0.95); TILE = mat('Tile', srgb(0xa8452e), 0.7)
    STONE = mat('Stone', srgb(0x8a7d6a), 0.95)
    H = House('villa'); W, D, fl = 13, 11, 3.3
    H.box(F2, -W / 2, -D / 2 + 2, 0, W / 2, D / 2, fl)            # rez-de-chaussee, en retrait du porche
    H.box(F2, -W / 2, -D / 2 + 2, fl, 1.5, D / 2, 2 * fl)          # etage sur la moitie gauche
    H.box(C2, -W / 2, -D / 2 + 2, fl, W / 2, D / 2, fl + 0.06)     # terrasse
    H.box(STONE, -W / 2 - 0.05, -D / 2 + 1.95, 0, W / 2 + 0.05, D / 2 + 0.05, 0.6)  # soubassement en pierre (Mermoz)
    # acrotere de l'etage
    for (x0, y0, x1, y1) in ((-W / 2, -D / 2 + 2, 1.5, -D / 2 + 2.16), (-W / 2, D / 2 - 0.16, 1.5, D / 2), (-W / 2, -D / 2 + 2, -W / 2 + 0.16, D / 2), (1.34, -D / 2 + 2, 1.5, D / 2)):
        H.box(F2, x0, y0, 2 * fl, x1, y1, 2 * fl + 0.8); H.box(T2, x0 - 0.04, y0 - 0.04, 2 * fl + 0.8, x1 + 0.04, y1 + 0.04, 2 * fl + 0.88)
    # terrasse : balustres
    y = -D / 2 + 2
    H.box(T2, 1.5, y - 0.05, fl + 0.06, W / 2, y + 0.12, fl + 0.18); H.box(T2, 1.5, y - 0.05, fl + 0.95, W / 2, y + 0.12, fl + 1.05)
    for k in range(int((W / 2 - 1.5) / 0.3)): xx = 1.65 + k * 0.3; H.cyl(T2, xx, y + 0.03, fl + 0.18, 0.06, 0.77, 8)
    # porche a colonnes + auvent en tuiles
    H.box(C2, -2.5, -D / 2, 0, 2.5, -D / 2 + 2, 0.15)
    for x in (-2.3, 2.3): H.cyl(T2, x, -D / 2 + 0.25, 0.15, 0.17, 2.75, 12)
    roof = H.parts.setdefault('Tile', (TILE, bmesh.new()))[1]
    v = [roof.verts.new(p) for p in ((-2.8, -D / 2 - 0.4, 2.9), (2.8, -D / 2 - 0.4, 2.9), (2.8, -D / 2 + 2, 3.5), (-2.8, -D / 2 + 2, 3.5),
                                      (-2.8, -D / 2 - 0.4, 3.05), (2.8, -D / 2 - 0.4, 3.05), (2.8, -D / 2 + 2, 3.65), (-2.8, -D / 2 + 2, 3.65))]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)): roof.faces.new([v[i] for i in f])
    # grandes baies
    for x in (-4.6, 4.3): window(H, F2, T2, G2, M2, x, y, 0.75, 2.2, 1.9, grille=False)
    H.box(T2, -1.1, y - 0.06, 0, 1.1, y + 0.02, 2.6); H.box(mat('Door', srgb(0x5a3a22), 0.6), -0.95, y - 0.09, 0.05, 0.95, y - 0.04, 2.45)
    for x in (-4.6, -1.6): window(H, F2, T2, G2, M2, x, y, fl + 0.8, 1.6, 1.6)
    for x in (-4.0, 0, 4.0): window(H, F2, T2, G2, M2, x, D / 2, 0.9, 1.4, 1.3, front=False)
    return export(H.build(), 'villa')

def immeuble_medina():
    """immeuble R+3 de la Medina / Colobane : boutiques a rideaux metalliques, baches, balcons, climatiseurs"""
    reset(); MATS.clear()
    F3 = mat('Facade', srgb(0xe6c15a)); T3 = mat('Trim', srgb(0xf2ece0), 0.7); B3 = mat('Band', srgb(0xf0e6d2)); G3 = mat('Glass', srgb(0x1d2a33), 0.15, 0.3)
    M3 = mat('Iron', srgb(0x2b2e33), 0.5, 0.6); C3 = mat('Concrete', srgb(0xbdb6a8), 0.95); SHUT = mat('Shutter', srgb(0x8a9399), 0.5, 0.6)
    TARP = mat('Tarp', srgb(0x2a6fb5), 0.9); AC = mat('AC', srgb(0xe9e9e4), 0.5); SIGN = mat('Sign', srgb(0xc0392b), 0.6)
    H = House('immeuble_medina'); W, D, fl, n = 11, 12, 3.1, 4
    H.box(F3, -W / 2, -D / 2, fl, W / 2, D / 2, n * fl)
    H.box(C3, -W / 2, -D / 2 + 0.3, 0, W / 2, D / 2, fl)                         # rez-de-chaussee (boutiques)
    H.box(C3, -W / 2 + 0.1, -D / 2 + 0.1, n * fl, W / 2 - 0.1, D / 2 - 0.1, n * fl + 0.05)
    for (x0, y0, x1, y1) in ((-W / 2, -D / 2, W / 2, -D / 2 + 0.18), (-W / 2, D / 2 - 0.18, W / 2, D / 2), (-W / 2, -D / 2, -W / 2 + 0.18, D / 2), (W / 2 - 0.18, -D / 2, W / 2, D / 2)):
        H.box(F3, x0, y0, n * fl, x1, y1, n * fl + 0.9); H.box(C3, x0 - 0.04, y0 - 0.04, n * fl + 0.9, x1 + 0.04, y1 + 0.04, n * fl + 0.97)
    for f in range(1, n): slab_band(H, B3, W, D, f * fl)
    y = -D / 2
    for k, x in enumerate((-3.6, 0, 3.6)):  # 3 boutiques : rideau, enseigne, bache
        H.box(SHUT, x - 1.5, y + 0.25, 0.05, x + 1.5, y + 0.3, 2.4)
        for r in range(16): H.box(M3, x - 1.5, y + 0.22, 0.12 + r * 0.14, x + 1.5, y + 0.25, 0.14 + r * 0.14)
        H.box(SIGN if k != 1 else mat('Sign2', srgb(0x27ae60), 0.6), x - 1.6, y - 0.02, 2.45, x + 1.6, y + 0.3, 3.0)
        H.box(TARP if k != 2 else mat('Tarp2', srgb(0xf2b01e), 0.9), x - 1.7, y - 1.6, 3.02, x + 1.7, y, 3.08)
        H.box(TARP if k != 2 else MATS['Tarp2'], x - 1.7, y - 1.62, 2.65, x + 1.7, y - 1.58, 3.05)
    for f in range(1, n):
        z = f * fl
        for x in (-3.6, 0, 3.6):
            window(H, F3, T3, G3, M3, x, y, z + 0.85, 1.3, 1.4, shutters=mat('Shutter2', srgb(0x2a5d8f), 0.7) if f == 2 else None)
            if (f + int(x)) % 2 == 0:
                H.box(B3, x - 1.3, y - 1.0, z - 0.05, x + 1.3, y, z + 0.14); railing(H, M3, x - 1.3, x + 1.3, y - 0.95, z + 0.14)
            else:
                H.box(AC, x + 0.9, y - 0.35, z + 0.95, x + 1.65, y, z + 1.5)
        for x in (-4.0, 0, 4.0): window(H, F3, T3, G3, M3, x, D / 2, z + 0.85, 1.1, 1.2, front=False)
    H.cyl(mat('Tank', srgb(0x161618), 0.6), 3.0, 3.0, n * fl + 0.05, 0.55, 1.3)
    H.box(F3, -4.4, 1.0, n * fl, -1.6, 4.0, n * fl + 2.5)
    return export(H.build(), 'immeuble_medina')

maison_r1(); villa(); immeuble_medina()
